// Cover photo framing check. Pure: no env, no network.
//
//   npm run check:cover
//
// The one thing that can go wrong here silently is the aspect ratio. planTiles() frames an
// extra strip of ground along the bottom for Google's attribution bar, so a box whose GROUND
// is 600:442 renders slightly too tall — and the final resize to 600x442 would then be a
// vertical squash nobody would spot on an aerial photo. coverFrameBounds() pre-compensates
// for that, and this asserts it worked, at real parcel sizes and at the latitudes the
// business actually operates in (Mercator's scale varies with latitude, so one test city
// proves nothing). Exits non-zero on any failure.

import type { LatLng } from "@/lib/kml/types";
import { mercatorSpan } from "@/lib/kml/standard-markup/projection";
import { planTiles } from "@/lib/maps/static-map-plan";
import { MIN_FRAME_METRES, coverFrameBounds, coverViewFor } from "@/lib/cover-photo/frame";
import { COVER_ASPECT, COVER_HEIGHT_PX, COVER_WIDTH_PX } from "@/lib/cover-photo/style";

let failures = 0;
function fail(msg: string) {
  failures++;
  console.error(`✗ ${msg}`);
}
function ok(actual: boolean, what: string) {
  if (!actual) fail(what);
}

/** A rectangular lot `widthM` x `depthM`, centred on the given point. */
function lot(centre: LatLng, widthM: number, depthM: number): LatLng[] {
  const dLat = depthM / 111_320;
  const dLng = widthM / (111_320 * Math.cos((centre.lat * Math.PI) / 180));
  return [
    { lat: centre.lat - dLat / 2, lng: centre.lng - dLng / 2 },
    { lat: centre.lat - dLat / 2, lng: centre.lng + dLng / 2 },
    { lat: centre.lat + dLat / 2, lng: centre.lng + dLng / 2 },
    { lat: centre.lat + dLat / 2, lng: centre.lng - dLng / 2 },
  ];
}

const CITIES: [string, LatLng][] = [
  ["Brisbane", { lat: -27.4698, lng: 153.0251 }],
  ["Sydney", { lat: -33.8688, lng: 151.2093 }],
  ["Melbourne", { lat: -37.8136, lng: 144.9631 }],
  // The extremes the cadastre adapters cover, where Mercator's scale differs most.
  ["Cairns", { lat: -16.9186, lng: 145.7781 }],
  ["Hobart-ish", { lat: -42.8821, lng: 147.3272 }],
];

// A suburban block, a wide corner lot, a deep battleaxe, a small strata footprint and an
// industrial parcel — the shapes a cover photo actually gets asked for.
const SHAPES: [string, number, number][] = [
  ["suburban 15x45", 15, 45],
  ["wide corner 40x25", 40, 25],
  ["deep battleaxe 10x70", 10, 70],
  ["small strata 9x12", 9, 12],
  ["industrial 180x120", 180, 120],
  ["rural 400x400", 400, 400],
];

console.log(`Target ${COVER_WIDTH_PX}x${COVER_HEIGHT_PX} (aspect ${COVER_ASPECT.toFixed(4)})\n`);

