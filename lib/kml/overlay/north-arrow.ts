// Shared north arrow for map overlays, matching the Residential Mark Up compass exactly
// (same radius, offsets and brand blue) so a Road Markup and a Residential Mark Up sitting
// side by side in one report read as the same set of drawings.
//
// Static Maps images are always rendered north-up in these tools — no `heading` parameter
// is used anywhere — so this is a fixed icon with no orientation maths.

import { textToSvgPathsCentred } from "./text-path";

const COMPASS_BLUE = "46688a"; // ad-steel — the AusDilaps brand accent
const RADIUS = 32;
const MARGIN = 20;
const LABEL_SIZE = 20;
/** Arrow tip and base, and the "N" centre, as offsets from the circle's centre. */
const TIP_DY = -18;
const BASE_DY = -2;
const BASE_HALF_WIDTH = 10;
const LABEL_DY = 18;

/** Top-right compass. `nativeSize` is the width/height of the square image it sits on. */
export function northArrowSvg(nativeSize: number): string {
  const cx = nativeSize - MARGIN - RADIUS;
  const cy = MARGIN + RADIUS;

  return `<circle cx="${cx}" cy="${cy}" r="${RADIUS}" fill="white" fill-opacity="0.95" stroke="#${COMPASS_BLUE}" stroke-width="2.5" />
    <polygon points="${cx},${cy + TIP_DY} ${cx - BASE_HALF_WIDTH},${cy + BASE_DY} ${cx + BASE_HALF_WIDTH},${cy + BASE_DY}" fill="#${COMPASS_BLUE}" />
    ${textToSvgPathsCentred("N", { cx, cy: cy + LABEL_DY, fontSize: LABEL_SIZE, fill: COMPASS_BLUE })}`;
}
