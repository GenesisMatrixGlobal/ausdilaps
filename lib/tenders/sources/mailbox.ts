import { FETCH_TIMEOUT_MS } from "../config";
import { canonicalUrl, contentHash, externalRefForEmailLink, externalRefForMessage } from "../dedupe";
import { htmlToText } from "@/lib/html";
import {
  contentLinks,
  isSeededTrusted,
  resolveParseMode,
  senderDomain,
  slugForDomain,
  type ParseMode,
} from "../senders";
import type { FetchResult, RawItem, SourceDefinition } from "../types";

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

/**
 * A discovered email source, as stored in tender_sources.
 *
 * Everything the parser needs comes from the row now — no code table. An operator changing
 * parse_mode or is_trusted in the dashboard changes behaviour on the next run without a
 * deploy, which is the whole point of moving these off a hardcoded list.
 */
export type EmailSource = {
  slug: string;
  label: string;
  senderDomain: string;
  parseMode: ParseMode;
  isTrusted: boolean;
};

/** Plain text of a message body, whichever format Graph returned it in. */
function bodyText(message: GraphMessage): string {
  const raw = message.body?.content ?? message.bodyPreview ?? "";
  // htmlToText decodes entities BEFORE stripping tags — order matters, see lib/html.ts.
  return message.body?.contentType?.toLowerCase() === "html" ? htmlToText(raw, 12_000) : raw.slice(0, 12_000);
}


function fromAddress(message: GraphMessage): string | null {
  return message.from?.emailAddress?.address ?? null;
}

/** The HTML body, or "" when the message was plain text. */
function htmlBody(message: GraphMessage): string {
  return message.body?.contentType?.toLowerCase() === "html" ? (message.body.content ?? "") : "";
}

/**
 * A digest email → one item per tender link.
 *
 * Falls back to the whole email as one item when no content link is found. That fallback
 * is what makes the digest-biased detection in senders.ts safe: a single invitation
 * wrongly judged a digest lands here, finds nothing, and becomes the single item it always
 * should have been. Nothing is lost by guessing wrong in that direction.
 */
function parseDigest(message: GraphMessage, source: EmailSource): RawItem[] {
  const html = htmlBody(message);
  const text = bodyText(message);
  const from = fromAddress(message);

  const links = contentLinks(html, source.senderDomain);
  if (links.length === 0) {
    return [singleItem(message, source, { note: "read as a digest, but no tender links were found" })];
  }

  return links.map(({ href, text }) => {
    // The anchor text IS the tender title — contentLinks already had to read it to decide
    // the link was a tender at all, so re-scanning the HTML here would be a second pass
    // that could disagree with the first.
    const title = htmlToText(text || message.subject || "Untitled tender", 300);
    return {
      sourceSlug: source.slug,
      // Keyed on the LINK, never on position in the email — digests reorder between sends.
      externalRef: externalRefForEmailLink(source.slug, href),
      title,
      url: canonicalUrl(href),
      agency: null, // the classifier pulls this out of the body far more reliably
      publishedAt: message.receivedDateTime ?? null,
      closesAt: null,
      excerpt: text,
      contentHash: contentHash({ title, agency: null, closesAt: null }),
      emailMessageId: message.internetMessageId ?? message.id,
      emailFrom: from,
      senderTrusted: source.isTrusted,
    };
  });
}

/**
 * One email = one opportunity.
 *
 * Also the landing place for a digest that yielded no links, so the content is never
 * dropped just because the layout defeated the link matcher.
 */
function singleItem(
  message: GraphMessage,
  source: EmailSource,
  opts?: { note?: string; extraText?: string }
): RawItem {
  const from = fromAddress(message);
  const title = htmlToText(message.subject ?? "(no subject)", 300);
  const parts = [bodyText(message), opts?.extraText, opts?.note ? `[${opts.note}]` : null].filter(Boolean);

  return {
    sourceSlug: source.slug,
    externalRef: externalRefForMessage(message.internetMessageId ?? message.id),
    title,
    url: message.webLink ?? null,
    agency: source.senderDomain,
    publishedAt: message.receivedDateTime ?? null,
    closesAt: null,
    excerpt: parts.join("\n\n").slice(0, 14_000),
    contentHash: contentHash({ title, agency: source.senderDomain, closesAt: null }),
    emailMessageId: message.internetMessageId ?? message.id,
    emailFrom: from,
    senderTrusted: source.isTrusted,
  };
}

/** The messages in this mailbox that belong to one source. */
function messagesFor(messages: GraphMessage[], source: EmailSource): GraphMessage[] {
  return messages.filter((m) => senderDomain(fromAddress(m)) === source.senderDomain);
}

