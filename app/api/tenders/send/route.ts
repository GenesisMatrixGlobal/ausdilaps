import { replyableSender } from "@/lib/tenders/display";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccess, getStaffUser, isAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { TENDER_WATCH_ALLOW_UNAUTHED_ENV, TENDER_WATCH_DEPARTMENTS } from "@/lib/tenders/config";
import { displayTitle, groupItems } from "@/lib/tenders/group";
import { sendHandoff, type HandoffItem } from "@/lib/tenders/notify";
import { allocateHandoff, pushHandoffsToSalesforce } from "@/lib/tenders/handoff-store";
import { loadTenderSummary } from "@/lib/tenders/summary";

/**
 * Hand the selected opportunities to the team, or dismiss them.
 *
 * This is what replaced the automatic nightly digest. A person ticks what is real and sends
 * it, which is a better gate than the three env vars the unattended version needed to be
 * safe (TENDER_FORWARD_ENABLED, TENDER_FORWARD_UNTRUSTED and a trusted-sender list, all now
 * removed).
 *
 * Department-gated, not admin-gated. Anyone who can already read this tool can already read
 * every tender and click every link in it, and the recipient is our own internal address —
 * so sending is not an escalation of what they can see. Restricting it to admins would mean
 * the queue only ever moves when one person sits down with it, which is how a tool like this
 * quietly stops being used.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  action: z.enum(["send", "dismiss"]),
  /**
   * Every member row of every selected group, not just the leads.
   *
   * The client sends ids rather than group keys because a key is derived from the title and
   * agency — data that a re-scan can legitimately change between the page rendering and the
   * button being pressed. Ids cannot drift.
   */
  itemIds: z.array(z.string().uuid()).min(1).max(200),
  note: z.string().trim().max(600).optional(),
  /**
   * A dry run: mail it to the signed-in user instead of the team, and DON'T consume the
   * queue — the whole point is to look at the email before anyone else does.
   *
   * Note there is deliberately no way to name a recipient. The address comes from the
   * session (`user.email`) and nothing here influences it, because an endpoint that renders
   * our tender pipeline into an email from our own signed domain must never accept an
   * arbitrary destination.
   */
  toSelf: z.boolean().optional(),
});

/** The first non-empty value across a group's members, most confident copy first. */
function firstOf<T>(members: T[], pick: (m: T) => string | null | undefined): string | null {
  for (const m of members) {
    const v = pick(m)?.trim();
    if (v) return v;
  }
  return null;
}

/** The group's reply-to address. The RULE lives in lib/tenders/display.ts so the card and
 *  the email cannot disagree about who to contact — they did, until 2026-10-01. */
