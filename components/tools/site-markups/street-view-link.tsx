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

/** Google's pegman amber. */
const PEGMAN_YELLOW = "#FDBE02";

/**
 * Google's pegman, in Google's yellow.
 *
 * Hard-coded colours rather than `currentColor`: this is a recognised third-party mark, and the
 * whole reason to draw a little yellow figure instead of a generic glyph is that an estimator
 * already knows what it does. It therefore does NOT tint on hover — the surrounding button
 * does that instead.
 *
 * The dark visor is what makes it read as a person at 14px; without it the silhouette is just a
 * yellow blob.
 */
function PegmanIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="shrink-0">
      <circle cx="8" cy="3.5" r="2.8" fill={PEGMAN_YELLOW} />
      <path
        d="M5.3 3.7h5.4"
        stroke="#33373b"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* Shoulders wide, torso tapering — the arms-out stance is most of the recognition. */}
      <path d="M3.3 11.9V10.2C3.3 7.7 5.4 6.1 8 6.1s4.7 1.6 4.7 4.1v1.8z" fill={PEGMAN_YELLOW} />
      <rect x="5.2" y="11.5" width="2.1" height="3.6" rx="1" fill={PEGMAN_YELLOW} />
      <rect x="8.7" y="11.5" width="2.1" height="3.6" rx="1" fill={PEGMAN_YELLOW} />
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
      <PegmanIcon size={iconSize} />
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
