// Building footprints from OpenStreetMap, for the "one house on two lots" check
// (./shared-houses.ts). Free and keyless through the public Overpass API.
//
// ⚠️ This module must NEVER throw, like parcels/addresses.ts: the check is a hint on a
// markup, not part of making one. Overpass is a volunteer service with rate limits and
// occasional slow answers, so a failure or a timeout returns [] and the markup simply gets no
// hint. OSM coverage is also uneven — a suburb nobody has traced has no footprints, which
// again just means no hint, never a wrong one.

import type { LatLng } from "@/lib/kml/types";

/** Raced: first good answer wins. The main instance is the fastest when it is well (measured
 *  5-8 s on 2026-09-30 for one block — slow enough that an 8 s cutoff lost every answer);
 *  the mirror is slower but a second chance when the main one is down. */
const OVERPASS_URLS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const TIMEOUT_MS = 18000;

interface OverpassResponse {
  elements?: { type: string; geometry?: { lat: number; lon: number }[] }[];
}

export async function fetchOsmBuildings(bbox: {
  south: number;
  west: number;
  north: number;
  east: number;
}): Promise<LatLng[][]> {
  const box = [bbox.south, bbox.west, bbox.north, bbox.east].map((n) => n.toFixed(6)).join(",");
  const query = `[out:json][timeout:15];way["building"](${box});out geom;`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const ask = async (url: string): Promise<LatLng[][]> => {
    const res = await fetch(url, {
      method: "POST",
      // Overpass's usage policy asks for an identifying User-Agent.
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "AusDilaps-QuoteBuilder/1.0 (info@ausdilaps.com.au)" },
      body: new URLSearchParams({ data: query }).toString(),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
    const body = (await res.json()) as OverpassResponse;
    return (body.elements ?? [])
      .filter((e) => e.type === "way" && (e.geometry?.length ?? 0) >= 4)
      .map((e) => e.geometry!.map((p) => ({ lat: p.lat, lng: p.lon })));
  };
  try {
    return await Promise.any(OVERPASS_URLS.map(ask));
  } catch (e) {
    const reasons = e instanceof AggregateError ? e.errors.map((x) => (x as Error).message).join("; ") : (e as Error).message;
    console.warn("[osm-buildings] no footprints:", reasons);
    return [];
  } finally {
    // Stops the slower server once the faster one has answered.
    clearTimeout(timer);
    controller.abort();
  }
}