for (const [city, centre] of CITIES) {
  for (const [name, w, d] of SHAPES) {
    const ring = lot(centre, w, d);
    const view = coverViewFor(ring);
    if (!view) {
      fail(`${city} ${name}: coverViewFor returned null for a 4-point ring`);
      continue;
    }

    // 1. The initial view is at the target aspect.
    const v = mercatorSpan(view);
    const viewAspect = v.spanX / v.spanY;
    ok(
      Math.abs(viewAspect - COVER_ASPECT) < 1e-9,
      `${city} ${name}: initial view aspect ${viewAspect.toFixed(4)} != ${COVER_ASPECT.toFixed(4)}`
    );

    // 2. The parcel is inside it, with room to spare. A cover photo whose subject touches
    //    the edge has no context, which is the whole reason for the margin and the floor.
    const r = mercatorSpan({
      north: Math.max(...ring.map((p) => p.lat)),
      south: Math.min(...ring.map((p) => p.lat)),
      east: Math.max(...ring.map((p) => p.lng)),
      west: Math.min(...ring.map((p) => p.lng)),
    });
    ok(
      v.spanX > r.spanX * 1.2 && v.spanY > r.spanY * 1.2,
      `${city} ${name}: view is not comfortably bigger than the parcel`
    );

    // 3. The RENDERED PLAN lands on the target aspect. This is the assertion that matters:
    //    it is what makes the resize to 600x442 a scale rather than a stretch.
    //
    //    Measured as RELATIVE aspect error, not pixels. planTiles rounds BOTH dimensions up
    //    to an even number of logical pixels, so a few pixels of drift is structural and
    //    grows with the frame — on a 1200px plan it is a rounding artefact, on a 300px plan
    //    it would be real. 0.5% is the bar: a stretch that small is invisible on an aerial
    //    photo, and anything larger means the pad compensation has stopped working.
    const bounds = coverFrameBounds(view);
    const plan = planTiles(bounds);
    const planAspect = plan.width / plan.height;
    const error = Math.abs(planAspect - COVER_ASPECT) / COVER_ASPECT;
    ok(
      error < 0.005,
      `${city} ${name}: plan ${plan.width}x${plan.height} (aspect ${planAspect.toFixed(4)}) is ${(error * 100).toFixed(2)}% off target`
    );

    // 4. Nothing the operator framed is cropped away by the aspect fit.
    const b = mercatorSpan(bounds);
    ok(
      b.spanX >= v.spanX - 1e-9 && b.spanY >= v.spanY - 1e-9,
      `${city} ${name}: export frame is smaller than the view — something framed was cropped`
    );

    // 5. The resize is a DOWNSCALE, so the output is supersampled rather than blown up.
    ok(
      plan.width * 2 >= COVER_WIDTH_PX,
      `${city} ${name}: rendered ${plan.width * 2}px wide, below the ${COVER_WIDTH_PX}px output`
    );
  }
}

// The metre floor. The contract is "never tighter than MIN_FRAME_METRES across", which is
// what keeps the street and the neighbours in shot on a small block — NOT that two small lots
// come out identical, which stops being true as soon as one of them is deep enough to drive
// the frame itself.
for (const [city, centre] of CITIES) {
  for (const [name, w, d] of SHAPES) {
    const view = coverViewFor(lot(centre, w, d))!;
    const lat = (view.north + view.south) / 2;
    const metres = (view.east - view.west) * 111_320 * Math.cos((lat * Math.PI) / 180);
    ok(
      metres >= MIN_FRAME_METRES - 0.5,
      `${city} ${name}: frame is ${metres.toFixed(0)}m across, under the ${MIN_FRAME_METRES}m floor`
    );
  }
}

// The toolbar's Zoom control: in is tighter, out is wider, and neither breaks the aspect the
// whole render depends on.
{
  const ring = lot(CITIES[0][1], 15, 45);
  const base = mercatorSpan(coverViewFor(ring, 0)!);
  const tighter = mercatorSpan(coverViewFor(ring, 2)!);
  const wider = mercatorSpan(coverViewFor(ring, -2)!);
  ok(tighter.spanX < base.spanX, "zoom in should tighten the frame");
  ok(wider.spanX > base.spanX, "zoom out should widen the frame");
  for (const [label, span] of [["in", tighter], ["out", wider]] as const) {
    ok(
      Math.abs(span.spanX / span.spanY - COVER_ASPECT) < 1e-9,
      `zoom ${label} should keep the report aspect`
    );
  }
  // A zoomed frame still has to render at the template's aspect, or the resize stretches it.
  for (const step of [-2, -1, 1, 2, 4]) {
    const plan = planTiles(coverFrameBounds(coverViewFor(ring, step)!));
    const error = Math.abs(plan.width / plan.height - COVER_ASPECT) / COVER_ASPECT;
    ok(error < 0.005, `zoom step ${step}: plan ${plan.width}x${plan.height} is ${(error * 100).toFixed(2)}% off target`);
  }
}

ok(coverViewFor([]) === null, "an empty ring has no frame");
ok(coverViewFor([{ lat: -27, lng: 153 }, { lat: -27.001, lng: 153 }]) === null, "two points are not a ring");

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("✓ cover photo framing lands on the report template's aspect at every tested size and latitude");
