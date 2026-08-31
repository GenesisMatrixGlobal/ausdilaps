import { FETCH_TIMEOUT_MS } from "../config";
import { canonicalUrl, contentHash, externalRefForEmailLink, externalRefForMessage } from "../dedupe";
import { htmlToText } from "@/lib/html";
import { isTrustedSender, routeSender, senderDomain, type MailboxSource } from "../senders";
import type { FetchResult, RawItem } from "../types";

/**
 * Microsoft Graph mailbox adapter.
 *
 * Polling rather than auto-forwarding or webhooks, for three reasons, in order:
 * M365 blocks external auto-forwarding by default; the requirement is a nightly scan, so a
 * webhook's real-time advantage is worth nothing here; and polling means no public
 * endpoint to secure and no email vendor in the path.
 *
 * ── The one thing that must be true before this runs in production ──────────────────
 * `Mail.Read` as an APPLICATION permission grants read on EVERY mailbox in the tenant
 * until an administrator scopes it:
 *
 *   New-ApplicationAccessPolicy -AppId <app-id> `
 *     -PolicyScopeGroupId tenders@ausdilaps.com.au -AccessRight RestrictAccess
 *
 * assertMailboxScoped() below exists to prove that has been done, and should be run once
 * against the deployed environment before this is trusted. Do not take it on faith.
 */

const GRAPH = "https://graph.microsoft.com/v1.0";

/** Messages per page, and how many pages we will walk before giving up. */
const PAGE_SIZE = 50;
const MAX_PAGES = 10;

/** How long a fetched mailbox page set stays reusable across sources in one run. */
const MEMO_TTL_MS = 120_000;

export function mailboxConfigured(): boolean {
  return !!(
    process.env.MS_GRAPH_TENANT_ID &&
    process.env.MS_GRAPH_CLIENT_ID &&
    process.env.MS_GRAPH_CLIENT_SECRET &&
    process.env.TENDER_MAILBOX
  );
}

type TokenResponse = { access_token: string; expires_in: number };

/**
 * Client-credentials token. Same grant as lib/box.ts:getAccessToken(), different endpoint.
 *
 * Cached until shortly before expiry: a scan makes several Graph calls and there is no
 * reason to mint a token for each. Never logged — a leaked bearer token for an
 * application-permission app is a mailbox read for whoever finds it.
 */
let tokenCache: { token: string; expiresAt: number } | null = null;

export async function getGraphToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;

  const tenant = process.env.MS_GRAPH_TENANT_ID;
  const clientId = process.env.MS_GRAPH_CLIENT_ID;
  const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET;
  if (!tenant || !clientId || !clientSecret) {
    throw new Error(
      "Graph isn't configured — set MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID and MS_GRAPH_CLIENT_SECRET."
    );
  }

  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });

  if (!res.ok) {
    // Body deliberately truncated and not searched for the secret — Entra echoes back
    // enough to diagnose without us widening the blast radius of a log.
    throw new Error(`Graph token request failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }

  const data = (await res.json()) as TokenResponse;
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(0, (data.expires_in ?? 3600) - 300) * 1000,
  };
  return data.access_token;
}

export type GraphMessage = {
  id: string;
  internetMessageId?: string;
  subject?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  receivedDateTime?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  hasAttachments?: boolean;
  webLink?: string;
};

/** ISO string floored to the hour. */
function floorToHour(iso: string): string {
  const d = new Date(iso);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

/**
 * Every message in the mailbox since `windowStart`, paged.
 *
 * Fetched ONCE per run and shared by every source, rather than once per source.
 *
 * That is a deliberate departure from the RSS adapter, forced by Graph: `$filter` cannot
 * match a sender by domain suffix (portals send from noreply@, alerts@, and whatever else
 * they choose), so senders have to be matched in our own code. Filtering server-side per
 * source is therefore not possible, and issuing one identical all-messages request per
 * source would be the same fetch repeated N times.
 *
 * The window is floored to the hour so that every source in a run produces the same cache
 * key — scan.ts computes `since` separately per source, milliseconds apart. A slightly
 * wider window is harmless: dedupe is on external_ref, not on the window.
 */
let mailboxCache: { key: string; at: number; promise: Promise<GraphMessage[]> } | null = null;

export async function fetchMailboxMessages(sinceIso: string): Promise<GraphMessage[]> {
  const windowStart = floorToHour(sinceIso);
  if (mailboxCache && mailboxCache.key === windowStart && Date.now() - mailboxCache.at < MEMO_TTL_MS) {
    return mailboxCache.promise;
  }

  const promise = (async () => {
    const mailbox = process.env.TENDER_MAILBOX;
    if (!mailbox) throw new Error("TENDER_MAILBOX is not set.");
    const token = await getGraphToken();

    const params = new URLSearchParams({
      $filter: `receivedDateTime ge ${windowStart}`,
      $select: "id,internetMessageId,subject,from,receivedDateTime,bodyPreview,body,hasAttachments,webLink",
      $orderby: "receivedDateTime desc",
      $top: String(PAGE_SIZE),
    });

    let url: string | null = `${GRAPH}/users/${encodeURIComponent(mailbox)}/messages?${params}`;
    const messages: GraphMessage[] = [];

    for (let page = 0; page < MAX_PAGES && url; page++) {
      const res: Response = await fetch(url, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`Graph messages ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      const body = (await res.json()) as { value?: GraphMessage[]; "@odata.nextLink"?: string };
      messages.push(...(body.value ?? []));
      url = body["@odata.nextLink"] ?? null;
    }

    return messages;
  })();

  mailboxCache = { key: windowStart, at: Date.now(), promise };
  // A failed fetch must not be cached, or every source in the run inherits one blip.
  promise.catch(() => {
    if (mailboxCache?.promise === promise) mailboxCache = null;
  });
  return promise;
}