/**
 * Turns the messages this source owns into items.
 *
 * Parse mode is resolved PER MESSAGE, not per source. A portal that sends both a weekly
 * digest and one-off amendment notices is normal, and pinning the whole source to one mode
 * would mishandle half its mail. A stored 'digest'/'single' overrides detection, which is
 * the escape hatch when a portal's layout defeats the heuristic.
 *
 * Exported so it can be tested against saved messages with no tenant and no database.
 */
export function parseMessages(messages: GraphMessage[], source: EmailSource): RawItem[] {
  return messagesFor(messages, source).flatMap((message) => {
    const mode = resolveParseMode(source.parseMode, htmlBody(message), source.senderDomain);
    if (mode === "digest") return parseDigest(message, source);

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
export async function fetchMailboxSource(source: EmailSource, sinceIso: string): Promise<FetchResult> {
  const messages = await fetchMailboxMessages(sinceIso);
  const mine = messagesFor(messages, source);

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

// ── Discovery ──────────────────────────────────────────────────────────────────

type Db = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

type SourceRow = {
  slug: string;
  label: string;
  sender_domain: string | null;
  parse_mode: ParseMode;
  is_trusted: boolean;
  is_enabled: boolean;
};

/**
 * Create a source row for every sender domain in the mailbox that doesn't have one.
 *
 * This is what replaces the hardcoded portal list: a portal we signed up for last week
 * starts being tracked the first night it emails, with no code change and no migration.
 *
 * Runs BEFORE the source list is built, which is the whole reason it exists separately —
 * a brand-new domain has no row, so no source run would ever fetch its mail. It reuses the
 * memoised mailbox fetch, so discovery and every per-source run share one Graph call.
 *
 * New rows are deliberately quiet: alert_on_quiet false, because a one-off client
 * emailing once would otherwise read as 'critical' five nights later and drown the portals
 * that matter. Trust is seeded from TENDER_TRUSTED_SENDER_DOMAINS so known-good portals
 * don't need a manual toggle, and everything else starts unverified.
 *
 * Never throws: discovery failing must not stop the sources that already exist from
 * running. Returns the domains it added, for the run log.
 */
export async function discoverMailboxSources(db: Db, sinceIso: string): Promise<string[]> {
  if (!mailboxConfigured()) return [];

  try {
    const messages = await fetchMailboxMessages(sinceIso);
    const domains = [...new Set(messages.map((m) => senderDomain(fromAddress(m))).filter((d): d is string => !!d))];
    if (domains.length === 0) return [];

    const { data: existing } = await db
      .from("tender_sources")
      .select("slug")
      .in("slug", domains.map(slugForDomain));
    const known = new Set((existing ?? []).map((r) => r.slug as string));

    const fresh = domains.filter((d) => !known.has(slugForDomain(d)));
    if (fresh.length === 0) return [];

    const { error } = await db.from("tender_sources").upsert(
      fresh.map((domain) => ({
        slug: slugForDomain(domain),
        label: domain,
        kind: "email" as const,
        sender_domain: domain,
        auto_discovered: true,
        parse_mode: "auto",
        alert_on_quiet: false,
        is_trusted: isSeededTrusted(domain),
      })),
      { onConflict: "slug", ignoreDuplicates: true }
    );
    if (error) throw new Error(error.message);

    console.log(`[tenders] discovered ${fresh.length} new sender domain(s): ${fresh.join(", ")}`);
    return fresh;
  } catch (e) {
    console.error("[tenders] source discovery failed:", (e as Error).message);
    return [];
  }
}

/**
 * The email sources to run this scan, straight from the database.
 *
 * Unlike the RSS registry in sources.ts these are NOT code-owned, and that difference is
 * deliberate rather than sloppy. The reason feed URLs live in code is SSRF: a database
 * write must never be able to point a server-side fetch at an internal host. Nothing is
 * fetched from a discovered domain — it is only a filter applied to mail we already hold —
 * so the argument does not bind here.
 */
export async function loadEmailSources(db: Db): Promise<SourceDefinition[]> {
  if (!mailboxConfigured()) return [];

  const { data, error } = await db
    .from("tender_sources")
    .select("slug, label, sender_domain, parse_mode, is_trusted, is_enabled")
    .eq("kind", "email")
    .eq("is_enabled", true);

  if (error) {
    console.error("[tenders] couldn't load email sources:", error.message);
    return [];
  }

  return (data ?? [])
    .filter((r): r is SourceRow => !!(r as SourceRow).sender_domain)
    .map((row) => {
      const source: EmailSource = {
        slug: row.slug,
        label: row.label,
        senderDomain: row.sender_domain!,
        parseMode: row.parse_mode ?? "auto",
        isTrusted: row.is_trusted ?? false,
      };
      return {
        slug: source.slug,
        label: source.label,
        kind: "email" as const,
        configured: mailboxConfigured,
        fetch: (since: string) => fetchMailboxSource(source, since),
      };
    });
}
