// The Closeout Markup's save file.
//
// Its own format, not BuildingMarkupFile's. That file describes a quote: a red subject, blue
// neighbours and a sheet of products and rates. A closeout describes a job's progress —
// per-property inspection counts, which opportunity it came from — and overloading one schema
// with the other's fields would leave both half-true.
//
// Like the building markup's, it stores the RESOLVED geometry rather than the opportunity Id
// alone. Reopening must give back the drawing that was signed off, not whatever Salesforce says
// about that job today.

import type { LatLng } from "@/lib/kml/types";
import { isFiniteNumber, parseLatLng, parseLatLngList } from "@/lib/maps/latlng-parse";
import { parseSavedShapes, type MarkupMapType, type SavedMarkupShape } from "@/lib/maps/building-markup-file";
import type { SavedShapeLimits } from "@/lib/maps/building-markup-file";
import type { AuStateCode } from "@/lib/property-sizing/types";
import type {
  CloseoutOpportunity,
  CloseoutProperty,
  CloseoutSiteLot,
  CouncilAsset,
  InspectionColor,
  UnmappedWorkOrder,
} from "./types";

export const CLOSEOUT_FILE_KIND = "ausdilaps.closeout-markup";
export const CLOSEOUT_FILE_VERSION = 1;

export interface SavedCloseoutProperty {
  property: CloseoutProperty;
  selected: boolean;
  ring: LatLng[] | null;
  areaSqm: number | null;
  lotPlan: string | null;
  point: LatLng;
  note: string | null;
}

export interface CloseoutMarkupFile {
  kind: typeof CLOSEOUT_FILE_KIND;
  version: number;
  savedAt: string;
  opportunity: CloseoutOpportunity;
  properties: SavedCloseoutProperty[];
  unmapped: UnmappedWorkOrder[];
  /** Stored: reopening a drawing to adjust a hand-drawn asset needs the reference links again. */
  councilAssets: CouncilAsset[];
  /** The project site's outlines, resolved. Stored like every other ring rather than re-derived
   *  on open: re-resolving would re-spend a geocode AND could hand back a different parcel from
   *  the one that was signed off. */
  siteLots: CloseoutSiteLot[];
  /** Whether the export carries the summary band and the numbered pins. Absent in every file
   *  saved before 2026-09-18, which is why it reads as TRUE — that is what those exported. */
  includeSummary: boolean;
  workOrderCount: number;
  mapType: MarkupMapType;
  /** ⚠️ Validated, not `unknown[]`. They were stored and then silently dropped on open, because
   *  nothing here parsed them — so a hand-drawn council asset, or a hand-drawn project site on
   *  the quarter of jobs whose site address cannot be placed, was lost the moment the file was
   *  reopened. */
  shapes: SavedMarkupShape[];
}

export function buildCloseoutFile(
  input: Omit<CloseoutMarkupFile, "kind" | "version" | "savedAt">
): CloseoutMarkupFile {
  return {
    kind: CLOSEOUT_FILE_KIND,
    version: CLOSEOUT_FILE_VERSION,
    savedAt: new Date().toISOString(),
    ...input,
  };
}

export type ParseCloseoutResult =
  | { ok: true; file: CloseoutMarkupFile; skipped: number }
  | { ok: false; error: string };

const COLORS: InspectionColor[] = ["green", "red", "orange", "partial"];
const AU_STATES: AuStateCode[] = ["QLD", "NSW", "VIC", "SA", "WA", "TAS", "ACT", "NT"];
const MAP_TYPES: MarkupMapType[] = ["satellite", "hybrid", "roadmap"];

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Reads a closeout save file back.
 *
 * Individual properties are skippable and counted — one malformed row out of forty should not
 * cost the operator the drawing — but a file with no readable properties at all is an error,
 * because there is nothing to show and silently opening an empty map reads as a bug in the map.
 */
