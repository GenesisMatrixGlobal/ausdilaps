// Reads a photographed hand sketch into a structured FloorPlan via Claude vision.
//
// Env-gated: no ANTHROPIC_API_KEY -> the tool still works, you just build the plan by hand
// in the editor instead of starting from a draft.
//
// Opus rather than the Haiku used by the other vision helpers in this repo: those read a
// short code off a tight crop, this reasons about a whole spatial layout.
//
// Measured: a 10-room house sketch ~50s / 3.6k out; a 29-room commercial fire-exit plan
// ~166s / 13.7k out; a busy hand sketch ~169s / 12.6k out. So single-digit-to-~25c a plan,
// against the ~13 minutes the same drawing takes by hand in EdrawMax.
//
// Do NOT downscale the image to save time. Halving the long edge to 1568px cut the run to
// ~93s, but the compass — a small scribble in a page corner — stopped being legible and north
// came back as 225 degrees instead of 180, with doors dropping 26 -> 12. Input tokens fell
// 6.5k -> 4.1k on the same page, which shows the API was not already downscaling these.

import { repairInteriorGaps } from "./grid";
import { OUTSIDE, type Door, type FloorPlan, type Room } from "./types";

const MODEL = process.env.ANTHROPIC_FLOOR_PLAN_MODEL ?? "claude-opus-5";

export function visionConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

const rectProps = {
  type: "object",
  properties: {
    x: { type: "integer" },
    y: { type: "integer" },
    w: { type: "integer" },
    h: { type: "integer" },
  },
  required: ["x", "y", "w", "h"],
  additionalProperties: false,
} as const;

const SCHEMA = {
  type: "object",
  properties: {
    address: { type: "string", description: "Street address exactly as written on the sketch. Empty string if none." },
    suburb: { type: "string", description: "Suburb ONLY if written on the sketch. Empty string otherwise." },
    northDegrees: {
      type: "integer",
      enum: [0, 90, 180, 270],
      description:
        "Direction north points on the plan you are returning. 0 = toward the top of your grid, 90 = right, 180 = bottom, 270 = left.",
    },
    northNote: {
      type: "string",
      description:
        "Which compass marks you saw and which way each pointed in the photo, for a human to check.",
    },
    grid: {
      type: "object",
      properties: { w: { type: "integer" }, h: { type: "integer" } },
      required: ["w", "h"],
      additionalProperties: false,
    },
    levels: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          rooms: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                kind: {
                  type: "string",
                  enum: ["room", "outdoor"],
                  description: "\"outdoor\" for yard, driveway, carport, canopy, parking, assembly area.",
                },
                rects: { type: "array", items: rectProps },
              },
              required: ["label", "kind", "rects"],
              additionalProperties: false,
            },
          },
          doors: {
            type: "array",
            items: {
              type: "object",
              properties: {
                betweenA: { type: "string", description: "Room label, or 'outside'" },
                betweenB: { type: "string", description: "Room label, or 'outside'" },
                confidence: { type: "string", enum: ["visible", "inferred"] },
              },
              required: ["betweenA", "betweenB", "confidence"],
              additionalProperties: false,
            },
          },
        },
        required: ["name", "rooms", "doors"],
        additionalProperties: false,
      },
    },
  },
  required: ["address", "suburb", "northDegrees", "northNote", "grid", "levels"],
  additionalProperties: false,
} as const;

