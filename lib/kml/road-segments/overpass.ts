// Fetches the real geometry of a named road from OpenStreetMap — free, no key.
// Confirmed live against Logan City data: `way["name"="Beenleigh Road"](bbox)`
// returns real way geometry.
//
// overpass-api.de load-balances across several backend nodes, and at least one of
// them was observed returning a blanket "406 Not Acceptable" for every query while
// its siblings answered normally. Node's default `fetch` (undici) pools connections
// per origin and — confirmed live — sticks to whichever backend it resolved first for
// the life of the process, so once it lands on the bad node every retry over the
// *same* dispatcher fails identically (a plain retry loop measured 0/6 success this
// way, while separate `curl` processes succeeded roughly half the time). Using a
// fresh `undici.Agent` per attempt forces a fresh connection/backend pick each time,
// which restored the expected ~50% per-attempt success rate.
import { Agent, fetch as undiciFetch } from "undici";
import type { LatLng } from "@/lib/kml/types";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

export interface OsmWay {
  id: number;
  /** The road's actual OSM name tag (may differ in abbreviation from the sheet's road name). */
  name: string;
  nodes: LatLng[];
}

/** Australian road-name abbreviation <-> full-form pairs, so "Beenleigh Rd" also matches OSM's "Beenleigh Road". */
const SUFFIXES: [string, string][] = [
  ["Rd", "Road"],
  ["St", "Street"],
  ["Ave", "Avenue"],
  ["Dr", "Drive"],
  ["Cres", "Crescent"],
  ["Ct", "Court"],
  ["Pde", "Parade"],
  ["Hwy", "Highway"],
  ["Cl", "Close"],
  ["Pl", "Place"],
  ["Tce", "Terrace"],
  ["Ln", "Lane"],
  ["Blvd", "Boulevard"],
  ["Esp", "Esplanade"],
  ["Cct", "Circuit"],
  ["Grn", "Green"],
  ["Hwy", "Highway"],
];

/** Builds the set of plausible full/abbreviated spellings of a road name for a fuzzy OSM name match. */
export function roadNameVariants(roadName: string): string[] {
  const trimmed = roadName.trim().replace(/\s+/g, " ");
  const words = trimmed.split(" ");
  const last = words[words.length - 1];
  const variants = new Set([trimmed]);

  for (const [abbr, full] of SUFFIXES) {
    if (last.toLowerCase() === abbr.toLowerCase()) {
      variants.add([...words.slice(0, -1), full].join(" "));
    }
    if (last.toLowerCase() === full.toLowerCase()) {
      variants.add([...words.slice(0, -1), abbr].join(" "));
    }
  }
  return Array.from(variants);
}

function escapeOverpassRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function attemptFetch(query: string): Promise<{ elements: unknown[] } | null> {
  const agent = new Agent({ connections: 1 });
  try {
    const res = await undiciFetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: query,
      dispatcher: agent,
    });
    return res.ok ? ((await res.json()) as { elements: unknown[] }) : null;
  } catch {
    return null;
  } finally {
    await agent.close();
  }
}

/**
 * Fires a couple of attempts per round (each on its own fresh Agent, see above) and
 * takes the first success; a bare retry loop over one pooled connection wasn't enough
 * because it kept re-hitting the same backend node.
 */
async function overpassFetch(query: string, rounds = 4, concurrency = 2): Promise<{ elements: unknown[] }> {
  for (let round = 0; round < rounds; round++) {
    const attempts = await Promise.all(Array.from({ length: concurrency }, () => attemptFetch(query)));
    const success = attempts.find((a): a is { elements: unknown[] } => a !== null);
    if (success) return success;
    if (round < rounds - 1) await new Promise((r) => setTimeout(r, 1000 * (round + 1)));
  }
  throw new Error("Overpass request failed after multiple attempts");
}

export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** A ~3km padded box around a point — plenty for one road within one suburb. */
export function bboxAround(point: LatLng, paddingKm = 3): BoundingBox {
  const latPad = paddingKm / 111;
  const lngPad = paddingKm / (111 * Math.cos((point.lat * Math.PI) / 180));
  return {
    south: point.lat - latPad,
    west: point.lng - lngPad,
    north: point.lat + latPad,
    east: point.lng + lngPad,
  };
}

interface OverpassWayElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

/**
 * Fetches every OSM way matching any spelling variant of any of `roadNames` inside `bbox`,
 * in a single Overpass call. Filters only on `name` in the query itself (confirmed live
 * against Logan City data) and checks the `highway` tag client-side — an additional
 * `["highway"]` query filter was flaky under Overpass's public-instance load in testing.
 */
export async function fetchRoadsByNames(roadNames: string[], bbox: BoundingBox): Promise<OsmWay[]> {
  const allVariants = Array.from(new Set(roadNames.flatMap(roadNameVariants))).map(escapeOverpassRegex);
  if (allVariants.length === 0) return [];
  const pattern = `^(${allVariants.join("|")})$`;
  const query =
    `[out:json][timeout:25];` +
    `way["name"~"${pattern}",i](${bbox.south},${bbox.west},${bbox.north},${bbox.east});` +
    `out geom;`;

  const data = await overpassFetch(query);
  const elements = (data.elements ?? []) as OverpassWayElement[];
  return elements
    .filter((e) => e.type === "way" && !!e.tags?.highway && !!e.tags?.name && (e.geometry?.length ?? 0) >= 2)
    .map((e) => ({
      id: e.id,
      name: e.tags!.name,
      nodes: e.geometry!.map((g) => ({ lat: g.lat, lng: g.lon })),
    }));
}

const ROAD_HIGHWAY_TAGS = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "living_street",
  "service",
]);
const FOOTWAY_HIGHWAY_TAGS = new Set(["footway", "path", "pedestrian"]);

export interface RoadNetworkNear {
  road: OsmWay[];
  footway: OsmWay[];
}

/**
 * Fetches every road + footpath way within `bbox`, split by type — unlike
 * `fetchRoadsByNames`, no name filter, since this serves corner-lot detection and
 * council-asset (road/footpath) rendering, both of which need "whatever's actually
 * there," not just one named road. One Overpass call for both tag groups.
 */
export async function fetchRoadNetworkNear(bbox: BoundingBox): Promise<RoadNetworkNear> {
  const query =
    `[out:json][timeout:25];` +
    `(` +
    `way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)$"]` +
    `(${bbox.south},${bbox.west},${bbox.north},${bbox.east});` +
    `way["highway"~"^(footway|path|pedestrian)$"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});` +
    `);` +
    `out geom;`;

  const data = await overpassFetch(query);
  const elements = (data.elements ?? []) as OverpassWayElement[];
  const road: OsmWay[] = [];
  const footway: OsmWay[] = [];
  for (const e of elements) {
    if (e.type !== "way" || !e.tags?.highway || (e.geometry?.length ?? 0) < 2) continue;
    const way: OsmWay = { id: e.id, name: e.tags.name ?? "", nodes: e.geometry!.map((g) => ({ lat: g.lat, lng: g.lon })) };
    if (ROAD_HIGHWAY_TAGS.has(e.tags.highway)) road.push(way);
    else if (FOOTWAY_HIGHWAY_TAGS.has(e.tags.highway)) footway.push(way);
  }
  return { road, footway };
}

/** True if `wayName` (an actual OSM name tag) is a spelling variant of `targetName` (from the sheet). */
export function nameMatches(wayName: string, targetName: string): boolean {
  const target = targetName.trim().toLowerCase();
  return roadNameVariants(wayName).some((v) => v.toLowerCase() === target) || wayName.trim().toLowerCase() === target;
}
