// The Measure tab's save file: a small JSON document holding the measurements and the frame
// they were drawn on, so a set can be reopened and adjusted instead of redrawn.
//
// Pure and dependency-free — no zod, deliberately. This runs in the client bundle, the
// schema is a dozen fields, and a hand-rolled validator keeps the parse rules readable
// right next to the format they describe.

import type { LatLng } from "@/lib/kml/types";
import type { ShapeMode } from "@/lib/kml/standard-markup/measure";
import type { LatLngBox } from "@/lib/kml/standard-markup/projection";

/** Stamped into every file so a stray .json picked from a folder is rejected with a useful
 *  message rather than silently loading as an empty set. */
export const MEASURE_FILE_KIND = "ausdilaps.measure";
/** Bump only for a BREAKING format change, and keep reading the old one — a saved file is
 *  someone's work, and a version bump that orphans it is a data-loss bug. */
export const MEASURE_FILE_VERSION = 1;

export interface MeasureFileShape {
  mode: ShapeMode;
  widthMetres: number;
  points: LatLng[];
}

export interface MeasureFile {
  kind: typeof MEASURE_FILE_KIND;
  version: number;
  savedAt: string;
  /** Whatever was in the Go to box — for the filename and to show on reopen. */
  label: string | null;
  /** The frame the set was drawn on, so reopening lands you back where you were. */
  bounds: LatLngBox | null;
  mapType: "satellite" | "hybrid" | "roadmap" | null;
  measurements: MeasureFileShape[];
}

export function buildMeasureFile(input: {
  label: string | null;
  bounds: LatLngBox | null;
  mapType: "satellite" | "hybrid" | "roadmap" | null;
  measurements: MeasureFileShape[];
}): MeasureFile {
  return {
    kind: MEASURE_FILE_KIND,
    version: MEASURE_FILE_VERSION,
    savedAt: new Date().toISOString(),
    label: input.label,
    bounds: input.bounds,
    mapType: input.mapType,
    // Only the geometry — ids are regenerated on load, and nothing derived (areas,
    // lengths) is stored. A stored area would be a second source of truth that silently
    // disagrees with the maths the moment the maths improves.
    measurements: input.measurements.map(({ mode, widthMetres, points }) => ({
      mode,
      widthMetres,
      points: points.map((p) => ({ lat: p.lat, lng: p.lng })),
    })),
  };
}

export type ParseResult =
  | { ok: true; file: MeasureFile; skipped: number }
  | { ok: false; error: string };

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function parsePoints(raw: unknown, maxPoints: number): LatLng[] | null {
  if (!Array.isArray(raw)) return null;
  const points: LatLng[] = [];
  for (const p of raw.slice(0, maxPoints)) {
    if (!p || typeof p !== "object") return null;
    const { lat, lng } = p as Record<string, unknown>;
    if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    points.push({ lat, lng });
  }
  return points;
}

function parseBounds(raw: unknown): LatLngBox | null {
  if (!raw || typeof raw !== "object") return null;
  const { south, west, north, east } = raw as Record<string, unknown>;
  if (![south, west, north, east].every(isFiniteNumber)) return null;
  const box = { south, west, north, east } as LatLngBox;
  if (Math.abs(box.south) > 90 || Math.abs(box.north) > 90) return null;
  if (Math.abs(box.west) > 180 || Math.abs(box.east) > 180) return null;
  if (box.north <= box.south) return null;
  return box;
}

/**
 * Reads a save file back.
 *
 * Every field is checked. This is a file off someone's disk — possibly hand-edited, possibly
 * from a future version of the tool, possibly not ours at all — so a bad field drops the one
 * shape it belongs to rather than throwing away the whole set or, worse, loading NaN
 * coordinates that make Google's overlay silently vanish.
 */
export function parseMeasureFile(
  text: string,
  limits: { maxMeasurements: number; maxPoints: number; minWidth: number; maxWidth: number }
): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't valid JSON." };
  }
  if (!raw || typeof raw !== "object") return { ok: false, error: "That file isn't a measurement set." };

  const doc = raw as Record<string, unknown>;
  if (doc.kind !== MEASURE_FILE_KIND) {
    return { ok: false, error: "That's not a Measure save file." };
  }
  if (!isFiniteNumber(doc.version) || doc.version > MEASURE_FILE_VERSION) {
    return {
      ok: false,
      error: "That file was saved by a newer version of this tool — update the page and try again.",
    };
  }
  if (!Array.isArray(doc.measurements)) {
    return { ok: false, error: "That file has no measurements in it." };
  }

  const measurements: MeasureFileShape[] = [];
  let skipped = 0;
  for (const entry of doc.measurements) {
    if (measurements.length >= limits.maxMeasurements) {
      skipped += 1;
      continue;
    }
    if (!entry || typeof entry !== "object") {
      skipped += 1;
      continue;
    }
    const { mode, widthMetres, points } = entry as Record<string, unknown>;
    if (mode !== "line" && mode !== "area") {
      skipped += 1;
      continue;
    }
    const parsedPoints = parsePoints(points, limits.maxPoints);
    if (!parsedPoints) {
      skipped += 1;
      continue;
    }
    // Clamped rather than rejected: a width outside the slider's range still describes a
    // real ribbon, and losing the shape over it would be worse than nudging the number.
    const width = isFiniteNumber(widthMetres)
      ? Math.min(limits.maxWidth, Math.max(limits.minWidth, widthMetres))
      : limits.minWidth;
    measurements.push({ mode, widthMetres: width, points: parsedPoints });
  }

  if (measurements.length === 0) {
    return { ok: false, error: "Nothing in that file could be read as a measurement." };
  }

  return {
    ok: true,
    skipped,
    file: {
      kind: MEASURE_FILE_KIND,
      version: doc.version,
      savedAt: typeof doc.savedAt === "string" ? doc.savedAt : new Date().toISOString(),
      label: typeof doc.label === "string" ? doc.label : null,
      bounds: parseBounds(doc.bounds),
      mapType:
        doc.mapType === "satellite" || doc.mapType === "roadmap" || doc.mapType === "hybrid"
          ? doc.mapType
          : null,
      measurements,
    },
  };
}
