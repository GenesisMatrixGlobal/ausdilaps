// A short, stable fingerprint of a parsed road network, used as the prefix on every
// segment_id in the exported sheet.
//
// The point is round-trip safety. A client deletes rows from the sheet and sends it back;
// we rebuild the map by matching those ids against a freshly parsed source file. If that
// source file is a DIFFERENT revision of the network, the ids still look valid but now
// point at different roads — a confidently wrong map, which is the worst possible failure
// for a survey document. Carrying the fingerprint in the id makes that mismatch loud.
//
// Hashes the parsed *content* (name, folder, length per segment) rather than the raw file
// bytes: re-saving an identical network from Google Earth produces different zip bytes,
// and that should not invalidate a sheet.

/** FNV-1a, 32-bit. Not cryptographic — this only has to catch an honest mix-up. */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // Multiply by the FNV prime (16777619) in 32-bit space without overflowing a double.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

export interface FingerprintInput {
  roadName: string;
  folder: string;
  lengthKmGeometry: number;
}

/** Four uppercase hex chars, e.g. "A7F3". Deterministic for a given network. */
export function fingerprintNetwork(segments: FingerprintInput[]): string {
  const material = segments
    .map((s) => `${s.roadName}|${s.folder}|${s.lengthKmGeometry.toFixed(3)}`)
    .join("\n");
  return fnv1a(material).toString(16).toUpperCase().padStart(8, "0").slice(0, 4);
}

/** The sheet-facing id for one segment: "A7F3-001". */
export function segmentId(fingerprint: string, index: number): string {
  return `${fingerprint}-${String(index + 1).padStart(3, "0")}`;
}

/** Pulls the fingerprint back off an id. Null when it isn't our shape. */
export function fingerprintOf(id: string): string | null {
  const m = id.trim().match(/^([0-9A-F]{4})-(\d{3,})$/i);
  return m ? m[1].toUpperCase() : null;
}
