// The Building Markup tab's save file.
//
// Carries the RESOLVED cadastre geometry, not just the address, so reopening a set costs no
// geocode and no ArcGIS lookup — and, more importantly, restores the exact lots the
// operator accepted. Re-resolving from the address would quietly hand back whatever the
// cadastre says today, which is not the drawing that was signed off.

import type { LatLng } from "@/lib/kml/types";
import { isFiniteNumber, parseLatLng, parseLatLngList } from "./latlng-parse";

export const BUILDING_MARKUP_FILE_KIND = "ausdilaps.building-markup";
/** 2 added stable shape ids and the subject's own lot/plan + area. Version 1 files still
 *  load — they simply have no ids to join on, so plan.ts fingerprints their geometry
 *  instead. */
export const BUILDING_MARKUP_FILE_VERSION = 2;

export type MarkupMapType = "satellite" | "hybrid" | "roadmap";
type ShapeMode = "line" | "area";
type ShapeColor = "orange" | "blue" | "red";

export interface SavedNeighbour {
  id: string;
  ring: LatLng[];
  areaSqm: number | null;
  /** From the state's address layer at generate time. Stored rather than re-looked-up on open
   *  for the same reason the geometry is: it is what was on the drawing that got signed off,
   *  and the address layer may say something different today. Optional — version-1 files and
   *  markups generated before the lookup existed simply have none. */
  street?: string | null;
  suburb?: string | null;
}

export interface SavedMarkupShape {
  /** Stable across a save/reopen — the join key that stops a re-sync duplicating this
   *  shape's Quote Line Item. Absent in version-1 files, which plan.ts handles by
   *  fingerprinting the geometry. */
  id?: string;
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
  /** The subject parcel's own cadastre figures. Optional: version-1 files stored only the
   *  ring, because the resolver was dropping both. */
  subjectLotPlan?: string | null;
  subjectAreaSqm?: number | null;
  neighbours: SavedNeighbour[];
  /** The pinned frame and zoom offset the Static Maps era needed.
   *
   *  Written by older files and still PARSED so those files keep opening, but no longer
   *  produced and no longer honoured: the map is live now, so the operator points it wherever
   *  they want and a reopened markup frames its own geometry instead. */
  frame?: { center: LatLng; fitZoom: number } | null;
  zoomAdjust?: number;
  /** Which detected lots the operator had unticked. */
  excludedIds: string[];
  hideSubject: boolean;
  shapes: SavedMarkupShape[];
  /** Which sheet rows the operator UN-ticked for sync. Records the removals, not the
   *  selections, so a shape drawn after the file was saved still arrives ticked. Keyed by the
   *  same layer keys plan.ts uses. */
  deselected?: string[];
  /** The Quote Line Item sheet's cell values, keyed by layer key. Held as strings because the
   *  sheet does — see lib/markup-layers/line-items.ts. Sparse: only what the operator changed
   *  off the default is stored, so reopening a markup whose geometry was re-measured picks up
   *  the new area while keeping an overridden rate. */
  lineItems?: Record<string, Record<string, string>>;
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

/** The sheet's own column names. Kept here rather than imported from line-items.ts so the
 *  parser stays free of the markup-layers module — it is the only validation this file needs
 *  of them, and the list is stable. */
const LINE_ITEM_FIELDS = new Set([
  "street",
  "suburb",
  "product",
  // Was missing until 2026-09-10, so an asset-type override was written by the tool and then
  // dropped by this parser on reopen — the one cell that silently reverted.
  "assetType",
  "internalMetres",
  "externalMetres",
  "internalRate",
  "externalRate",
  "quantity",
]);

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
      // No `label`. A lot's number is now the quote item number, derived from the tick state at
      // render time (see line-items.ts), so storing one would go stale the moment a lot was
      // unticked. Version-2 files that carry one are simply ignored.
      // Null rather than "" for an absent value, so the sheet can tell "we never had one"
      // from "the operator cleared it".
      street: str(n.street) || null,
      suburb: str(n.suburb) || null,
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
      id: typeof sh.id === "string" && sh.id ? sh.id : undefined,
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
      subjectLotPlan: typeof doc.subjectLotPlan === "string" ? doc.subjectLotPlan : null,
      subjectAreaSqm: isFiniteNumber(doc.subjectAreaSqm) ? doc.subjectAreaSqm : null,
      neighbours,
      frame:
        frameCenter && isFiniteNumber(frameRaw?.fitZoom)
          ? { center: frameCenter, fitZoom: frameRaw!.fitZoom as number }
          : null,
      zoomAdjust: isFiniteNumber(doc.zoomAdjust) ? Math.max(-3, Math.min(3, doc.zoomAdjust)) : 0,
      excludedIds: Array.isArray(doc.excludedIds) ? doc.excludedIds.filter((v) => typeof v === "string") : [],
      hideSubject: doc.hideSubject === true,
      shapes,
      deselected: Array.isArray(doc.deselected)
        ? doc.deselected.filter((v) => typeof v === "string")
        : [],
      // Same reasoning as assetTypes: a cell is text, defaults fill anything absent, and an
      // unreadable value costs one cell rather than the load. Unknown field names are dropped
      // rather than carried, so a renamed column can't resurface as a ghost value.
      lineItems:
        doc.lineItems && typeof doc.lineItems === "object"
          ? Object.fromEntries(
              Object.entries(doc.lineItems as Record<string, unknown>)
                .filter(([, v]) => v && typeof v === "object")
                .map(([key, v]) => [
                  key,
                  Object.fromEntries(
                    Object.entries(v as Record<string, unknown>).filter(
                      ([field, value]) => LINE_ITEM_FIELDS.has(field) && typeof value === "string"
                    ) as [string, string][]
                  ),
                ])
            )
          : {},
    },
  };
}
