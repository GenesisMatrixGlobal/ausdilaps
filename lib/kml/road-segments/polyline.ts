import type { LatLng } from "@/lib/kml/types";

/** Decodes Google's encoded polyline format (the algorithm behind `overview_polyline.points`). */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

function encodeSignedNumber(num: number): string {
  let signedNum = num << 1;
  if (num < 0) signedNum = ~signedNum;
  let output = "";
  while (signedNum >= 0x20) {
    output += String.fromCharCode((0x20 | (signedNum & 0x1f)) + 63);
    signedNum >>= 5;
  }
  output += String.fromCharCode(signedNum + 63);
  return output;
}

/** Encodes points into Google's encoded polyline format (the algorithm behind Static Maps `path=enc:`). */
export function encodePolyline(points: LatLng[]): string {
  let output = "";
  let prevLat = 0;
  let prevLng = 0;
  for (const { lat, lng } of points) {
    const latE5 = Math.round(lat * 1e5);
    const lngE5 = Math.round(lng * 1e5);
    output += encodeSignedNumber(latE5 - prevLat) + encodeSignedNumber(lngE5 - prevLng);
    prevLat = latE5;
    prevLng = lngE5;
  }
  return output;
}
