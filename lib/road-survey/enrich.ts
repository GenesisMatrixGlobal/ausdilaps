// Lays OSM lane/surface data and Google locality data over parsed road segments.
//
// Everything here fails soft. Enrichment is a convenience on top of a CSV that is already
// complete and priced without it, so a dead Overpass node or an exhausted geocoding quota
// must degrade to "lanes: assumed 2" and blank locality cells — never to an error that
// costs the estimator the whole run.
//
// Two facts from measuring the real Ferrovial network (766 OSM ways) shaped this:
//
//   * `lanes` coverage is excellent exactly where it matters and poor where it doesn't.
//     The New England Highway is 100% tagged and genuinely varies (274 ways at 2 lanes,
//     178 at 3, 42 at 4, 53 at 1) so taking a flat 2 there would misprice the single
//     biggest road in the network. Minor rural roads are mostly untagged, but they really
//     are two-lane, so the inferred default is right for them.
//   * `highway` and `surface` are 100% present on every way. Surface is not priced, but
//     it changes the scope conversation — Glenburnie Road is gravel and Barry Road is
//     mostly `highway=track`, which is not a video-survey road at all.

import { runPool } from "@/lib/concurrency";
import { haversineKm } from "@/lib/kml/road-segments/geo";
import {
  fetchRoadTagsByNames,
  nameMatches,
  type BoundingBox,
  type OsmWaySummary,
} from "@/lib/kml/road-segments/overpass";
import type { LatLng } from "@/lib/kml/types";
import { DEFAULT_LANES, lanesFromHighwayClass } from "./lanes";
import { reverseGeocode } from "./reverse-geocode";
import type { LanesSource, RoadSegment, SegmentEnrichment } from "./types";

/**
 * Overpass tile size in degrees. One call per tile with every road name in it, rather than
 * one call per road: 86 names against a public instance that measures roughly 50% success
 * per attempt would be both slow and flaky, while a single call spanning all 1,223 km
 * risks the server-side timeout. ~0.5 degrees puts this network in 6-8 calls.
 */
const TILE_DEGREES = 0.5;

/** Padding on each tile so a way running just past the edge is still returned. */
const TILE_PAD_DEGREES = 0.05;

/**
 * How close an OSM way's representative point must come to a segment to count as the same
 * road. Generous at 500 m because that point is the centroid of the way's bounding box,
 * not a point on the tarmac — a way that bends sharply puts its centroid off the road.
 * The name match has already done the discriminating work; this only has to reject a
 * same-named road somewhere else in the tile.
 */
const MATCH_TOLERANCE_KM = 0.5;

const GEOCODE_CONCURRENCY = 8;

/**
 * Wall-clock budget for the whole OSM phase, after which remaining tiles are skipped with
 * a warning.
 *
 * Not optional. A healthy run over the 1,223 km Ferrovial network takes about a minute,
 * but measured against a degraded Overpass fleet the same run took 498s — past the 290s
 * ceiling on the API route, which means the estimator would have got a dead request
 * instead of the partial result the fail-soft path exists to give them. 150s leaves room
 * for the geocoding phase and the response inside that ceiling.
 */
const OSM_BUDGET_MS = 150_000;

function tileKey(p: LatLng): string {
  return `${Math.floor(p.lat / TILE_DEGREES)}|${Math.floor(p.lng / TILE_DEGREES)}`;
}