// The "do not invent" rules are load-bearing, not boilerplate. On the reference sketch an
// earlier version of this prompt returned suburb "Marleston" — reasoned from the street name
// "Marleston Ave", written nowhere on the page. These drawings go into dilapidation reports.
const PROMPT = `This is a photograph of a building floor plan, taken on site by a building
inspector. It is one of:

- a hand-drawn sketch in pen, usually on ruled notebook paper; or
- a printed plan — an architectural drawing, a fire-exit or evacuation plan, a tenancy plan —
  often with the inspector's own notes added on top in pen.

The page may have been photographed at any angle: sideways, upside down, or skewed by the
camera. Work out which way up the page is meant to be read, then read it in that orientation.

IGNORE anything that is not part of the building: the printed horizontal rules of notebook
paper, faint text showing through from the reverse of the page, the surface the page is
resting on, and fingers holding it. On a printed plan, ignore the title block, the legend,
the scale bar, and fire-safety symbols (exit arrows, fire reels, extinguishers, assembly
points) — those are not rooms.

Treat the plan as a schematic layout: rooms are adjoining rectangles.

Return the layout on an integer grid:

- Choose grid.w and grid.h (each between 12 and 40) so the grid's proportions roughly match
  the drawn building's proportions. A long, wide building should get a wide grid.
- Place every room as one or more integer rectangles on that grid. x,y is the top-left cell,
  measured from the top-left of the grid. Use several rects for an L-shaped room.
- Adjacent rooms must SHARE an edge exactly — no overlaps, and no accidental gaps between
  rooms that are drawn touching. Getting adjacency right matters more than exact proportions.
- Keep the rooms in the same relative positions as drawn on the page. Do not rotate the plan
  to make north point up.

Room labels: expand the inspector's shorthand to normal title case — "bed 2" becomes
"Bedroom 2", "bath" becomes "Bathroom", "laundry" becomes "Laundry". A label sitting outside
the plan with an arrow pointing into a room belongs to the room it points at. Where a label
has been crossed out and rewritten, use the replacement. Do not add rooms that are not drawn.

Some plans write measurements inside each room, like "4.8 x 2.6" or "5.2x4.0". These are NOT
part of the label — leave them out entirely. A room labelled "Office 4.8 x 2.6" is just
"Office". If that leaves two rooms with the same name, number them: "Office 1", "Office 2".

Set kind to "outdoor" for anything that is not enclosed building interior — front yard, back
yard, driveway, carport, canopy, hard stand, parking, assembly area, courtyard, deck. Set it
to "room" for everything else, including garages, sheds and warehouses, which are enclosed.

Doors: list them as a pair of room labels that the doorway connects, or a room label and
"outside" for an external door. Mark confidence "visible" ONLY where the sketch actually
shows a gap, arc or door mark in a wall. Use "inferred" if you are filling in a doorway that
must logically exist but is not drawn. Do not guess wildly — an empty list is fine.

North: work out which way up the page reads, place the rooms in that orientation, then report
northDegrees against THAT SAME orientation — 0 = north points toward the top of your grid,
90 = right, 180 = bottom, 270 = left. If you turned the page to read it, the compass turns
with it by the same amount.

Read the compass carefully first: the arrows often do NOT follow the usual convention, and the
N arrow may point any way at all. If N is not drawn but S is, take the opposite of S.

Two things make this harder than it looks, and both have produced wrong answers:

- The compass is often sketched with the notebook turned, so its letters sit at an angle to
  the plan and read sideways. Judge each direction from WHERE THE ARROWHEAD POINTS, never from
  which way the letters read.
- An arrow may be crossed out and redrawn. Use the surviving one and say so in northNote.

Sanity-check before answering: the arrows should form a consistent compass — N opposite S,
E opposite W, each pair at right angles. If yours does not, look again.

In northNote, say which rotation you applied to the page and which way each compass arrow
pointed, so a human can check the answer instead of trusting it.

Address and suburb: transcribe ONLY what is actually written on the page. Do not infer a
suburb from a street name, and do not expand or correct an address. If the suburb is not
written, return an empty string for it.

Levels: a plan may show more than one storey. They are not always stacked down the page —
a second storey is often drawn as a SEPARATE detached block beside the main one, with its own
caption ("storage - upper level", "Level 2", "first floor"). A detached block with its own
caption is a level, not a room. Return one entry in levels for each, using the caption as its
name, and give each level its own grid coordinates starting from the top-left.`;

type RawRoom = { label: string; kind: "room" | "outdoor"; rects: Array<{ x: number; y: number; w: number; h: number }> };
type RawDoor = { betweenA: string; betweenB: string; confidence: "visible" | "inferred" };
type RawLevel = { name: string; rooms: RawRoom[]; doors: RawDoor[] };
type RawPlan = {
  address: string;
  suburb: string;
  northDegrees: number;
  northNote: string;
  grid: { w: number; h: number };
  levels: RawLevel[];
};

/** Spare cells left around the building so rooms can be dragged outward in the editor. */
const PAD = 3;

function slug(value: string, fallback: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || fallback;
}

