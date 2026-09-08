"use client";

// "Look at this from the road" — used twice: once per row in the Quote Line Item sheet, and
// once at markup level for the address that was entered.
//
// A plain anchor, deliberately. Everything that would make it smarter needs the position of the
// Street View camera, which is a metadata lookup that either costs money or needs an API we
// don't have switched on — see the long note in lib/maps/street-view.ts.

import { cn } from "@/lib/utils";
import { streetViewUrl } from "@/lib/maps/street-view";
import type { LatLng } from "@/lib/kml/types";

function EyeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden className="shrink-0">
      <path
        d="M0.9 7C2.4 4.4 4.5 3.1 7 3.1s4.6 1.3 6.1 3.9c-1.5 2.6-3.6 3.9-6.1 3.9S2.4 9.6 0.9 7z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="7" r="1.7" fill="currentColor" />
    </svg>
  );
}

/**
 * `at` null — a layer with too little geometry to have a centre, or an address not yet
 * resolved — renders the same box greyed rather than nothing, so a table column doesn't jitter
 * row to row and a toolbar doesn't reflow when a snapshot lands.
 *
 * `tabbable` is false inside the sheet. That grid's whole point is spreadsheet keyboard
 * behaviour — tab across, type, tab on — and an anchor with an href would put a stop between
 * every Street and Suburb cell. It stays a mouse affordance there; the toolbar's copy is
 * reachable by keyboard.
 */
export function StreetViewLink({
  at,
  label,
  className,
  iconSize,
  tabbable = true,
  children,
}: {
  at: LatLng | null;
  /** What the operator would call this thing, for the hover title and the screen reader. */
  label: string;
  className?: string;
  iconSize?: number;
  tabbable?: boolean;
  children?: React.ReactNode;
}) {
  const content = (
    <>
      <EyeIcon size={iconSize} />
      {children}
    </>
  );
  if (!at) {
    return (
      <span className={cn(className, "cursor-not-allowed opacity-40")} title="No location yet">
        {content}
      </span>
    );
  }
  return (
    <a
      href={streetViewUrl(at)}
      target="_blank"
      rel="noopener noreferrer"
      tabIndex={tabbable ? undefined : -1}
      title={`Street View — ${label}`}
      aria-label={`Open Street View at ${label}`}
      className={className}
    >
      {content}
    </a>
  );
}
