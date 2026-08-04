import { extractPageImages } from "./pdf-image";
import { loadRaw, detectSidebarBoundary, findBlobs, type Blob } from "./segment";
import { detectSwatches } from "./colors";
import { sqmPerPixel } from "./calibrate";
import { readBlobLabels, runPool } from "./label-vision";
import { splitByNearestLabel } from "./voronoi";
import { buildTransform, pixelToLatLng, type GeoTransform } from "./georeference";
import { checkExternalFootprint, type ExternalCheck } from "./external-check";
import type {
  CalibrationInput,
  ExternalStatus,
  PagePreview,
  PreviewResponse,
  Rgb,
  SitePlanResult,
  SplitConfidence,
} from "./types";
import sharp from "sharp";

const MIN_BLOB_PIXELS = 80;
const PREVIEW_MAX_WIDTH = 1400;
// Genuine roof-vs-ground-footprint and imagery-vintage differences mean even a true match won't
// be pixel-identical — loose on purpose (see round-2 findings in the plan).
const EXTERNAL_MISMATCH_THRESHOLD_PCT = 40;
const EXTERNAL_CHECK_CONCURRENCY = 4;

export async function buildPreview(pdfBytes: Buffer): Promise<PreviewResponse> {
  const images = await extractPageImages(pdfBytes);
  if (images.length === 0) throw new Error("Couldn't find a map image inside that PDF.");

  const pages: PagePreview[] = [];
  for (const image of images) {
    const previewBuf = await sharp(image.jpeg)
      .resize({ width: Math.min(PREVIEW_MAX_WIDTH, image.pixelWidth) })
      .png()
      .toBuffer();
    pages.push({
      page: image.page,
      previewPngBase64: previewBuf.toString("base64"),
      pixelWidth: image.pixelWidth,
      pixelHeight: image.pixelHeight,
      pointWidth: image.pointWidth,
      pointHeight: image.pointHeight,
    });
  }

  const firstRaw = await loadRaw(images[0].jpeg);
  const sidebarX = detectSidebarBoundary(firstRaw);
  const swatches = await detectSwatches(firstRaw, sidebarX);

  return { pages, swatches };
}

interface RawResult {
  code: string;
  page: number;
  areaSqm: number;
  pixelCount: number;
  confidence: SplitConfidence;
  flags: string[];
  externalSource: SitePlanResult["externalSource"];
  externalAreaSqm: number | null;
  externalDeltaPct: number | null;
  externalStatus: ExternalStatus;
}

function blobCentroid(blob: Blob): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < blob.pixelCount; i++) {
    sx += blob.xs[i];
    sy += blob.ys[i];
  }
  return { x: sx / blob.pixelCount, y: sy / blob.pixelCount };
}

async function checkBlobsExternally(blobs: Blob[], transform: GeoTransform | null): Promise<(ExternalCheck | null)[]> {
  if (!transform) return blobs.map(() => null);
  return runPool(blobs, EXTERNAL_CHECK_CONCURRENCY, (blob) =>
    checkExternalFootprint(pixelToLatLng(transform, blobCentroid(blob)))
  );
}

interface ExternalFields {
  externalSource: SitePlanResult["externalSource"];
  externalAreaSqm: number | null;
  externalDeltaPct: number | null;
  externalStatus: ExternalStatus;
}

/** One external lookup covers the whole blob (a "cluster" when split across several codes) —
 * every code sharing that blob gets compared against the SAME real-world total, since an
 * external source can't tell us how to divide it between codes any better than we already do. */
function externalFieldsFor(clusterAreaSqm: number, external: ExternalCheck | null, hasTransform: boolean): ExternalFields {
  if (!hasTransform) {
    return { externalSource: null, externalAreaSqm: null, externalDeltaPct: null, externalStatus: "not_checked" };
  }
  if (!external || external.areaSqm == null || !external.source) {
    return { externalSource: null, externalAreaSqm: null, externalDeltaPct: null, externalStatus: "not_found" };
  }
  const deltaPct = ((clusterAreaSqm - external.areaSqm) / external.areaSqm) * 100;
  const status: ExternalStatus = Math.abs(deltaPct) > EXTERNAL_MISMATCH_THRESHOLD_PCT ? "mismatch" : "match";
  return { externalSource: external.source, externalAreaSqm: external.areaSqm, externalDeltaPct: deltaPct, externalStatus: status };
}

/**
 * A Google/OSM building doesn't necessarily line up with one AECOM drawing code — it can cover a
 * whole touching cluster, or a code assembled from several disconnected fragments spans more than
 * one external lookup. In either case there's no reliable way to attribute a per-code share of
 * the external area, so downgrade what would otherwise be a match/mismatch verdict to an
 * unscored reference figure — still shown, never treated as a pass/fail.
 */
