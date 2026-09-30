// "Is this one house on two lots?" — the pure half. No fetches; lib/kml/standard-markup/
// osm-buildings.ts supplies the footprints and the route glues them together.
//
// Why it exists (Rhys, 2026-09-30, 29 Barlow Street, Clayfield): old Brisbane subdivisions
// cut the street into ~10 m x 40 m lots, and one house was often built across two of them.
// The cadastre has two titles and the address layer two addresses (26 AND 26A Upper
// Lancaster Road), so everything the tool reads says "two properties" — and the sheet got two
// line items for one house. The only thing that sees the house is its BUILDING OUTLINE: one
// footprint sitting substantially on both lots.

import type { LatLng } from "@/lib/kml/types";
import { pointInRing, projectToLocalMetres, ringAreaSqm, unprojectFromLocalMetres } from "./geometry";

/** A shed or carport on the boundary is not a house — only footprints at least this big count. */
export const MIN_BUILDING_SQM = 40;
/** A building "sits on" a lot when at least this share of its footprint is inside it. High
 *  enough that a 2 m overhang (or OpenStreetMap drawing the house a little off the imagery)
 *  doesn't drag a third lot in; low enough that a house centred on the line is caught. */
export const MIN_SHARE = 0.2;
/** Sampling grid for the footprint shares, in metres. */
const GRID_M = 0.5;

export interface LotOutline {
  id: string;
  ring: LatLng[];
}

/** Groups of two or more lot ids that one building sits on. Lots in a strata plan are left
 *  out: a building across strata lots is one building with many titles BY DEFINITION, and is
 *  handled as a shared parcel, not as a house on two lots. */
export function findSharedHouses(lots: LotOutline[], buildings: LatLng[][]): string[][] {
  const candidates = lots.filter((l) => l.ring.length >= 3 && !/SP\d/i.test(l.id));
  // Union-find, so a house across three lots (or two houses chaining lots A-B and B-C) comes
  // out as ONE group rather than two overlapping ones.
  const parent = new Map(candidates.map((l) => [l.id, l.id]));
  const find = (id: string): string => {
    let r = id;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  let joined = false;

  for (const b of buildings) {
    if (b.length < 3 || ringAreaSqm(b) < MIN_BUILDING_SQM) continue;
    const on = lotsUnder(b, candidates);
    for (let i = 1; i < on.length; i++) {
      parent.set(find(on[i]), find(on[0]));
      joined = true;
    }
  }
  if (!joined) return [];

  const groups = new Map<string, string[]>();
  for (const l of candidates) {
    const root = find(l.id);
    groups.set(root, [...(groups.get(root) ?? []), l.id]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** The lots holding at least MIN_SHARE of this footprint, by sampling it on a grid. Sampling
 *  rather than polygon clipping: one pointInRing per sample is all it needs, and at 0.5 m the
 *  error on a house-sized footprint is well under the share threshold. */
function lotsUnder(building: LatLng[], lots: LotOutline[]): string[] {
  const origin = building[0];
  const local = building.map((p) => projectToLocalMetres(origin, p));
  const minE = Math.min(...local.map((p) => p.east));
  const maxE = Math.max(...local.map((p) => p.east));
  const minN = Math.min(...local.map((p) => p.north));
  const maxN = Math.max(...local.map((p) => p.north));
  // Only lots near the building are tested.
  const near = lots.filter((l) => l.ring.some((p) => {
    const d = projectToLocalMetres(origin, p);
    return d.east > minE - 60 && d.east < maxE + 60 && d.north > minN - 60 && d.north < maxN + 60;
  }));
  if (near.length < 2) return [];

  const counts = new Map<string, number>();
  let total = 0;
  for (let e = minE + GRID_M / 2; e < maxE; e += GRID_M) {
    for (let n = minN + GRID_M / 2; n < maxN; n += GRID_M) {
      const p = unprojectFromLocalMetres(origin, { east: e, north: n });
      if (!pointInRing(p, building)) continue;
      total++;
      const lot = near.find((l) => pointInRing(p, l.ring));
      if (lot) counts.set(lot.id, (counts.get(lot.id) ?? 0) + 1);
    }
  }
  if (total === 0) return [];
  return [...counts.entries()].filter(([, c]) => c / total >= MIN_SHARE).map(([id]) => id);
}

/** The outline of two lots that share an edge, as ONE ring — or null when they don't share
 *  one cleanly. Adjoining lots in the same cadastre share their boundary vertices EXACTLY, so
 *  the union is: drop every edge the two rings have in common, and walk what is left. A
 *  T-junction (one lot's edge ending partway along the other's) has no exact common edge, so
 *  it returns null and the caller keeps the lots separate rather than drawing a wrong shape. */
export function unionAdjacentRings(a: LatLng[], b: LatLng[]): LatLng[] | null {
  const key = (p: LatLng) => `${p.lat.toFixed(9)},${p.lng.toFixed(9)}`;
  const edges = (ring: LatLng[]) => {
    const open = ring.length > 1 && key(ring[0]) === key(ring[ring.length - 1]) ? ring.slice(0, -1) : ring;
    return open.map((p, i) => [p, open[(i + 1) % open.length]] as const);
  };
  const ea = edges(a);
  const eb = edges(b);
  const undirected = (e: readonly [LatLng, LatLng]) => [key(e[0]), key(e[1])].sort().join("|");
  const inA = new Set(ea.map(undirected));
  const inB = new Set(eb.map(undirected));
  const shared = new Set([...inA].filter((k) => inB.has(k)));
  if (shared.size === 0) return null;

  // Orient both rings the same way round, so the kept edges chain head to tail.
  const signed = (ring: LatLng[]) => {
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      s += p.lng * q.lat - q.lng * p.lat;
    }
    return s;
  };
  const orient = (es: (readonly [LatLng, LatLng])[], ring: LatLng[]) =>
    signed(ring) < 0 ? es.map(([p, q]) => [q, p] as const) : es;
  const kept = [...orient(ea, a), ...orient(eb, b)].filter((e) => !shared.has(undirected(e)));

  const next = new Map<string, LatLng>();
  for (const [p, q] of kept) {
    if (next.has(key(p))) return null; // a vertex with two ways out: not a simple outline
    next.set(key(p), q);
  }
  const start = kept[0][0];
  const out: LatLng[] = [start];
  let cur = next.get(key(start));
  while (cur && key(cur) !== key(start)) {
    out.push(cur);
    if (out.length > kept.length) return null;
    cur = next.get(key(cur));
  }
  // Every kept edge must have been walked, or the union has a hole or a second piece.
  return cur && out.length === kept.length ? [...out, start] : null;
}

/** "26 & 26A Upper Lancaster Road" from ["26 Upper Lancaster Road", "26A Upper Lancaster
 *  Road"] — the street said once when they share it, else the addresses joined. */
export function mergedStreet(streets: (string | null | undefined)[]): string | null {
  const known = streets.filter((s): s is string => Boolean(s && s.trim()));
  if (known.length === 0) return null;
  const parts = known.map((s) => s.match(/^(\S+)\s+(.+)$/));
  const road = parts[0]?.[2];
  if (parts.every((m) => m && m[2].toLowerCase() === road?.toLowerCase())) {
    // House-number order, so 26A comes after 26 whichever lot the check listed first.
    const numbers = parts.map((m) => m![1]).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return `${numbers.join(" & ")} ${road}`;
  }
  return known.join(" & ");
}