/** Model output speaks in room labels; the plan speaks in ids. Assign them once, here. */
function toFloorPlan(raw: RawPlan): FloorPlan {
  const levels = raw.levels.map((level, li) => {
    const byLabel = new Map<string, string>();
    const parsed: Room[] = level.rooms.map((room, ri) => {
      const id = `l${li}-${slug(room.label, `room-${ri}`)}-${ri}`;
      byLabel.set(room.label.trim().toLowerCase(), id);
      return { id, label: room.label.trim(), kind: room.kind ?? "room", rects: room.rects };
    });

    // Close seams between separately-placed rectangles before anything derives walls from
    // them — an unclaimed cell is a hole, and a hole grows a wall around itself.
    const { rooms: healed } = repairInteriorGaps(parsed, raw.grid);

    // Inset by PAD. The model sizes the grid to the building, so the building fills it edge
    // to edge and no room could ever be dragged outward. The margin is free: the renderer
    // crops to the drawn bounds, so padding never shows on the sheet.
    const rooms: Room[] = healed.map((room) => ({
      ...room,
      rects: room.rects.map((r) => ({ ...r, x: r.x + PAD, y: r.y + PAD })),
    }));

    const doors: Door[] = [];
    level.doors.forEach((door, di) => {
      const resolve = (name: string) =>
        name.trim().toLowerCase() === OUTSIDE ? OUTSIDE : byLabel.get(name.trim().toLowerCase());
      const a = resolve(door.betweenA);
      const b = resolve(door.betweenB);
      // A door naming a room that isn't in the room list would resolve to nothing downstream.
      // Dropping it here keeps the plan internally consistent.
      if (!a || !b || a === b) return;
      doors.push({
        id: `l${li}-door-${di}`,
        a,
        b,
        kind: "swing",
        // An external door has to swing into the room. Defaulting to "b" put the garage
        // door's arc outside the building, sweeping open ground.
        swingInto: b === OUTSIDE ? "a" : "b",
        hinge: "start",
        confidence: door.confidence,
      });
    });

    return {
      id: `level-${li}`,
      name: level.name.trim() || `Level ${li + 1}`,
      rooms,
      doors,
      annotations: [],
    };
  });

  // Measured across the sketch corpus, asking for north relative to the returned grid beat
  // decomposing it into (page rotation + arrow direction in the photo) and adding them here:
  // 4/5 correct against 3/6. The model composes the rotation better than it reports the parts.
  // It is still not reliable on a compass drawn askew, which is why the UI treats north as a
  // thing to confirm rather than a thing to trust.
  const north = ((Math.round(raw.northDegrees) % 360) + 360) % 360;

  return {
    address: raw.address.trim(),
    suburb: raw.suburb.trim(),
    grid: { w: raw.grid.w + PAD * 2, h: raw.grid.h + PAD * 2 },
    north,
    northNote: raw.northNote.trim(),
    // Always portrait: reports are portrait, so a landscape sheet would need turning before
    // it could be placed. A wide building simply sits across the top of the page.
    orientation: "portrait",
    levels,
  };
}

export async function extractFloorPlan(imageBase64: string, mediaType: string): Promise<FloorPlan> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      // Covers thinking AND output. At 16000 a dense plan spent the entire budget reasoning
      // and emitted zero JSON — a 29-room commercial fire-exit plan returned stop_reason
      // "max_tokens" with an empty text block, which surfaced to the user as "too complex"
      // when nothing was too complex. Measured need: 13.7k for that plan, 21.7k for a busy
      // hand sketch. Output tokens bill as produced, not as budgeted, so headroom is free.
      max_tokens: 48000,
      thinking: { type: "adaptive" },
      // "medium", not "high": on the same inputs it returns the same rooms, address and north
      // in ~37% less wall-clock (169s vs 270s on the worst case), which is what keeps a big
      // plan inside this route's maxDuration.
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    stop_reason?: string;
    content?: Array<{ type: string; text?: string }>;
  };

  // Structured outputs are not honoured on a refusal, and a max_tokens cut leaves invalid
  // JSON — both need to surface as a clear message rather than a parse error.
  if (data.stop_reason === "refusal") throw new Error("The model declined to read this image.");
  // Not a hard ceiling on plan size — it means this one ran past a generous budget. Say so,
  // because the old wording ("too complex") sent people looking for a simpler sketch when the
  // real answer was to raise max_tokens.
  if (data.stop_reason === "max_tokens") {
    throw new Error("Ran out of room reading that plan. Try a tighter crop of just the drawing.");
  }

  const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  let raw: RawPlan;
  try {
    raw = JSON.parse(text) as RawPlan;
  } catch {
    throw new Error("Could not read a floor plan from that image.");
  }
  if (!raw.levels?.length || !raw.levels.some((l) => l.rooms?.length)) {
    throw new Error("No rooms found in that image. Is it a floor plan sketch?");
  }

  return toFloorPlan(raw);
}