/** Plain text of a message body, whichever format Graph returned it in. */
function bodyText(message: GraphMessage): string {
  const raw = message.body?.content ?? message.bodyPreview ?? "";
  // htmlToText decodes entities BEFORE stripping tags — order matters, see lib/html.ts.
  return message.body?.contentType?.toLowerCase() === "html" ? htmlToText(raw, 12_000) : raw.slice(0, 12_000);
}

/** Every href in an HTML body, deduplicated, in document order. */
function linksIn(html: string): string[] {
  const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  return [...new Set(hrefs)];
}

/** The visible text of the anchor pointing at `href` — usually the tender's title. */
function anchorTextFor(html: string, href: string): string | null {
  const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`href\\s*=\\s*["']${escaped}["'][^>]*>([\\s\\S]{0,400}?)</a>`, "i"));
  const text = match ? htmlToText(match[1], 300).trim() : "";
  return text || null;
}

function fromAddress(message: GraphMessage): string | null {
  return message.from?.emailAddress?.address ?? null;
}

/**
 * A digest email → one item per tender link.
 *
 * Falls back to treating the whole email as a single item when no link matches the
 * source's pattern. That is not a silent failure: scan.ts's zero-item alarm only fires on
 * an empty result, so returning the whole digest as one item keeps the content visible
 * while `linkPattern` is still being tuned against real mail.
 */
function parseDigest(message: GraphMessage, source: MailboxSource): RawItem[] {
  const html = message.body?.contentType?.toLowerCase() === "html" ? (message.body.content ?? "") : "";
  const text = bodyText(message);
  const from = fromAddress(message);
  const trusted = isTrustedSender(from);

  const hrefs = html ? linksIn(html).filter((h) => !source.linkPattern || source.linkPattern.test(h)) : [];

  if (hrefs.length === 0) {
    return [singleItem(message, source, { titlePrefix: "", note: "digest: no tender links matched" })];
  }

  return hrefs.map((href) => {
    const title = anchorTextFor(html, href) ?? message.subject ?? "Untitled tender";
    return {
      sourceSlug: source.slug,
      // Keyed on the LINK, never on position in the email — digests reorder between sends.
      externalRef: externalRefForEmailLink(source.slug, href),
      title: htmlToText(title, 300),
      url: canonicalUrl(href),
      agency: null, // the classifier pulls this out of the body far more reliably
      publishedAt: message.receivedDateTime ?? null,
      closesAt: null,
      excerpt: text,
      contentHash: contentHash({ title: htmlToText(title, 300), agency: null, closesAt: null }),
      emailMessageId: message.internetMessageId ?? message.id,
      emailFrom: from,
      senderTrusted: trusted,
    };
  });
}

