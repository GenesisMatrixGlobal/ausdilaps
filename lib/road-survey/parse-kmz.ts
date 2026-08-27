// KMZ/KML -> RoadSegment[].
//
// Hand-rolled extraction rather than an XML parser, matching the documented decision in
// lib/tenders/sources/feed.ts. Two concrete reasons beyond consistency:
//
//   1. Real KMZs from Google Earth Pro are not always well-formed. The Ferrovial file's
//      <Document> carries an `xsi:schemaLocation` attribute with no matching xmlns:xsi
//      declaration, which makes a strict parser throw "unbound prefix" on line 3 and
//      abandon the whole file. Regex extraction simply does not care.
//   2. The shape we need is shallow and fixed: Folder > Placemark > (MultiGeometry >)
//      LineString > coordinates, plus four attributes in an HTML table.
//
// If a KML shows up whose structure this cannot read, that is the moment to add
// fast-xml-parser — not before.

import { unzipSync, strFromU8 } from "fflate";
import { decodeEntities } from "@/lib/html";
import { haversineKm, pathLengthKm } from "@/lib/kml/road-segments/geo";
import { fingerprintNetwork, segmentId } from "./fingerprint";
import type { LatLng } from "@/lib/kml/types";
import type { RoadSegment } from "./types";

/** Attribute length and traced geometry beyond this far apart means one of them is wrong. */
const LENGTH_TOLERANCE = 0.05;

export class KmzParseError extends Error {}

/**
 * Pulls doc.kml out of a KMZ, or passes a raw KML through untouched.
 *
 * A KMZ is a zip whose KML entry is conventionally doc.kml but is not required to be —
 * ArcGIS and QGIS exports both emit other names — so fall back to the first .kml entry.
 */
export function extractKml(file: Uint8Array): string {
  // "PK\x03\x04" — the zip local file header. Sniffing the magic bytes beats sniffing for
  // "<?xml", because a KML can legitimately open with a BOM or a comment.
  const isZip = file[0] === 0x50 && file[1] === 0x4b && file[2] === 0x03 && file[3] === 0x04;
  if (!isZip) return strFromU8(file);

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(file);
  } catch {
    throw new KmzParseError("That file isn't a readable .kmz or .kml.");
  }

  const names = Object.keys(entries);
  const kmlName =
    names.find((n) => n.toLowerCase() === "doc.kml") ??
    names.find((n) => n.toLowerCase().endsWith(".kml"));
  if (!kmlName) throw new KmzParseError("No .kml found inside that .kmz.");
  return strFromU8(entries[kmlName]);
}

/** KML stores colour as aabbggrr — byte-reversed from the #rrggbb everyone expects. */
export function kmlColourToHex(aabbggrr: string): string | null {
  const c = aabbggrr.trim();
  if (!/^[0-9a-fA-F]{8}$/.test(c)) return null;
  return `#${c.slice(6, 8)}${c.slice(4, 6)}${c.slice(2, 4)}`.toLowerCase();
}

