import sharp from "sharp";
import type { RawImage } from "./segment";
import type { ColorSwatch } from "./types";

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Surveys the map area (sidebar excluded) for the handful of flat, saturated fill colours
 * used to code building/feature categories (magenta = Educational, orange = Residential,
 * etc.) — these drawings use a small fixed legend palette, so a coarse colour histogram
 * reliably finds each category without needing to OCR the legend text.
 */
export async function detectSwatches(
  img: RawImage,
  sidebarX: number,
  maxSwatches = 8
): Promise<ColorSwatch[]> {
  const { data, width, height, channels } = img;
  const bucket = 16;
  const buckets = new Map<string, { r: number; g: number; b: number; count: number; sampleX: number; sampleY: number }>();

  const step = 5;
  for (let y = 0; y < height; y += step) {
    const rowBase = y * width * channels;
    for (let x = 0; x < sidebarX; x += step) {
      const i = rowBase + x * channels;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      // Skip low-saturation pixels (aerial imagery greens/browns/greys, roads, white space).
      if (max - min < 45) continue;
      if (r > 235 && g > 235 && b > 235) continue;

      const qr = Math.min(255, Math.round(r / bucket) * bucket);
      const qg = Math.min(255, Math.round(g / bucket) * bucket);
      const qb = Math.min(255, Math.round(b / bucket) * bucket);
      const key = `${qr},${qg},${qb}`;
      const existing = buckets.get(key);
      if (existing) existing.count++;
      else buckets.set(key, { r: qr, g: qg, b: qb, count: 1, sampleX: x, sampleY: y });
    }
  }

  const top = [...buckets.values()].sort((a, b) => b.count - a.count).slice(0, maxSwatches);
  const swatches: ColorSwatch[] = [];

  for (const t of top) {
    const size = 140;
    const left = Math.max(0, Math.min(sidebarX - size, t.sampleX - size / 2));
    const top_ = Math.max(0, Math.min(height - size, t.sampleY - size / 2));
    const cropBuf = await sharp(img.data, { raw: { width, height, channels: channels as 1 | 2 | 3 | 4 } })
      .extract({ left: Math.round(left), top: Math.round(top_), width: size, height: size })
      .png()
      .toBuffer();
    swatches.push({
      rgb: { r: t.r, g: t.g, b: t.b },
      hex: toHex(t.r, t.g, t.b),
      pixelCount: t.count,
      samplePngBase64: cropBuf.toString("base64"),
    });
  }

  return swatches;
}
