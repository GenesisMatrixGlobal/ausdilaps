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
import type { MarkupMapType } from "@/lib/maps/building-markup-file";
import type {
  CloseoutOpportunity,
  CloseoutProperty,
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
  workOrderCount: number;
  mapType: MarkupMapType;
  shapes: unknown[];
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
export function parseCloseoutFile(text: string, maxRingPoints = 2000): ParseCloseoutResult {
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
      workOrderCount: isFiniteNumber(doc.workOrderCount) ? doc.workOrderCount : properties.length,
      mapType: MAP_TYPES.includes(doc.mapType as MarkupMapType) ? (doc.mapType as MarkupMapType) : "hybrid",
      shapes: Array.isArray(doc.shapes) ? doc.shapes : [],
    },
  };
}