/** Resolves <styleUrl> -> #rrggbb, hopping through a StyleMap's "normal" pair when present. */
function buildStyleIndex(kml: string): Map<string, string> {
  const colours = new Map<string, string>();
  for (const m of kml.matchAll(/<Style\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/Style>/gi)) {
    const line = m[2].match(/<LineStyle\b[^>]*>([\s\S]*?)<\/LineStyle>/i);
    const colour = line?.[1].match(/<color\b[^>]*>([\s\S]*?)<\/color>/i);
    const hex = colour ? kmlColourToHex(colour[1]) : null;
    if (hex) colours.set(m[1], hex);
  }

  const resolved = new Map(colours);
  for (const m of kml.matchAll(/<StyleMap\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/StyleMap>/gi)) {
    for (const pair of m[2].matchAll(/<Pair\b[^>]*>([\s\S]*?)<\/Pair>/gi)) {
      const key = pair[1].match(/<key\b[^>]*>([\s\S]*?)<\/key>/i)?.[1].trim();
      const ref = pair[1].match(/<styleUrl\b[^>]*>([\s\S]*?)<\/styleUrl>/i)?.[1].trim().replace(/^#/, "");
      if (key === "normal" && ref && colours.has(ref)) resolved.set(m[1], colours.get(ref)!);
    }
  }
  return resolved;
}

/**
 * Reads the four attributes out of the HTML table Google Earth puts in <description>.
 *
 * The table is a flat run of <td> cells alternating label,value inside a wrapper row that
 * repeats the road name, so match on the known label names rather than on cell position.
 */
function parseDescriptionAttrs(description: string): Record<string, string> {
  const cells = [...description.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
    decodeEntities(m[1].replace(/<[^>]+>/g, "")).trim()
  );
  const wanted = new Set(["FID", "Name", "Classific", "Length"]);
  const attrs: Record<string, string> = {};
  for (let i = 0; i < cells.length - 1; i++) {
    if (wanted.has(cells[i]) && !(cells[i] in attrs)) attrs[cells[i]] = cells[i + 1];
  }
  return attrs;
}

/**
 * The GIS export writes decimals with a comma ("3411,1" = 3411.1 m) — a locale artefact,
 * not a thousands separator. Guard against a genuine thousands separator by only treating
 * the comma as a decimal point when it is followed by 1-2 digits at the end of the string.
 */
function parseAttrMetres(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = /,\d{1,2}$/.test(raw.trim()) ? raw.trim().replace(",", ".") : raw.trim().replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseCoordinates(block: string): LatLng[] {
  const pts: LatLng[] = [];
  for (const token of block.trim().split(/\s+/)) {
    const [lng, lat] = token.split(",");
    const la = Number(lat);
    const ln = Number(lng);
    if (Number.isFinite(la) && Number.isFinite(ln)) pts.push({ lat: la, lng: ln });
  }
  return pts;
}

/** Strips a trailing "Route"/"Routes" so "Key Route", "Key Routes" and "Key" all compare equal. */
function normaliseClass(value: string): string {
  return value.trim().toLowerCase().replace(/\s+routes?$/, "").replace(/\s+/g, " ");
}

/** Point at half the cumulative path length — a better locality probe than the bare midpoint. */
function midpointOf(path: LatLng[]): LatLng | null {
  if (path.length === 0) return null;
  if (path.length === 1) return path[0];
  const half = pathLengthKm(path) / 2;
  let run = 0;
  for (let i = 1; i < path.length; i++) {
    const step = haversineKm(path[i - 1], path[i]);
    if (run + step >= half) return path[i];
    run += step;
  }
  return path[path.length - 1];
}

export interface ParseResult {
  segments: RoadSegment[];
  /** Four hex chars identifying this exact network — the prefix on every segment id. */
  fingerprint: string;
  /** Document-level <name>, so the tool can show which layer was loaded. */
  documentName: string | null;
  /** Every distinct colour found, with how much network each covers. */
  colours: { colourHex: string; folder: string; count: number; totalKm: number }[];
}

export function parseRoadSurveyKml(kml: string): ParseResult {
  const styles = buildStyleIndex(kml);
  const documentName =
    kml.match(/<Document\b[^>]*>[\s\S]*?<name\b[^>]*>([\s\S]*?)<\/name>/i)?.[1]?.trim() ?? null;

  // Split the document at each <Folder>, so a chunk's leading text (before its first
  // Placemark) holds that folder's own <name>. Placemarks before the first <Folder> are
  // loose at document level and still counted.
  const chunks: { folder: string; body: string }[] = [];
  const folderSplit = kml.split(/<Folder\b[^>]*>/i);
  chunks.push({ folder: "", body: folderSplit[0] });
  for (const chunk of folderSplit.slice(1)) {
    const beforeFirstPlacemark = chunk.split(/<Placemark\b/i)[0];
    const name = beforeFirstPlacemark.match(/<name\b[^>]*>([\s\S]*?)<\/name>/i)?.[1]?.trim() ?? "";
    chunks.push({ folder: decodeEntities(name), body: chunk });
  }

  const segments: RoadSegment[] = [];
  for (const { folder, body } of chunks) {
    for (const pm of body.matchAll(/<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi)) {
      const block = pm[1];

      const description = block.match(/<description\b[^>]*>([\s\S]*?)<\/description>/i)?.[1] ?? "";
      const attrs = parseDescriptionAttrs(description);
      const placemarkName =
        block.split(/<description\b/i)[0].match(/<name\b[^>]*>([\s\S]*?)<\/name>/i)?.[1]?.trim() ?? "";
      const roadName = decodeEntities(placemarkName || attrs.Name || "Unnamed");

      const styleRef = block.match(/<styleUrl\b[^>]*>([\s\S]*?)<\/styleUrl>/i)?.[1]?.trim().replace(/^#/, "");
      const colourHex = (styleRef && styles.get(styleRef)) || "";

      // One Placemark can hold several LineStrings inside a MultiGeometry. Each is a
      // discontinuous run of the same road, so lengths sum but the paths must not be
      // joined end-to-end — a naive concat would add a phantom leg between parts.
      let lengthKm = 0;
      const parts: LatLng[][] = [];
      for (const coords of block.matchAll(/<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>/gi)) {
        const pts = parseCoordinates(coords[1]);
        if (pts.length < 2) continue;
        parts.push(pts);
        lengthKm += pathLengthKm(pts);
      }
      if (parts.length === 0) continue; // a point or empty geometry — not a road to survey
      const flat = parts.flat();

      const attrMetres = parseAttrMetres(attrs.Length);
      const lengthKmAttribute = attrMetres === null ? null : attrMetres / 1000;
      const ratio = lengthKmAttribute && lengthKm > 0 ? lengthKmAttribute / lengthKm : null;
      const lengthVarianceFlag =
        ratio !== null && Math.abs(ratio - 1) > LENGTH_TOLERANCE
          ? `KML says ${lengthKmAttribute!.toFixed(2)}km, geometry measures ${lengthKm.toFixed(2)}km — verify`
          : null;

      const classificAttr = decodeEntities(attrs.Classific ?? "");
      segments.push({
        // Placeholder — real ids need the fingerprint, which needs every segment first.
        id: "",
        roadName,
        folder,
        classificAttr,
        classMismatch:
          !!folder && !!classificAttr && normaliseClass(folder) !== normaliseClass(classificAttr),
        colourHex,
        fid: attrs.FID ?? "",
        lengthKmGeometry: lengthKm,
        lengthKmAttribute,
        lengthVarianceFlag,
        start: flat[0] ?? null,
        end: flat[flat.length - 1] ?? null,
        midpoint: midpointOf(flat),
        parts,
      });
    }
  }

  // Ids can only be assigned once the whole network is known, since the fingerprint
  // covers all of it.
  const fingerprint = fingerprintNetwork(segments);
  segments.forEach((s, i) => {
    s.id = segmentId(fingerprint, i);
  });

  const byColour = new Map<string, { colourHex: string; folder: string; count: number; totalKm: number }>();
  for (const s of segments) {
    const key = `${s.colourHex}|${s.folder}`;
    const row = byColour.get(key) ?? { colourHex: s.colourHex, folder: s.folder, count: 0, totalKm: 0 };
    row.count++;
    row.totalKm += s.lengthKmGeometry;
    byColour.set(key, row);
  }

  return {
    segments,
    fingerprint,
    documentName,
    colours: [...byColour.values()].sort((a, b) => b.totalKm - a.totalKm),
  };
}

export function parseRoadSurveyFile(file: Uint8Array): ParseResult {
  const result = parseRoadSurveyKml(extractKml(file));
  if (result.segments.length === 0) {
    throw new KmzParseError("No road lines found in that file — is it a path/polyline layer?");
  }
  return result;
}
