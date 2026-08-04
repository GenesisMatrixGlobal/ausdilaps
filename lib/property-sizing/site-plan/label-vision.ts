// Building codes (EDU045 etc.) are printed as part of the flattened basemap raster, not as
// PDF text, so there is no text layer to extract programmatically. Reading them back off
// cropped image regions via Claude vision mirrors the screenshot-OCR already used by the
// address lookup in this tool (see lib/property-sizing/ocr.ts).
import sharp from "sharp";
import type { RawImage, Blob } from "./segment";
import type { LabelAnchor } from "./voronoi";

const VISION_MODEL = process.env.ANTHROPIC_OCR_MODEL ?? "claude-haiku-4-5-20251001";
const BATCH_SIZE = 4;
const CONCURRENCY = 4;
// e.g. EDU045, RES010, MED003, HLS002, CMU001 — 2-4 letters then 2-4 digits.
const CODE_PATTERN = /^[A-Z]{2,4}\d{2,4}$/;

export function visionConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

interface CropJob {
  blobIndex: number;
  cropLeft: number;
  cropTop: number;
  cropWidth: number;
  cropHeight: number;
  pngBase64: string;
}

async function buildCropJobs(img: RawImage, blobs: Blob[]): Promise<CropJob[]> {
  const jobs: CropJob[] = [];
  for (let i = 0; i < blobs.length; i++) {
    const b = blobs[i];
    const w = b.maxX - b.minX + 1;
    const h = b.maxY - b.minY + 1;
    const pad = Math.min(250, Math.max(60, Math.round(0.3 * Math.max(w, h))));
    const left = Math.max(0, b.minX - pad);
    const top = Math.max(0, b.minY - pad);
    const right = Math.min(img.width, b.maxX + 1 + pad);
    const bottom = Math.min(img.height, b.maxY + 1 + pad);
    const cropWidth = right - left;
    const cropHeight = bottom - top;

    const png = await sharp(img.data, {
      raw: { width: img.width, height: img.height, channels: img.channels as 1 | 2 | 3 | 4 },
    })
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .png()
      .toBuffer();

    jobs.push({ blobIndex: i, cropLeft: left, cropTop: top, cropWidth, cropHeight, pngBase64: png.toString("base64") });
  }
  return jobs;
}

const PROMPT = `Each image is a cropped section of a coloured engineering site plan. Each crop shows one
or more solid-fill coloured building/asset footprints, each labelled with a short code
printed in bold black text (e.g. "EDU045", "RES012", "MED003"), sometimes on a white pill
background. A crop may contain more than one labelled footprint if buildings are touching.

For each crop (in order), return every legible code label visible, with its approximate
centre position as a fraction of that crop's width/height (0,0 = top-left, 1,1 = bottom-right).
Ignore labels that belong to a different colour / are clearly outside the coloured footprint(s)
in this crop's context. If a crop has no legible code, return an empty array for it.

Return ONLY a JSON array with one element per crop, in the same order as the crops:
[[{"code":"EDU045","xNorm":0.51,"yNorm":0.48}], [], [{"code":"RES012","xNorm":0.3,"yNorm":0.6}]]`;

interface VisionRow {
  code?: string;
  xNorm?: number;
  yNorm?: number;
}

async function callVisionRaw(batch: CropJob[]): Promise<VisionRow[][] | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");

  const content: Record<string, unknown>[] = [];
  batch.forEach((job, i) => {
    content.push({ type: "text", text: `Crop ${i + 1}:` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: job.pngBase64 } });
  });
  content.push({ type: "text", text: PROMPT });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.filter((b) => b.type === "text").map((b) => b.text ?? "").join("") ?? "";
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed) || parsed.length !== batch.length) return null;
    return parsed as VisionRow[][];
  } catch {
    return null;
  }
}

/**
 * A single crop with an unusually large touching-cluster or a busy batch can blow the
 * response past max_tokens and truncate the JSON — silently dropping every building in that
 * batch if we just gave up. Bisect down to single crops on failure so one bad crop can't
 * take its batch-mates down with it.
 */
async function callVision(batch: CropJob[]): Promise<VisionRow[][]> {
  const result = await callVisionRaw(batch);
  if (result) return result;
  if (batch.length === 1) return [[]];
  const mid = Math.ceil(batch.length / 2);
  const [left, right] = await Promise.all([callVision(batch.slice(0, mid)), callVision(batch.slice(mid))]);
  return [...left, ...right];
}

export async function runPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

/** Returns, per blob, the label anchors found inside/near it (absolute page-pixel coords). */
export async function readBlobLabels(img: RawImage, blobs: Blob[]): Promise<LabelAnchor[][]> {
  const jobs = await buildCropJobs(img, blobs);
  const batches: CropJob[][] = [];
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) batches.push(jobs.slice(i, i + BATCH_SIZE));

  const batchResults = await runPool(batches, CONCURRENCY, callVision);

  const perBlob: LabelAnchor[][] = blobs.map(() => []);
  batchResults.forEach((rows, batchIdx) => {
    const batch = batches[batchIdx];
    rows.forEach((row, i) => {
      const job = batch[i];
      const anchors: LabelAnchor[] = row
        .filter((r): r is Required<VisionRow> => !!r.code && typeof r.xNorm === "number" && typeof r.yNorm === "number")
        .map((r) => ({ ...r, code: r.code.trim().toUpperCase() }))
        // A code that's just a fragment of the real label (e.g. a crop boundary slicing
        // "EDU018" down to "U018") is worse than no code — it silently mislabels a building
        // rather than flagging it for a manual check. Only trust well-formed codes.
        .filter((r) => CODE_PATTERN.test(r.code))
        .map((r) => ({
          code: r.code,
          x: job.cropLeft + r.xNorm * job.cropWidth,
          y: job.cropTop + r.yNorm * job.cropHeight,
        }));
      perBlob[job.blobIndex] = anchors;
    });
  });

  return perBlob;
}