function senderContact<T extends { row: Record<string, unknown> }>(members: T[]): string | null {
  for (const m of members) {
    const from = replyableSender(m.row.email_from as string | null);
    if (from) return from;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const user = await getStaffUser();

  // The dev-only hatch mirrors the read route so the tool is testable locally without a
  // Supabase session. Hard-gated on NODE_ENV, exactly as isStaffInAnyDepartment does it —
  // this route WRITES and sends email, so it must never be open in production.
  const devHatch =
    process.env.NODE_ENV !== "production" && process.env[TENDER_WATCH_ALLOW_UNAUTHED_ENV] === "true";

  const allowed =
    devHatch ||
    (!!user && (isAdmin(user) || TENDER_WATCH_DEPARTMENTS.some((slug) => canAccess(user, slug))));

  if (!allowed) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  const { action, itemIds, note, toSelf } = parsed.data;

  const db = createAdminClient();
  const now = new Date().toISOString();

  try {
    // Re-read from the database rather than trusting anything the client described. The
    // request carries ids and nothing else, so a caller cannot influence what the email
    // says about a tender — only which rows are acted on.
    const { data: rows, error } = await db
      .from("tender_items")
      .select(
        // ⚠️ email_from is load-bearing, not decoration: senderContact() reads it to work out the
        // reply-to for a direct invitation. It was MISSING from this list, so `m.row.email_from`
        // was always undefined and every handoff said a bare "Invitation by email" with no way
        // to reach anyone. Silent, because reading an unselected column is undefined, not an error.
        "id, title, agency, site_location, contact, url, closes_at, relevance, confidence, services, model_summary, source_slug, sender_trusted, injection_suspected, forwarded_at, status, email_from"
      )
      .in("id", itemIds)
      .in("relevance", ["match", "maybe"]);

    if (error) throw new Error(error.message);
    if (!rows?.length) {
      return NextResponse.json({ ok: false, error: "Nothing to act on." }, { status: 400 });
    }

    // ── Dismiss ───────────────────────────────────────────────────────────
    if (action === "dismiss") {
      const { error: updateError } = await db
        .from("tender_items")
        .update({
          status: "archived",
          reviewed_by: user?.id ?? null,
          reviewed_at: now,
          review_note: note ?? null,
        })
        .in(
          "id",
          rows.map((r) => r.id)
        );
      if (updateError) throw new Error(updateError.message);

      return NextResponse.json({
        ok: true,
        dismissed: rows.length,
        ...(await loadTenderSummary(!!user && isAdmin(user))),
      });
    }

    // ── Send ──────────────────────────────────────────────────────────────
    //
    // Already-sent rows are dropped rather than rejected. Two people can have the tool open
    // at once, and re-sending a job the other just handed over is noise; failing the whole
    // request over it would also block the rows that ARE new.
    const fresh = rows.filter((r) => r.forwarded_at === null && r.status !== "archived");
    if (fresh.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Those have already been sent or dismissed." },
        { status: 409 }
      );
    }

    // Grouped with the SAME function the screen uses, so the email cannot itemise the queue
    // differently from the page the sender was looking at.
    // Kept as a variable because the handoff code is allocated per GROUP, and g.key is the
    // only stable identity for one — the members are a read-time collapse, not a stored set.
    const groups = groupItems(
      fresh.map((r) => ({
        id: r.id as string,
        title: r.title as string,
        agency: (r.agency as string | null) ?? null,
        closesAt: (r.closes_at as string | null) ?? null,
        confidence: (r.confidence as number | null) ?? null,
        row: r,
      }))
    );

    const items: HandoffItem[] = groups.map((g) => {
      const bySource = new Map<string, { label: string; url: string | null }>();
      for (const m of [...g.members].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))) {
        const slug = m.row.source_slug as string;
        if (!bySource.has(slug)) bySource.set(slug, { label: slug, url: (m.row.url as string | null) ?? null });
      }

      return {
        ids: g.members.map((m) => m.id),
        title: displayTitle({
          title: g.lead.title,
          agency: g.lead.agency,
          summary: g.lead.row.model_summary as string | null,
        }),
        agency: g.lead.agency,
        // Read off the lead, but fall back across the group: a reminder often omits the
        // location the original notice carried, and whichever copy leads is not necessarily
        // the most complete one.
        siteLocation: firstOf(g.members, (m) => m.row.site_location as string | null),
        contact: firstOf(g.members, (m) => m.row.contact as string | null) ?? senderContact(g.members),
        // The raw sender too, so a robot address can still be shown as provenance when
        // there is no contact at all — renderItem decides "reply to" vs "via".
        emailFrom: firstOf(g.members, (m) => m.row.email_from as string | null),
        closesAt: g.lead.closesAt,
        // A group is only "review" if EVERY copy was a maybe — one confident match in the
        // set means the job is a match, whatever the weaker duplicates said.
        relevance: g.members.some((m) => m.row.relevance === "match") ? "match" : "maybe",
        confidence: g.lead.confidence,
        services: (g.lead.row.services as string[]) ?? [],
        summary: (g.lead.row.model_summary as string | null) ?? null,
        seenCount: g.count,
        sources: [...bySource.values()],
        senderTrusted: g.members.some((m) => m.row.sender_trusted === true),
        injectionSuspected: g.members.some((m) => m.row.injection_suspected === true),
      } satisfies HandoffItem;
    });

    // ── Handoff codes ──
    //
    // Allocated BEFORE the email is rendered, because the code is the most useful thing in
    // it. Allocation is keyed on the group and idempotent, so previewing to yourself and
    // then sending for real produce the SAME code — otherwise the copy you read and the
    // record in Salesforce would disagree.
    //
    // ⚠️ Never blocks the send. allocateHandoff returns null on any failure and the block
    // simply renders without a Code row: a handoff email with no code is worth far more than
    // no handoff email.
    const withCodes = await Promise.all(
      items.map(async (item, i) => {
        const handoff = await allocateHandoff(item, groups[i].key, user?.id ?? null, groups[i].mergedKeys);
        return { ...item, handoffCode: handoff?.code ?? null } satisfies HandoffItem;
      })
    );

    const sentBy = user?.fullName ?? user?.email ?? null;

    // A dry run needs an address to send to, and the session is the only source for it.
    if (toSelf && !user?.email) {
      return NextResponse.json(
        { ok: false, error: "Can't send you a copy — this session has no email address." },
        { status: 400 }
      );
    }

    const result = await sendHandoff({
      items: withCodes,
      note,
      sentBy,
      testMode: process.env.TENDER_TEST_MODE === "true",
      onlyTo: toSelf ? user!.email : null,
    });

    // Send FIRST, mark second. The reverse order risks a row that looks handed over but
    // never was — a silent miss — while this order risks a duplicate email, which is noisy
    // and obvious. For a business where a missed tender is a lost job, that is not a close
    // call. The Idempotency-Key in sendHandoff() closes most of the duplicate window.
    if (!result.sent) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error ?? "Send failed.",
          ...(await loadTenderSummary(!!user && isAdmin(user))),
        },
        { status: 502 }
      );
    }

    // ⚠️ On a PREVIEW too, not just the real send.
    //
    // The code is allocated either way (allocateHandoff is idempotent on the group), so a
    // preview whose codes do not resolve in Salesforce is a preview of something that does
    // not exist — you cannot test the flow with it, and the first real send would be the
    // first time anyone found out. The record is reference data keyed by the code; creating
    // it early costs nothing and is what makes "send to me first" an honest rehearsal.
    //
    // Awaited rather than fired and forgotten: a Vercel function can be frozen the moment it
    // responds, so a floating promise would land sometimes and not others. It never throws —
    // a failure is recorded on the row as sf_error and the email has already gone.
    await pushHandoffsToSalesforce(
      withCodes.map((i) => i.handoffCode).filter((c): c is string => !!c)
    );

    // A dry run leaves the queue exactly as it was. Marking rows handed over because
    // somebody previewed the email would be the worst of both outcomes: the opportunities
    // vanish from the queue and nobody on the team ever received them.
    if (toSelf) {
      return NextResponse.json({
        ok: true,
        sent: items.length,
        rows: fresh.length,
        toSelf: true,
        ...(await loadTenderSummary(!!user && isAdmin(user))),
      });
    }

    const { error: markError } = await db
      .from("tender_items")
      .update({ forwarded_at: now, forward_error: null, reviewed_by: user?.id ?? null, reviewed_at: now })
      .in(
        "id",
        fresh.map((r) => r.id)
      );

    // The email is already out. Reporting a failure here would have the operator send it
    // again; saying so plainly is the honest outcome.
    if (markError) {
      console.error("[tenders] handoff sent but marking failed:", markError.message);
      return NextResponse.json(
        {
          ok: true,
          sent: items.length,
          warning:
            "The email was sent, but these could not be marked as handed over — they will still show in the queue.",
          ...(await loadTenderSummary(!!user && isAdmin(user))),
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      ok: true,
      sent: items.length,
      rows: fresh.length,
      ...(await loadTenderSummary(!!user && isAdmin(user))),
    });
  } catch (e) {
    const error = (e as Error).message;
    console.error("[tenders] send failed:", error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