function singleItem(
  message: GraphMessage,
  source: MailboxSource,
  opts?: { titlePrefix?: string; note?: string; extraText?: string }
): RawItem {
  const from = fromAddress(message);
  const title = htmlToText(`${opts?.titlePrefix ?? ""}${message.subject ?? "(no subject)"}`, 300);
  const parts = [bodyText(message), opts?.extraText, opts?.note ? `[${opts.note}]` : null].filter(Boolean);

  return {
    sourceSlug: source.slug,
    externalRef: externalRefForMessage(message.internetMessageId ?? message.id),
    title,
    url: message.webLink ?? null,
    agency: senderDomain(from),
    publishedAt: message.receivedDateTime ?? null,
    closesAt: null,
    excerpt: parts.join("\n\n").slice(0, 14_000),
    contentHash: contentHash({ title, agency: senderDomain(from), closesAt: null }),
    emailMessageId: message.internetMessageId ?? message.id,
    emailFrom: from,
    senderTrusted: isTrustedSender(from),
  };
}

/**
 * Turns the messages this source owns into items.
 *
 * Exported separately from the fetch so it can be tested against saved .eml/JSON samples
 * without a tenant — which is how the digest parsers should be tuned.
 */
export function parseMessages(messages: GraphMessage[], source: MailboxSource): RawItem[] {
  const mine = messages.filter((m) => routeSender(fromAddress(m)).slug === source.slug);

  return mine.flatMap((message) => {
    if (source.parse === "digest") return parseDigest(message, source);

    // A direct invitation is very often "pricing request attached" with almost no body.
    // Classified on the body alone that reads as no_match and the tender is lost, so the
    // absence is called out in the excerpt where the classifier will see it.
    const note =
      message.hasAttachments && bodyText(message).trim().length < 400
        ? "This email has attachments and almost no body text — the scope is probably in the attachment."
        : undefined;
    return [singleItem(message, source, { note })];
  });
}

/** The SourceDefinition.fetch implementation for one mailbox source. */
export async function fetchMailboxSource(source: MailboxSource, sinceIso: string): Promise<FetchResult> {
  const messages = await fetchMailboxMessages(sinceIso);
  const mine = messages.filter((m) => routeSender(fromAddress(m)).slug === source.slug);

  return {
    // Stored before the parse is trusted, so a portal changing its digest format is
    // replayable rather than a week of lost tenders. Deliberately holds the messages only
    // — never the bearer token, and never the whole mailbox for a source that owns three
    // messages of it.
    raw: {
      mailbox: process.env.TENDER_MAILBOX,
      since: floorToHour(sinceIso),
      totalInWindow: messages.length,
      matchedThisSource: mine.length,
      messages: mine.slice(0, 25).map((m) => ({
        id: m.id,
        internetMessageId: m.internetMessageId,
        subject: m.subject,
        from: fromAddress(m),
        receivedDateTime: m.receivedDateTime,
        hasAttachments: m.hasAttachments,
        body: (m.body?.content ?? m.bodyPreview ?? "").slice(0, 40_000),
      })),
    },
    items: parseMessages(messages, source),
  };
}

/**
 * Proves the app registration is scoped to the one mailbox.
 *
 * Returns the status for a mailbox that is NOT ours. Anything other than 403 means
 * New-ApplicationAccessPolicy has not been applied and the app can read the whole
 * company's mail. Call this from a script against the deployed environment before
 * trusting the adapter; it is not wired into the scan, because a nightly probe of someone
 * else's mailbox is itself a bad idea.
 */
export async function assertMailboxScoped(otherMailbox: string): Promise<{ status: number; scoped: boolean }> {
  const token = await getGraphToken();
  const res = await fetch(
    `${GRAPH}/users/${encodeURIComponent(otherMailbox)}/messages?$top=1&$select=id`,
    { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" }
  );
  return { status: res.status, scoped: res.status === 403 };
}
