// The Building Markup tab's save file.
//
// Carries the RESOLVED cadastre geometry, not just the address, so reopening a set costs no
// geocode and no ArcGIS lookup — and, more importantly, restores the exact lots the
// operator accepted. Re-resolving from the address would quietly hand back whatever the
// cadastre says today, which is not the drawing that was signed off.

import type { LatLng } from "@/lib/kml/types";
import { isFiniteNumber, parseLatLng, parseLatLngList } from "./latlng-parse";

export const BUILDING_MARKUP_FILE_KIND = "ausdilaps.building-markup";
export const BUILDING_MARKUP_FILE_VERSION = 1;

export type MarkupMapType = "satellite" | "hybrid" | "roadmap";
type ShapeMode = "line" | "area";
type ShapeColor = "orange" | "blue" | "red";

export interface SavedNeighbour {
  id: string;
  ring: LatLng[];
  areaSqm: number | null;
  label: string;
}

export interface SavedMarkupShape {
  mode: ShapeMode;
  widthMetres: number;
  color: ShapeColor;
  points: LatLng[];
}

export interface BuildingMarkupFile {
  kind: typeof BUILDING_MARKUP_FILE_KIND;
  version: number;
  savedAt: string;
  address: { street: string; suburb: string; postcode: string; state: string };
  matchedAddress: string | null;
  mapType: MarkupMapType;
  subjectRing: LatLng[];
  neighbours: SavedNeighbour[];
  /** The pinned frame. Restoring it is what stops the photo re-framing on reopen. */
  frame: { center: LatLng; fitZoom: number } | null;
  zoomAdjust: number;
  /** Which detected lots the operator had unticked. */
  excludedIds: string[];
  hideSubject: boolean;
  shapes: SavedMarkupShape[];
}

export function buildBuildingMarkupFile(
  input: Omit<BuildingMarkupFile, "kind" | "version" | "savedAt">
): BuildingMarkupFile {
  return {
    kind: BUILDING_MARKUP_FILE_KIND,
    version: BUILDING_MARKUP_FILE_VERSION,
    savedAt: new Date().toISOString(),
    ...input,
  };
}

export type ParseBuildingMarkupResult =
  | { ok: true; file: BuildingMarkupFile; skippedShapes: number }
  | { ok: false; error: string };

const MODES: ShapeMode[] = ["line", "area"];
const COLORS: ShapeColor[] = ["orange", "blue", "red"];

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Reads a Building Markup save file back.
 *
 * The subject ring is required — without it there is no frame anchor and no drawing. Lots
 * and shapes are individually skippable: one malformed lot out of twelve should not cost
 * the operator the whole markup.
 */
export function parseBuildingMarkupFile(
  text: string,
  limits: { maxShapePoints: number; maxRingPoints: number; minWidth: number; maxWidth: number }
): ParseBuildingMarkupResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't valid JSON." };
  }
  if (!raw || typeof raw !== "object") return { ok: false, error: "That file isn't a markup." };

  const doc = raw as Record<string, unknown>;
  if (doc.kind !== BUILDING_MARKUP_FILE_KIND) {
    return {
      ok: false,
      error:
        doc.kind === "ausdilaps.measure"
          ? "That's a Measure save file — open it on the Measure tab."
          : "That's not a Building Markup save file.",
    };
  }
  if (!isFiniteNumber(doc.version) || doc.version > BUILDING_MARKUP_FILE_VERSION) {
    return {
      ok: false,
      error: "That file was saved by a newer version of this tool — update the page and try again.",
    };
  }

  const subjectRing = parseLatLngList(doc.subjectRing, limits.maxRingPoints);
  if (!subjectRing || subjectRing.length < 3) {
    return { ok: false, error: "That file has no usable property boundary in it." };
  }

  const neighbours: SavedNeighbour[] = [];
  for (const entry of Array.isArray(doc.neighbours) ? doc.neighbours : []) {
    if (!entry || typeof entry !== "object") continue;
    const n = entry as Record<string, unknown>;
    const ring = parseLatLngList(n.ring, limits.maxRingPoints);
    if (!ring || ring.length < 3 || !str(n.id)) continue;
    neighbours.push({
      id: str(n.id),
      ring,
      areaSqm: isFiniteNumber(n.areaSqm) ? n.areaSqm : null,
      label: str(n.label) || String(neighbours.length + 1),
    });
  }

  const shapes: SavedMarkupShape[] = [];
  let skippedShapes = 0;
  for (const entry of Array.isArray(doc.shapes) ? doc.shapes : []) {
    if (!entry || typeof entry !== "object") {
      skippedShapes += 1;
      continue;
    }
    const sh = entry as Record<string, unknown>;
    const points = parseLatLngList(sh.points, limits.maxShapePoints);
    if (!points || !MODES.includes(sh.mode as ShapeMode)) {
      skippedShapes += 1;
      continue;
    }
    shapes.push({
      mode: sh.mode as ShapeMode,
      // Clamped, not rejected: an out-of-range width still describes a real ribbon.
      widthMetres: isFiniteNumber(sh.widthMetres)
        ? Math.min(limits.maxWidth, Math.max(limits.minWidth, sh.widthMetres))
        : limits.minWidth,
      // Anything unrecognised falls back to the legend's default row rather than dropping
      // the shape over a colour name.
      color: COLORS.includes(sh.color as ShapeColor) ? (sh.color as ShapeColor) : "orange",
      points,
    });
  }

  const addr = (doc.address ?? {}) as Record<string, unknown>;
  const frameRaw = (doc.frame ?? null) as Record<string, unknown> | null;
  const frameCenter = frameRaw ? parseLatLng(frameRaw.center) : null;

  return {
    ok: true,
    skippedShapes,
    file: {
      kind: BUILDING_MARKUP_FILE_KIND,
      version: doc.version,
      savedAt: typeof doc.savedAt === "string" ? doc.savedAt : new Date().toISOString(),
      address: {
        street: str(addr.street),
        suburb: str(addr.suburb),
        postcode: str(addr.postcode),
        state: str(addr.state),
      },
      matchedAddress: typeof doc.matchedAddress === "string" ? doc.matchedAddress : null,
      mapType:
        doc.mapType === "satellite" || doc.mapType === "roadmap" || doc.mapType === "hybrid"
          ? doc.mapType
          : "hybrid",
      subjectRing,
      neighbours,
      frame:
        frameCenter && isFiniteNumber(frameRaw?.fitZoom)
          ? { center: frameCenter, fitZoom: frameRaw!.fitZoom as number }
          : null,
      zoomAdjust: isFiniteNumber(doc.zoomAdjust) ? Math.max(-3, Math.min(3, doc.zoomAdjust)) : 0,
      excludedIds: Array.isArray(doc.excludedIds) ? doc.excludedIds.filter((v) => typeof v === "string") : [],
      hideSubject: doc.hideSubject === true,
      shapes,
    },
  };
}
