"use client";

// The colour key, over the live map.
//
// The exported PNG has always carried one (legendSvg in render-image.ts), but the map on screen
// did not — so the operator checking a drawing before it goes out was reading colours with no
// key, and so was anyone looking over their shoulder. Same rows, same colours, same order as
// the export, from the same two constants.

import { INSPECTION_LEGEND, type InspectionColor } from "@/lib/closeout-markup/types";
import { MARKUP_STYLES } from "@/lib/kml/standard-markup/style";

/** Fixed order, so every drawing of one job puts the same colour in the same place. */
const ORDER: InspectionColor[] = ["green", "red", "orange", "partial"];

export function MapLegend({ present }: { present: ReadonlySet<InspectionColor> }) {
  // Only the colours actually on the drawing — the export's rule too. A key explaining a colour
  // the reader cannot see invites "so which ones are those?".
  const rows = ORDER.filter((c) => present.has(c));
  if (rows.length === 0) return null;

  return (
    // Top-left, matching the exported legend's corner. Below the map-type toggle, which Google
    // puts in that corner too — hence the offset rather than the obvious inset-0.
    <div className="pointer-events-none absolute left-3 top-16 z-10 rounded-lg border border-ad-border bg-white/95 px-3 py-2 shadow-sm backdrop-blur-sm">
      <ul className="space-y-1.5">
        {rows.map((c) => (
          <li key={c} className="flex items-center gap-2 text-xs font-medium text-ad-ink">
            {/* The same two-tone as the lot: a part-inspected property is a green centre with
                an orange ring, so the swatch is drawn the same way rather than picking one. */}
            <span
              aria-hidden
              className="inline-block size-3.5 shrink-0 rounded-sm border-2"
              style={{
                backgroundColor: `#${MARKUP_STYLES[c].fill}`,
                borderColor: `#${MARKUP_STYLES[c].stroke}`,
              }}
            />
            {INSPECTION_LEGEND[c]}
          </li>
        ))}
      </ul>
    </div>
  );
}