/** Groups segments into geographic tiles, each carrying the bbox and names to query. */
function buildTiles(segments: RoadSegment[]): { bbox: BoundingBox; names: string[]; segments: RoadSegment[] }[] {
  const groups = new Map<string, RoadSegment[]>();
  for (const s of segments) {
    if (!s.midpoint) continue;
    const key = tileKey(s.midpoint);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  return [...groups.values()].map((group) => {
    // Bound the tile by the actual geometry in it, not by the tile grid — a 50 km road
    // whose midpoint lands in one tile still needs its far ends inside the query box.
    //
    // Accumulated in a loop rather than Math.min(...array): the Ferrovial network peaks at
    // about 8,400 points in a tile, but spreading an array into Math.min blows the argument
    // limit somewhere past ~100k and would take down enrichment for a denser file (a rail
    // corridor, a metro network) with a stack overflow rather than a useful error.
    let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
    for (const s of group) {
      for (const p of s.parts.flat()) {
        if (p.lat < south) south = p.lat;
        if (p.lat > north) north = p.lat;
        if (p.lng < west) west = p.lng;
        if (p.lng > east) east = p.lng;
      }
    }
    return {
      bbox: {
        south: south - TILE_PAD_DEGREES,
        west: west - TILE_PAD_DEGREES,
        north: north + TILE_PAD_DEGREES,
        east: east + TILE_PAD_DEGREES,
      },
      names: [...new Set(group.map((s) => s.roadName))],
      segments: group,
    };
  });
}

/**
 * True when an OSM way runs along this segment.
 *
 * Compares the way's representative point against the segment's vertices. One point per
 * way is enough because OSM splits ways at every attribute change, so they are short
 * relative to a survey segment — the New England Highway averages about 550 m per way.
 * It also keeps this O(vertices) rather than O(n*m) over two full polylines, which matters
 * at several hundred ways against 34,000 segment vertices.
 */
function wayTouchesSegment(way: OsmWaySummary, segment: RoadSegment): boolean {
  return segment.parts.some((part) => part.some((p) => haversineKm(p, way.center) <= MATCH_TOLERANCE_KM));
}

/** Most frequently occurring value, weighted by how many ways carry it. */
function modal(values: number[]): number | null {
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

function mostCommon(values: string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Derives one segment's lane/surface picture from the OSM ways that matched it. */
export function summariseWays(ways: OsmWaySummary[]): Pick<
  SegmentEnrichment,
  "lanes" | "lanesSource" | "lanesMin" | "lanesMax" | "osmHighwayClass" | "osmSurface" | "oneway"
> {
  if (ways.length === 0) {
    return {
      lanes: DEFAULT_LANES,
      lanesSource: "assumed",
      lanesMin: null,
      lanesMax: null,
      osmHighwayClass: null,
      osmSurface: null,
      oneway: null,
    };
  }

  const tagged = ways
    .map((w) => Number.parseInt(w.tags.lanes ?? "", 10))
    .filter((n) => Number.isFinite(n) && n > 0);

  const highwayClass = mostCommon(ways.map((w) => w.tags.highway).filter(Boolean));
  const surface = mostCommon(ways.map((w) => w.tags.surface).filter(Boolean));
  const oneway = ways.some((w) => w.tags.oneway === "yes");

  // Where the road is tagged, use it: the modal value is the representative lane count and
  // min/max expose the variation, so an estimator can see a 1-to-4-lane road for what it
  // is instead of trusting a single number.
  let lanes: number | null;
  let lanesSource: LanesSource;
  if (tagged.length > 0) {
    lanes = modal(tagged);
    lanesSource = "osm";
  } else {
    lanes = highwayClass ? lanesFromHighwayClass(highwayClass) : DEFAULT_LANES;
    lanesSource = highwayClass ? "osm-inferred" : "assumed";
  }

  return {
    lanes,
    lanesSource,
    lanesMin: tagged.length ? Math.min(...tagged) : null,
    lanesMax: tagged.length ? Math.max(...tagged) : null,
    osmHighwayClass: highwayClass,
    osmSurface: surface,
    oneway,
  };
}


const UNENRICHED: SegmentEnrichment = {
  lanes: DEFAULT_LANES,
  lanesSource: "assumed",
  lanesMin: null,
  lanesMax: null,
  osmHighwayClass: null,
  osmSurface: null,
  oneway: null,
  locality: null,
  lga: null,
  postcode: null,
};

export interface EnrichmentReport {
  /** Keyed by RoadSegment.id, so the client can merge onto rows it already has. */
  enrichment: Record<string, SegmentEnrichment>;
  /** Human-readable notes about what did not work — surfaced in the tool, not thrown. */
  warnings: string[];
  stats: { osmMatched: number; osmTagged: number; geocoded: number; tiles: number };
}

export async function enrichSegments(segments: RoadSegment[]): Promise<EnrichmentReport> {
  const warnings: string[] = [];
  const enrichment: Record<string, SegmentEnrichment> = {};
  for (const s of segments) enrichment[s.id] = { ...UNENRICHED };

  // --- OSM: lanes, surface, highway class ---
  const tiles = buildTiles(segments);
  let osmMatched = 0;
  let osmTagged = 0;

  // Sequential over tiles on purpose. The Overpass client already fires concurrent
  // attempts per query to dodge bad backend nodes, and hammering a free public instance
  // with parallel tile queries is the fastest way to get rate-limited off it.
  const osmDeadline = Date.now() + OSM_BUDGET_MS;
  let skippedTiles = 0;
  let skippedSegments = 0;

  for (const tile of tiles) {
    if (Date.now() > osmDeadline) {
      skippedTiles++;
      skippedSegments += tile.segments.length;
      continue;
    }

    let ways: OsmWaySummary[];
    try {
      ways = await fetchRoadTagsByNames(tile.names, tile.bbox);
    } catch (e) {
      warnings.push(`OpenStreetMap lookup failed for ${tile.names.length} roads — lanes assumed. (${(e as Error).message})`);
      continue;
    }

    // A tile of real, named roads returning nothing at all is not a normal result — it
    // means the query reached something that could not answer for this part of the world
    // (a regional Overpass instance answers out-of-area queries with an empty 200). Say so
    // rather than let 20-odd segments quietly fall through to assumed lanes.
    if (ways.length === 0) {
      warnings.push(
        `OpenStreetMap returned no roads for ${tile.segments.length} segments around ` +
          `${tile.bbox.south.toFixed(2)},${tile.bbox.west.toFixed(2)} — lanes assumed there.`
      );
      continue;
    }

    for (const segment of tile.segments) {
      const matched = ways.filter((w) => nameMatches(w.name, segment.roadName) && wayTouchesSegment(w, segment));
      if (matched.length === 0) continue;
      osmMatched++;
      const summary = summariseWays(matched);
      if (summary.lanesSource === "osm") osmTagged++;
      enrichment[segment.id] = { ...enrichment[segment.id], ...summary };
    }
  }

  if (skippedTiles > 0) {
    warnings.push(
      `OpenStreetMap was too slow to finish — ${skippedSegments} segments across ${skippedTiles} areas ` +
        `kept assumed lanes. Re-run the lookup to fill them in.`
    );
  }

  // --- Google: locality, LGA, postcode ---
  const geocodable = segments.filter((s) => s.midpoint);
  let geocoded = 0;
  let geocodeFailures = 0;
  await runPool(geocodable, GEOCODE_CONCURRENCY, async (segment) => {
    try {
      const place = await reverseGeocode(segment.midpoint!);
      enrichment[segment.id] = { ...enrichment[segment.id], ...place };
      if (place.locality || place.lga || place.postcode) geocoded++;
    } catch {
      // Swallowed per segment: one bad lookup should cost one row's locality, not the run.
      geocodeFailures++;
    }
  });
  if (geocodeFailures > 0) {
    warnings.push(`Locality lookup failed for ${geocodeFailures} of ${geocodable.length} segments — those cells are blank.`);
  }

  return { enrichment, warnings, stats: { osmMatched, osmTagged, geocoded, tiles: tiles.length } };
}
