import type { KmlPathInput } from "./types";

/** Brand orange #e8642a in KML's aabbggrr colour order. */
const LINE_COLOR = "ff2a64e8";

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function extendedDataFor(metadata: Record<string, string> | undefined): string {
  const entries = Object.entries(metadata ?? {}).filter(([, v]) => v !== "");
  if (entries.length === 0) return "";
  const data = entries
    .map(([k, v]) => `          <Data name="${escapeXml(k)}"><value>${escapeXml(v)}</value></Data>`)
    .join("\n");
  return `\n        <ExtendedData>\n${data}\n        </ExtendedData>`;
}

function folderFor(path: KmlPathInput): string {
  const name = escapeXml(path.name);
  const coords = path.coordinates.map((c) => `${c.lng},${c.lat},0`).join(" ");
  return `    <Folder>
      <name>${name}</name>
      <Placemark>
        <name>${name}</name>
        <styleUrl>#pathLine</styleUrl>${extendedDataFor(path.metadata)}
        <LineString>
          <tessellate>1</tessellate>
          <coordinates>${coords}</coordinates>
        </LineString>
      </Placemark>
    </Folder>`;
}

export function buildKml(paths: KmlPathInput[], documentName: string): string {
  const folders = paths.map(folderFor).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(documentName)}</name>
    <Style id="pathLine">
      <LineStyle>
        <color>${LINE_COLOR}</color>
        <width>3</width>
      </LineStyle>
    </Style>
${folders}
  </Document>
</kml>
`;
}
