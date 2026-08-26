// Fetches the real geometry of a named road from OpenStreetMap — free, no key.
// Confirmed live against Logan City data: `way["name"="Beenleigh Road"](bbox)`
// returns real way geometry.
//
// overpass-api.de load-balances across several backend nodes, and they fail in three
// distinct ways that all used to look identical from here. Each has its own mitigation:
//
//  1. "406 Not Acceptable" on every query, while curl against the same host succeeded.
//     This was NOT a bad node — it was our request. Node's fetch sends
//     `Accept-Language: *`, which Apache's mod_negotiation on the Overpass front end
//     answers with a 406. Sending real Accept / Accept-Language / User-Agent headers
//     (REQUEST_HEADERS below) fixed it outright: the same query that returned a blanket
//     406 started returning 200s and real HTTP statuses. Same lesson as
//     lib/tenders/sources/feed.ts — an unidentified automated fetch gets refused.
//  2. One of the resolved IPs dead while its siblings answer (measured: 65.109.112.52
//     refusing while 162.55.144.139 returned 200). undici pools connections per origin
//     and sticks to whichever backend it resolved first for the life of the process, so
//     retrying over the *same* dispatcher fails identically. A fresh `undici.Agent` per
//     attempt forces a fresh connection/backend pick.
//  3. The whole overpass-api.de fleet unhealthy — measured returning 504/502/500 for
//     minutes at a time. Hence the fallback endpoint: exhaust the primary, then try the
//     mirror.
//
// Be very careful adding endpoints to that list. Several community Overpass instances are
// REGIONAL, and a regional instance does not error on an out-of-area query — it answers
// HTTP 200 with an empty element list. overpass.osm.ch was in this list briefly and
// silently turned all 1,223 km of a NSW road network into "no OSM data, assume 2 lanes"
// (measured: 0 elements for a New England Highway query, 57 for a Zurich one). A wrong
// answer that looks like a valid empty result is far worse than an outage, so only
// full-planet instances belong here.
//
// Failures now carry the HTTP status. That matters more than it sounds: every one of the
// above previously surfaced as the same "failed after multiple attempts", which is what
// made diagnosing (1) take as long as it did.
import { Agent, fetch as undiciFetch } from "undici";
import type { LatLng } from "@/lib/kml/types";

/**
 * Primary first, then the mirror. Every endpoint here MUST carry full planet data — see
 * the regional-instance warning in the header comment before adding one.
 */
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  // Kumi Systems runs a full planet mirror. Verified global coverage, unlike the
  // regional instances called out above.
  "https://overpass.kumi.systems/api/interpreter",
];

/**
 * Explicit headers, not defaults. `Accept-Language` is the one that actually matters —
 * see (1) above — but identifying ourselves is the standing house rule for any
 * unattended fetch, and Overpass's usage policy asks for it.
 */
const REQUEST_HEADERS = {
  "Content-Type": "text/plain",
  Accept: "application/json",
  "Accept-Language": "en",
  "User-Agent": "AusDilaps/1.0 (+https://ausdilaps.com.au; estimating tools; contact info@ausdilaps.com.au)",
} as const;

