// Pure lane-count reasoning, deliberately free of any server-only dependency.
//
// These two live here rather than in enrich.ts because the CSV builder and the tool
// component both need them, and enrich.ts imports the Overpass client, which imports
// undici. Pulling that into a client bundle fails the build at runtime with
// "Cannot find module 'node:net'". Anything client-side must therefore reach for this
// module, not the enrichment orchestrator.

import { DEFAULT_LANES } from "./pricing";
import type { SegmentEnrichment } from "./types";

/** Lanes inferred from the OSM highway class when no `lanes` tag exists. */
export function lanesFromHighwayClass(highway: string): number {
  // A track is a single-width farm road. Everything else in this network — trunk through
  // unclassified — is a sealed or formed two-lane rural road.
  return highway === "track" || highway === "path" ? 1 : DEFAULT_LANES;
}

/**
 * True when a segment looks like a divided carriageway, which the lane count understates.
 *
 * OSM models a dual carriageway as two separate one-way ways, and tags `lanes` PER
 * carriageway — so the New England Highway's divided sections come back as `lanes=2,
 * oneway=yes` when a survey vehicle actually has four lanes of road to drive. Doubling
 * automatically would be presumptuous (whether both carriageways are in scope is a
 * methodology question, not a data one) and ignoring it silently underprices, so this
 * exists purely to raise it with the estimator.
 */
export function isDividedCarriageway(e: Pick<SegmentEnrichment, "oneway" | "lanesSource">): boolean {
  return e.oneway === true && e.lanesSource !== "manual";
}
