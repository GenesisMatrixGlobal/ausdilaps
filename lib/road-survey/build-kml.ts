// Writes the surviving road segments back out as KML/KMZ for Google Earth.
//
// Deliberately not lib/kml/build.ts: that one puts every path in its own folder under a
// single hardcoded brand colour, which is right for the KML Builder's hand-drawn survey
// paths and wrong here. A client's network arrives grouped and colour-coded by their own
// classification (Key Routes, OSOM, Normal, Minor), and handing it back with that scheme
// destroyed would make it unreadable against their own documents.

import { zipSync, strToU8 } from "fflate";
import type { MatchedSegment } from "./reconcile";
import type { RoadSegment } from "./types";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** #rrggbb back to KML's aabbggrr, at full opacity. */
function hexToKmlColour(hex: string): string {
  const h = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return "ff2a64e8"; // brand orange, same fallback as lib/kml
  return `ff${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toLowerCase();
}

/** A slug safe to use as a KML Style id. */
function styleId(folder: string, colourHex: string): string {
  return `s_${folder.replace(/[^a-zA-Z0-9]+/g, "_")}_${colourHex.replace(/[^0-9a-fA-F]/g, "")}`.toLowerCase();
}

/** Columns that would only clutter Google Earth's balloon. */
const SKIPPED_COLUMNS = new Set(["start_lat", "start_lng", "end_lat", "end_lng"]);

function extendedData(row: Record<string, string> | undefined): string {
  const entries = Object.entries(row ?? {}).filter(([k, v]) => v !== "" && !SKIPPED_COLUMNS.has(k));
  if (entries.length === 0) return "";
  const data = entries
    .map(([k, v]) => `          <Data name="${escapeXml(k)}"><value>${escapeXml(v)}</value></Data>`)
    .join("\n");
  return `\n        <ExtendedData>\n${data}\n        </ExtendedData>`;
}

/**
 * One Placemark per segment. Multi-part segments become a MultiGeometry rather than one
 * joined line — the parts are discontinuous runs of the same road, and joining them would
 * draw a phantom leg across country between them.
 */
function placemark(segment: RoadSegment, row: Record<string, string> | undefined, style: string): string {
  const name = escapeXml(segment.roadName);
  const line = (pts: { lat: number; lng: number }[]) =>
    `<LineString><tessellate>1</tessellate><coordinates>${pts
      .map((p) => `${p.lng},${p.lat},0`)
      .join(" ")}</coordinates></LineString>`;

  const geometry =
    segment.parts.length > 1
      ? `<MultiGeometry>${segment.parts.map(line).join("")}</MultiGeometry>`
      : line(segment.parts[0]);

  return `      <Placemark>
        <name>${name}</name>
        <styleUrl>#${style}</styleUrl>${extendedData(row)}
        ${geometry}
      </Placemark>`;
}

export function buildRoadSurveyKml(matched: MatchedSegment[], documentName: string): string {
  // Group by the client's own folder, preserving first-seen order so the output reads in
  // the same order as their original file.
  const groups = new Map<string, { colourHex: string; items: MatchedSegment[] }>();
  for (const m of matched) {
    const key = m.segment.folder || "Ungrouped";
    const g = groups.get(key) ?? { colourHex: m.segment.colourHex, items: [] };
    g.items.push(m);
    groups.set(key, g);
  }

  const styles: string[] = [];
  const folders: string[] = [];
  for (const [folder, { colourHex, items }] of groups) {
    const id = styleId(folder, colourHex);
    styles.push(`    <Style id="${id}">
      <LineStyle><color>${hexToKmlColour(colourHex)}</color><width>4</width></LineStyle>
    </Style>`);
    folders.push(`    <Folder>
      <name>${escapeXml(folder)}</name>
${items.map((m) => placemark(m.segment, m.row?.values, id)).join("\n")}
    </Folder>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(documentName)}</name>
${styles.join("\n")}
${folders.join("\n")}
  </Document>
</kml>
`;
}

/** Zips the KML as doc.kml — the conventional KMZ layout, and what Google Earth expects. */
export function buildKmz(kml: string): Uint8Array {
  return zipSync({ "doc.kml": strToU8(kml) }, { level: 9 });
}