export interface OsmWay {
  id: number;
  /** The road's actual OSM name tag (may differ in abbreviation from the sheet's road name). */
  name: string;
  nodes: LatLng[];
  /** Every OSM tag on the way. Road-survey estimating reads `lanes`, `surface` and `oneway`. */
  tags: Record<string, string>;
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

// A shorter connect timeout than undici's ~10s default — confirmed live that when one
// of overpass-api.de's several backend IPs (it resolves to 2 IPv4 + 2 IPv6) is
// unhealthy, undici's Agent can hang the full default timeout against it. Forcing
// IPv4-only was tried first and made things *worse*: it happened to pin every attempt
// to the one bad IPv4 address every time (fast ECONNREFUSED, but always the same bad
// one), whereas leaving all 4 candidates in play lets undici's own address racing
// (same mechanism curl's Happy Eyeballs relies on) route around a bad one — it just
// needs a shorter timeout so a stalled candidate doesn't eat the whole budget.
type Attempt = { ok: true; data: { elements: unknown[] } } | { ok: false; reason: string };

async function attemptFetch(endpoint: string, query: string): Promise<Attempt> {
  const agent = new Agent({ connections: 1, connect: { timeout: 5000 } });
  try {
    const res = await undiciFetch(endpoint, {
      method: "POST",
      headers: REQUEST_HEADERS,
      body: query,
      dispatcher: agent,
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    return { ok: true, data: (await res.json()) as { elements: unknown[] } };
  } catch (e) {
    const code = (e as { cause?: { code?: string } })?.cause?.code;
    return { ok: false, reason: code ?? (e as Error).message };
  } finally {
    await agent.close();
  }
}

/**
 * Fires a couple of attempts per round (each on its own fresh Agent, see above) and takes
 * the first success, then falls through to the next endpoint. A bare retry loop over one
 * pooled connection wasn't enough because it kept re-hitting the same backend node, and
 * retrying one endpoint forever doesn't help when the whole fleet is down.
 *
 * The thrown message names the endpoint and the last real reason per endpoint, so a caller
 * can tell "we were refused" from "it timed out" from "the service is 504ing".
 */
async function overpassFetch(query: string, rounds = 2, concurrency = 2): Promise<{ elements: unknown[] }> {
  const failures: string[] = [];

  for (const endpoint of OVERPASS_ENDPOINTS) {
    let lastReason = "no attempt";
    for (let round = 0; round < rounds; round++) {
      const attempts = await Promise.all(
        Array.from({ length: concurrency }, () => attemptFetch(endpoint, query))
      );
      const success = attempts.find((a): a is { ok: true; data: { elements: unknown[] } } => a.ok);
      if (success) return success.data;
      lastReason = attempts.map((a) => (a.ok ? "ok" : a.reason)).join("/");
      if (round < rounds - 1) await new Promise((r) => setTimeout(r, 500 * (round + 1)));
    }
    failures.push(`${new URL(endpoint).host}: ${lastReason}`);
  }

  throw new Error(`Overpass unavailable — ${failures.join("; ")}`);
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
      tags: e.tags!,
    }));
}

/** A way with its tags and a single representative point, but no full geometry. */
export interface OsmWaySummary {
  id: number;
  name: string;
  /** Centroid of the way's bounding box — Overpass's `center`, not a true centroid. */
  center: LatLng;
  tags: Record<string, string>;
}

interface OverpassCenterElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  center?: { lat: number; lon: number };
}

/**
 * Same name/bbox search as fetchRoadsByNames, but asks for `out tags center` instead of
 * `out geom` — tags plus one representative point per way, no node lists.
 *
 * For attribute lookups (lanes, surface, highway class) the geometry is dead weight: a
 * single New England Highway tile returns 151 ways at 120 KB with `out geom` against
 * 54 KB with `out tags center`, and the whole 1,223 km network multiplies that by eleven
 * tiles. Callers that need to draw or trace the road still want fetchRoadsByNames.
 *
 * Note `out tags bb` looks like it should work here and does not — Overpass answers it
 * with an empty element list rather than an error, which is why this uses `center`.
 */
export async function fetchRoadTagsByNames(roadNames: string[], bbox: BoundingBox): Promise<OsmWaySummary[]> {
  const allVariants = Array.from(new Set(roadNames.flatMap(roadNameVariants))).map(escapeOverpassRegex);
  if (allVariants.length === 0) return [];
  const pattern = `^(${allVariants.join("|")})$`;
  const query =
    `[out:json][timeout:25];` +
    `way["name"~"${pattern}",i](${bbox.south},${bbox.west},${bbox.north},${bbox.east});` +
    `out tags center;`;

  const data = await overpassFetch(query);
  const elements = (data.elements ?? []) as OverpassCenterElement[];
  return elements
    .filter((e) => e.type === "way" && !!e.tags?.highway && !!e.tags?.name && !!e.center)
    .map((e) => ({
      id: e.id,
      name: e.tags!.name,
      center: { lat: e.center!.lat, lng: e.center!.lon },
      tags: e.tags!,
    }));
}

/** True if `wayName` (an actual OSM name tag) is a spelling variant of `targetName` (from the sheet). */
export function nameMatches(wayName: string, targetName: string): boolean {
  const target = targetName.trim().toLowerCase();
  return roadNameVariants(wayName).some((v) => v.toLowerCase() === target) || wayName.trim().toLowerCase() === target;
}
