// Reads a photographed hand sketch into a structured FloorPlan via Claude vision.
//
// Env-gated: no ANTHROPIC_API_KEY -> the tool still works, you just build the plan by hand
// in the editor instead of starting from a draft.
//
// Opus rather than the Haiku used by the other vision helpers in this repo: those read a
// short code off a tight crop, this reasons about a whole spatial layout. Measured on the
// reference sketch it runs ~50s for ~5.6k in / ~3.6k out, so roughly 12c a plan against the
// ~13 minutes the same drawing takes by hand in EdrawMax.

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
      description: "Direction north points ON THE PAGE. 0 = up, 90 = right, 180 = down, 270 = left.",
    },
    northNote: {
      type: "string",
      description: "Which compass marks you saw and how you derived northDegrees, for a human to check.",
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
              properties: { label: { type: "string" }, rects: { type: "array", items: rectProps } },
              required: ["label", "rects"],
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
const PROMPT = `This is a photograph of a hand-drawn floor plan sketch, made on site by a building
inspector. It is drawn in pen on ruled notebook paper.

IGNORE the printed horizontal rules of the notebook paper — they are not walls. Only the
hand-drawn pen lines are walls. Ignore any faint text showing through from the reverse of
the page.

The sketch is a schematic layout: rooms are drawn as adjoining rectangles. There are no
measurements on it and you must not invent any.

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
"Bedroom 2", "bath" becomes "Bathroom", "laundry" becomes "Laundry". Do not add rooms that
are not on the sketch.

Doors: list them as a pair of room labels that the doorway connects, or a room label and
"outside" for an external door. Mark confidence "visible" ONLY where the sketch actually
shows a gap, arc or door mark in a wall. Use "inferred" if you are filling in a doorway that
must logically exist but is not drawn. Do not guess wildly — an empty list is fine.

North: read the compass marks on the sketch carefully. The arrows may not follow the usual
convention, so work out which way the N arrow actually points on the page and report that as
northDegrees, and describe what you saw in northNote.

Address and suburb: transcribe ONLY what is actually written on the page. Do not infer a
suburb from a street name, and do not expand or correct an address. If the suburb is not
written, return an empty string for it.

If the sketch shows more than one storey, return one entry in levels for each.`;

type RawRoom = { label: string; rects: Array<{ x: number; y: number; w: number; h: number }> };
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
      return { id, label: room.label.trim(), rects: room.rects };
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
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
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
  if (data.stop_reason === "max_tokens") throw new Error("Sketch too complex — the response was cut short.");

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
