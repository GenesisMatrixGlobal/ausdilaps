// The centres a job's distance is quoted from (Rhys, 2026-09-30): all eight capitals plus
// the regional hubs, so a Maitland job reads "from Newcastle", not "from Sydney". Pure — the
// route adds the drive. Points are each city's centre (GPO / main street), not the LGA
// centroid, because "km from the CBD" means from the middle of town.

import type { LatLng } from "@/lib/kml/types";

export interface Cbd {
  name: string;
  point: LatLng;
}

export const CBDS: readonly Cbd[] = [
  { name: "Sydney", point: { lat: -33.8688, lng: 151.2093 } },
  { name: "Melbourne", point: { lat: -37.8136, lng: 144.9631 } },
  { name: "Brisbane", point: { lat: -27.4698, lng: 153.0251 } },
  { name: "Perth", point: { lat: -31.9523, lng: 115.8613 } },
  { name: "Adelaide", point: { lat: -34.9285, lng: 138.6007 } },
  { name: "Hobart", point: { lat: -42.8821, lng: 147.3272 } },
  { name: "Canberra", point: { lat: -35.2809, lng: 149.13 } },
  { name: "Darwin", point: { lat: -12.4634, lng: 130.8456 } },
  { name: "Newcastle", point: { lat: -32.9283, lng: 151.7817 } },
  { name: "Wollongong", point: { lat: -34.4278, lng: 150.8931 } },
  { name: "Gold Coast", point: { lat: -28.0023, lng: 153.4145 } },
  { name: "Sunshine Coast", point: { lat: -26.656, lng: 153.0896 } },
  { name: "Geelong", point: { lat: -38.1499, lng: 144.3617 } },
  { name: "Toowoomba", point: { lat: -27.5598, lng: 151.9507 } },
  { name: "Townsville", point: { lat: -19.259, lng: 146.8169 } },
  { name: "Cairns", point: { lat: -16.9186, lng: 145.7781 } },
];

/** Great-circle distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** The nearest centre as the crow flies. Straight line is the right test for "which city is
 *  this job near" — the route then measures the actual drive from it. */
export function nearestCbd(point: LatLng): { cbd: Cbd; straightKm: number } {
  let best = CBDS[0];
  let bestKm = Infinity;
  for (const c of CBDS) {
    const km = haversineKm(point, c.point);
    if (km < bestKm) {
      best = c;
      bestKm = km;
    }
  }
  return { cbd: best, straightKm: bestKm };
}
