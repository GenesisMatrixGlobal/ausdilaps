"use client";

import { useLinkStatus } from "next/link";
import { cn } from "@/lib/utils";

/**
 * Wraps a link's LABEL and puts a small orange dot beside it that pulses while the navigation
 * that link started is still waiting on the server. It answers "did my click register?" —
 * nothing more, so no text: `<Link href="/admin"><LinkPending>Overview</LinkPending></Link>`.
 *
 * app/admin/loading.tsx only shows when the target's prefetched route tree is cached and fresh.
 * After ~5 minutes idle, straight after a hard load, coming in from the staff portal (no loading
 * boundary above the admin segment), or on a ?month= link that keeps the same segment, a click
 * changes nothing on screen until the server answers — which is what read as a frozen page.
 * `useLinkStatus` goes pending on EVERY click, cached or not, so this covers all of those.
 *
 * ⚠️ Must be rendered INSIDE a `<Link>` — the hook reads that Link's context, and anywhere else
 * it is permanently idle. A server component can still use it: it is just the Link's child.
 *
 * The dot is absolutely positioned so it takes NO space: always rendered, so nothing shifts when
 * it appears, and a tab's width — and so its underline — is exactly what it was. Its containing
 * block is the LABEL (the relative span), not the Link, so it centres on the text even when the
 * Link is stretched taller than its text (the admin tabs, once one label wraps on a phone).
 * There is deliberately no left/right offset: an absolute box with none keeps its STATIC
 * position, i.e. exactly where it would have sat inline — just after the label for "end", just
 * before it for "start" (pulled clear by the negative margin). So it always lands 4px off the
 * text, however long the label is.
 *
 * Fades in only after 120ms, so a cached navigation, which finishes inside a frame or two,
 * never flashes it; fades out at once. The fade and the pulse are on SEPARATE elements because
 * both drive opacity, and on one element the transition and the animation fight over it.
 */
export function LinkPending({
  children,
  side = "end",
}: {
  children: React.ReactNode;
  /** "start" where the space after the label is someone else's (a tight row of header links). */
  side?: "start" | "end";
}) {
  const { pending } = useLinkStatus();
  const dot = (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute top-1/2 size-1.5 -translate-y-1/2 transition-opacity duration-150",
        side === "start" ? "-ml-2.5" : "ml-1",
        pending ? "opacity-100 delay-120" : "opacity-0"
      )}
    >
      <span
        className={cn("block size-full rounded-full bg-ad-orange", pending && "motion-safe:animate-pulse")}
      />
    </span>
  );

  return (
    <span className="relative">
      {side === "start" && dot}
      {children}
      {side === "end" && dot}
    </span>
  );
}