export function parseCloseoutFile(
  text: string,
  maxRingPoints = 2000,
  shapeLimits: SavedShapeLimits = { maxShapePoints: 100, minWidth: 1, maxWidth: 200 }
): ParseCloseoutResult {
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "That file isn't valid JSON." };
  }
  if (!doc || typeof doc !== "object") return { ok: false, error: "That file isn't a closeout markup." };
  if (doc.kind !== CLOSEOUT_FILE_KIND) {
    return { ok: false, error: "That file isn't a closeout markup — open it on the tab it was saved from." };
  }

  const opp = (doc.opportunity ?? {}) as Record<string, unknown>;
  if (!str(opp.id)) return { ok: false, error: "That file has no opportunity on it." };

  let skipped = 0;
  const properties: SavedCloseoutProperty[] = [];
  for (const entry of Array.isArray(doc.properties) ? doc.properties : []) {
    const e = entry as Record<string, unknown>;
    const p = (e?.property ?? {}) as Record<string, unknown>;
    const point = parseLatLng(e?.point) ?? parseLatLng(p?.point);
    const counts = (p?.counts ?? {}) as Record<string, unknown>;
    if (!str(p.key) || !str(p.street) || !point) {
      skipped++;
      continue;
    }
    const ring = parseLatLngList(e?.ring, maxRingPoints);
    properties.push({
      property: {
        key: str(p.key),
        street: str(p.street),
        suburb: str(p.suburb) || null,
        postcode: str(p.postcode) || null,
        state: (str(p.state) || null) as CloseoutProperty["state"],
        point,
        color: COLORS.includes(p.color as InspectionColor) ? (p.color as InspectionColor) : "orange",
        counts: {
          green: isFiniteNumber(counts.green) ? counts.green : 0,
          red: isFiniteNumber(counts.red) ? counts.red : 0,
          orange: isFiniteNumber(counts.orange) ? counts.orange : 0,
        },
        workOrders: isFiniteNumber(p.workOrders) ? p.workOrders : 0,
        numbers: Array.isArray(p.numbers) ? p.numbers.filter((n): n is string => typeof n === "string") : [],
        precision: (["precise", "approximate", "area"] as const).includes(p.precision as never)
          ? (p.precision as CloseoutProperty["precision"])
          : "approximate",
        sharedPoint: p.sharedPoint === true,
        accuracy: str(p.accuracy) || null,
      },
      selected: e?.selected !== false,
      ring: ring && ring.length >= 3 ? ring : null,
      areaSqm: isFiniteNumber(e?.areaSqm) ? e.areaSqm : null,
      lotPlan: str(e?.lotPlan) || null,
      point,
      note: str(e?.note) || null,
    });
  }

  if (properties.length === 0) {
    return { ok: false, error: "That file has no readable properties in it." };
  }

  return {
    ok: true,
    skipped,
    file: {
      kind: CLOSEOUT_FILE_KIND,
      version: isFiniteNumber(doc.version) ? doc.version : CLOSEOUT_FILE_VERSION,
      savedAt: str(doc.savedAt),
      opportunity: {
        id: str(opp.id),
        name: str(opp.name) || str(opp.id),
        stageName: str(opp.stageName) || null,
        accountName: str(opp.accountName) || null,
        boxFolderUrl: str(opp.boxFolderUrl) || null,
        existingMarkupUrl: str(opp.existingMarkupUrl) || null,
        url: str(opp.url) || null,
        siteAddress:
          opp.siteAddress && typeof opp.siteAddress === "object"
            ? {
                line: str((opp.siteAddress as Record<string, unknown>).line),
                street: str((opp.siteAddress as Record<string, unknown>).street) || null,
                suburb: str((opp.siteAddress as Record<string, unknown>).suburb) || null,
                state: AU_STATES.includes(str((opp.siteAddress as Record<string, unknown>).state) as AuStateCode)
                  ? (str((opp.siteAddress as Record<string, unknown>).state) as AuStateCode)
                  : null,
                postcode: str((opp.siteAddress as Record<string, unknown>).postcode) || null,
              }
            : null,
      },
      properties,
      unmapped: Array.isArray(doc.unmapped)
        ? (doc.unmapped as Record<string, unknown>[])
            .filter((u) => u && typeof u === "object")
            .map((u) => ({
              id: str(u.id),
              number: str(u.number) || null,
              street: str(u.street) || null,
              reason: str(u.reason),
              coverPhotoUrl: str(u.coverPhotoUrl) || null,
              siteMarkupUrl: str(u.siteMarkupUrl) || null,
            }))
        : [],
      councilAssets: Array.isArray(doc.councilAssets)
        ? (doc.councilAssets as Record<string, unknown>[])
            .filter((c) => c && typeof c === "object" && str(c.street))
            .map((c) => ({
              workOrderId: str(c.workOrderId),
              number: str(c.number) || null,
              street: str(c.street),
              suburb: str(c.suburb) || null,
              workType: str(c.workType) || null,
              color: COLORS.includes(c.color as InspectionColor) ? (c.color as InspectionColor) : "orange",
              coverPhotoUrl: str(c.coverPhotoUrl) || null,
              siteMarkupUrl: str(c.siteMarkupUrl) || null,
            }))
        : [],
      // A ring shorter than 3 points is not an outline; drop that lot rather than the file.
      siteLots: Array.isArray(doc.siteLots)
        ? (doc.siteLots as Record<string, unknown>[])
            .filter((l) => l && typeof l === "object")
            .map((l) => ({
              id: str(l.id),
              ring: parseLatLngList(l.ring, maxRingPoints) ?? [],
              areaSqm: isFiniteNumber(l.areaSqm) ? l.areaSqm : null,
              lotPlan: str(l.lotPlan) || null,
              point: parseLatLng(l.point) ?? { lat: 0, lng: 0 },
              address: str(l.address),
            }))
            .filter((l) => l.ring.length >= 3)
        : [],
      // ⚠️ `!== false`, not `=== true`: an older file has no such field and must reopen the way
      // it was exported, which was with the summary on.
      includeSummary: doc.includeSummary !== false,
      workOrderCount: isFiniteNumber(doc.workOrderCount) ? doc.workOrderCount : properties.length,
      mapType: MAP_TYPES.includes(doc.mapType as MarkupMapType) ? (doc.mapType as MarkupMapType) : "hybrid",
      shapes: parseSavedShapes(doc.shapes, shapeLimits).shapes,
    },
  };
}
