"use client";

// The API cost counter a tool shows about itself: what THIS session has spent so far, and what
// the tool has spent this month across everyone — the second figure read from the same rows
// /admin/usage shows, so the two never disagree. Admins get a link through to the dashboard,
// opened on this tool's breakdown.
//
// One muted line. It is context for the operator, not a control, so it takes no space beyond
// the words. Mount it in a tool's toolbar row with the session figures the tool already has.

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatCents } from "@/lib/format-cents";

type MonthUsage = { ok: boolean; monthLabel?: string; calls?: number; costCents?: number };

export function ToolSpend({
  slug,
  sessionCents,
  sessionCount = 0,
  /** What one unit of `sessionCount` is — "file", "markup", "lookup". */
  unit = "item",
  /** For a tool whose routes don't hand back a per-action cost: bump this after each paid
   *  action and the month figure refetches. With `sessionCents` given it is not needed. */
  refreshKey = 0,
  isAdmin,
}: {
  slug: string;
  /** Omit when the tool cannot price its own session; the line then shows the month only. */
  sessionCents?: number;
  sessionCount?: number;
  unit?: string;
  refreshKey?: number;
  isAdmin?: boolean;
}) {
  const [month, setMonth] = useState<MonthUsage | null>(null);

  // Fetched once on mount and again whenever the session total (or refreshKey) moves — a
  // finished action has just added a row, and the month figure should include it.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tools/usage?tool=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((j: MonthUsage) => {
        if (!cancelled) setMonth(j);
      })
      .catch(() => {
        if (!cancelled) setMonth({ ok: false });
      });
    return () => {
      cancelled = true;
    };
  }, [slug, sessionCents, refreshKey]);

  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (sessionCents !== undefined && sessionCount > 0) parts.push(`This session: ${formatCents(sessionCents)} · ${plural(sessionCount, unit)}`);
  if (month?.ok && month.monthLabel) {
    parts.push(`${month.monthLabel}: ${formatCents(month.costCents ?? 0)} · ${plural(month.calls ?? 0, "API call")}`);
  }
  if (!parts.length) return null;

  return (
    <p className="text-xs text-ad-muted">
      API cost — {parts.join(" · ")}
      {isAdmin && (
        <>
          {" · "}
          <Link href={`/admin/usage?tool=${encodeURIComponent(slug)}`} className="underline decoration-dotted hover:text-ad-ink">
            all tools
          </Link>
        </>
      )}
    </p>
  );
}