function asReferenceOnly(ext: ExternalFields): ExternalFields {
  if (ext.externalStatus !== "match" && ext.externalStatus !== "mismatch") return ext;
  return { ...ext, externalStatus: "reference_only" };
}

export async function measureSitePlan(
  pdfBytes: Buffer,
  scaleRatio: number,
  color: Rgb,
  tolerance = 30,
  calibration?: CalibrationInput
): Promise<SitePlanResult[]> {
  const images = await extractPageImages(pdfBytes);
  if (images.length === 0) throw new Error("Couldn't find a map image inside that PDF.");

  const transform = calibration
    ? buildTransform(calibration.pointA.pixel, calibration.pointB.pixel, calibration.pointA.latLng, calibration.pointB.latLng)
    : null;

  const raw: RawResult[] = [];

  for (const image of images) {
    const img = await loadRaw(image.jpeg);
    const sidebarX = detectSidebarBoundary(img);
    const blobs = findBlobs(img, sidebarX, color, tolerance, MIN_BLOB_PIXELS);
    if (blobs.length === 0) continue;

    const [perBlobAnchors, perBlobExternal] = await Promise.all([
      readBlobLabels(img, blobs),
      checkBlobsExternally(blobs, transform),
    ]);
    const perPixel = sqmPerPixel(image, scaleRatio);

    blobs.forEach((blob, i) => {
      const anchors = perBlobAnchors[i];
      const clusterAreaSqm = blob.pixelCount * perPixel;
      const ext = externalFieldsFor(clusterAreaSqm, perBlobExternal[i], !!transform);

      if (anchors.length === 0) {
        raw.push({
          code: `UNLABELLED (p${image.page} #${i + 1})`,
          page: image.page,
          areaSqm: clusterAreaSqm,
          pixelCount: blob.pixelCount,
          confidence: "unlabeled",
          flags: ["No legible code found near this shape — check manually."],
          ...ext,
        });
      } else if (anchors.length === 1) {
        raw.push({
          code: anchors[0].code,
          page: image.page,
          areaSqm: clusterAreaSqm,
          pixelCount: blob.pixelCount,
          confidence: "single",
          flags: [],
          ...ext,
        });
      } else {
        const counts = splitByNearestLabel(blob, anchors);
        const referenceExt = asReferenceOnly(ext);
        for (const [code, count] of counts) {
          raw.push({
            code,
            page: image.page,
            areaSqm: count * perPixel,
            pixelCount: count,
            confidence: "split",
            flags: [`Shared footprint with ${anchors.length - 1} other building(s) — estimated split, verify.`],
            ...referenceExt,
          });
        }
      }
    });
  }

  // Merge fragments of the same code (e.g. an L-shaped building the flood-fill split on a
  // thin pinch point, or the same code appearing in a split-cluster more than once).
  const merged = new Map<string, SitePlanResult>();
  for (const r of raw) {
    const key = `${r.code}__${r.page}`;
    const existing = merged.get(key);
    if (existing) {
      existing.areaSqm += r.areaSqm;
      existing.pixelCount += r.pixelCount;
      if (r.confidence === "split" || existing.confidence === "split") existing.confidence = "split";
      for (const f of r.flags) if (!existing.flags.includes(f)) existing.flags.push(f);
      if (!existing.flags.some((f) => f.startsWith("Assembled from"))) {
        existing.flags.push("Assembled from multiple fragments on this page.");
      }
      // Prefer a fragment that actually found an external match over one that didn't — but a
      // code assembled from multiple fragments never gets a scored verdict (see asReferenceOnly):
      // the fragments' own areas get summed, while the external figure is still only ONE
      // fragment's blob total, so a "match"/"mismatch" comparison would be comparing a summed
      // number against a partial reference.
      if (existing.externalSource === null && r.externalSource !== null) {
        existing.externalSource = r.externalSource;
        existing.externalAreaSqm = r.externalAreaSqm;
        existing.externalDeltaPct = r.externalDeltaPct;
        existing.externalStatus = r.externalStatus;
      }
      existing.externalStatus = asReferenceOnly({
        externalSource: existing.externalSource,
        externalAreaSqm: existing.externalAreaSqm,
        externalDeltaPct: existing.externalDeltaPct,
        externalStatus: existing.externalStatus,
      }).externalStatus;
    } else {
      merged.set(key, { ...r });
    }
  }

  return [...merged.values()].sort((a, b) => (a.page - b.page) || a.code.localeCompare(b.code));
}
