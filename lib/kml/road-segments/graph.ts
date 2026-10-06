// Builds a routable graph out of one named road's OSM way segments, then finds
// the shortest path between two points *within that graph* — i.e. the path is
// constrained to the named road itself, not a general-purpose shortest path
// across the whole street network.

import type { LatLng } from "@/lib/kml/types";
import type { OsmWay } from "./overpass";
import { haversineKm } from "./geo";

/** Coordinates are exact OSM node positions, so string-keying on fixed precision reliably identifies shared nodes. */
function nodeKey(p: LatLng): string {
  return `${p.lat.toFixed(7)},${p.lng.toFixed(7)}`;
}

interface Graph {
  nodes: Map<string, LatLng>;
  edges: Map<string, { to: string; distanceKm: number }[]>;
}

export function buildRoadGraph(ways: OsmWay[]): Graph {
  const nodes = new Map<string, LatLng>();
  const edges = new Map<string, { to: string; distanceKm: number }[]>();

  const addEdge = (a: string, b: string, distanceKm: number) => {
    if (!edges.has(a)) edges.set(a, []);
    edges.get(a)!.push({ to: b, distanceKm });
  };

  for (const way of ways) {
    for (let i = 0; i < way.nodes.length; i++) {
      const key = nodeKey(way.nodes[i]);
      if (!nodes.has(key)) nodes.set(key, way.nodes[i]);
    }
    for (let i = 1; i < way.nodes.length; i++) {
      const a = nodeKey(way.nodes[i - 1]);
      const b = nodeKey(way.nodes[i]);
      const d = haversineKm(way.nodes[i - 1], way.nodes[i]);
      addEdge(a, b, d);
      addEdge(b, a, d);
    }
  }

  return { nodes, edges };
}

/**
 * Finds the node in `graph` closest to any node across `otherWays` — i.e. where the
 * target road physically meets a cross-street, without relying on geocoding at all.
 */
export function nearestNodeToWays(graph: Graph, otherWays: OsmWay[]): { key: string; distanceKm: number } | null {
  const otherPoints = otherWays.flatMap((w) => w.nodes);
  if (otherPoints.length === 0) return null;
  let best: { key: string; distanceKm: number } | null = null;
  for (const [key, node] of graph.nodes) {
    for (const other of otherPoints) {
      const d = haversineKm(node, other);
      if (!best || d < best.distanceKm) best = { key, distanceKm: d };
    }
  }
  return best;
}

/** Plain Dijkstra — these graphs are small (one road within one suburb), so no heap is needed. */
export function shortestPath(graph: Graph, fromKey: string, toKey: string): LatLng[] | null {
  const dist = new Map<string, number>([[fromKey, 0]]);
  const prev = new Map<string, string>();
  const visited = new Set<string>();

  while (visited.size < graph.nodes.size) {
    let current: string | null = null;
    let currentDist = Infinity;
    for (const [key, d] of dist) {
      if (!visited.has(key) && d < currentDist) {
        current = key;
        currentDist = d;
      }
    }
    if (current === null) break;
    if (current === toKey) break;
    visited.add(current);

    for (const edge of graph.edges.get(current) ?? []) {
      if (visited.has(edge.to)) continue;
      const candidate = currentDist + edge.distanceKm;
      if (candidate < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, candidate);
        prev.set(edge.to, current);
      }
    }
  }

  if (!dist.has(toKey)) return null;

  const path: string[] = [toKey];
  let cursor = toKey;
  while (cursor !== fromKey) {
    const p = prev.get(cursor);
    if (!p) return null;
    path.push(p);
    cursor = p;
  }
  path.reverse();
  return path.map((key) => graph.nodes.get(key)!);
}
