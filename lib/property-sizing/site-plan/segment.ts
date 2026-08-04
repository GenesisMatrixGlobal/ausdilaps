import sharp from "sharp";
import type { Rgb } from "./types";

export interface RawImage {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}

export interface Blob {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  pixelCount: number;
  xs: Int32Array;
  ys: Int32Array;
}

export async function loadRaw(jpeg: Buffer): Promise<RawImage> {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/**
 * These drawings pack the map, legend and title block into one raster spanning the whole
 * page — the legend's swatch of the same fill colour would otherwise register as a false
 * "building". Detect the map/sidebar divider by finding the sidebar's long run of
 * near-white columns running to the right edge, so segmentation only looks left of it.
 */
export function detectSidebarBoundary(img: RawImage): number {
  const { data, width, height, channels } = img;
  const step = 4;
  const rows = Math.ceil(height / step);
  const whiteFrac = new Float32Array(width);

  for (let y = 0; y < height; y += step) {
    const rowBase = y * width * channels;
    for (let x = 0; x < width; x++) {
      const i = rowBase + x * channels;
      if (data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235) whiteFrac[x]++;
    }
  }
  for (let x = 0; x < width; x++) whiteFrac[x] /= rows;

  let sidebarStart = width;
  let runLen = 0;
  for (let x = width - 1; x >= 0; x--) {
    if (whiteFrac[x] > 0.5) {
      runLen++;
      sidebarStart = x;
    } else {
      if (runLen > 200) break;
      runLen = 0;
      sidebarStart = width;
    }
  }
  return sidebarStart;
}

function colorMatches(data: Buffer, i: number, target: Rgb, tolerance: number): boolean {
  return (
    Math.abs(data[i] - target.r) <= tolerance &&
    Math.abs(data[i + 1] - target.g) <= tolerance &&
    Math.abs(data[i + 2] - target.b) <= tolerance
  );
}

/**
 * Bridges 1px anti-aliasing/JPEG-noise gaps in the fill so a single building doesn't get
 * split into several tiny fragments: dilate the match mask by one pixel, then erode it back.
 */
function closeMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  const dilated = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (mask[idx]) {
        dilated[idx] = 1;
        continue;
      }
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (let dx = -1; dx <= 1 && !hit; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (mask[ny * width + nx]) hit = true;
        }
      }
      dilated[idx] = hit ? 1 : 0;
    }
  }
  const closed = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!dilated[idx]) continue;
      let allSet = true;
      for (let dy = -1; dy <= 1 && allSet; dy++) {
        for (let dx = -1; dx <= 1 && allSet; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
            continue; // treat out-of-bounds as background, doesn't block erosion at page edge
          }
          if (!dilated[ny * width + nx]) allSet = false;
        }
      }
      closed[idx] = allSet ? 1 : 0;
    }
  }
  return closed;
}

export function findBlobs(
  img: RawImage,
  sidebarX: number,
  target: Rgb,
  tolerance: number,
  minPixels: number
): Blob[] {
  const { data, width, height, channels } = img;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const rowBase = y * width * channels;
    for (let x = 0; x < sidebarX; x++) {
      if (colorMatches(data, rowBase + x * channels, target, tolerance)) mask[y * width + x] = 1;
    }
  }
  const closed = closeMask(mask, width, height);

  const visited = new Uint8Array(width * height);
  const blobs: Blob[] = [];
  // Matching pixels are a small fraction of the page, so a plain growable stack (packed
  // y*width+x indices) is far lighter than pre-sizing to the whole image.
  const stack: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < sidebarX; x++) {
      const idx = y * width + x;
      if (visited[idx] || !closed[idx]) continue;

      stack.length = 0;
      stack.push(idx);
      visited[idx] = 1;

      let minX = x, maxX = x, minY = y, maxY = y;
      const xs: number[] = [];
      const ys: number[] = [];

      while (stack.length > 0) {
        const cidx = stack.pop()!;
        const cx = cidx % width;
        const cy = (cidx - cx) / width;
        xs.push(cx);
        ys.push(cy);
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        const neighbours: [number, number][] = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ];
        for (const [nx, ny] of neighbours) {
          if (nx < 0 || nx >= sidebarX || ny < 0 || ny >= height) continue;
          const nidx = ny * width + nx;
          if (visited[nidx] || !closed[nidx]) continue;
          visited[nidx] = 1;
          stack.push(nidx);
        }
      }

      if (xs.length >= minPixels) {
        blobs.push({
          minX,
          maxX,
          minY,
          maxY,
          pixelCount: xs.length,
          xs: Int32Array.from(xs),
          ys: Int32Array.from(ys),
        });
      }
    }
  }

  return blobs;
}
