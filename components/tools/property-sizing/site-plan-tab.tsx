"use client";

import { useRef, useState, type MouseEvent } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import type { ColorSwatch, PagePreview, Rgb, SitePlanResult } from "@/lib/property-sizing/site-plan/types";
import { scaleRatioFromReference, type LatLng, type PixelPoint } from "@/lib/property-sizing/site-plan/georeference";

async function fileToBase64(file: File): Promise<{ data: string; mediaType: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const [prefix, data] = dataUrl.split(",", 2);
  const mediaType = prefix.match(/data:(.*);base64/)?.[1] ?? file.type ?? "application/pdf";
  return { data, mediaType };
}

function tsv(rows: string[][]): string {
  return rows.map((r) => r.join("\t")).join("\n");
}

function parseHexColor(input: string): Rgb | null {
  const hex = input.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function parseLatLng(input: string): LatLng | null {
  const m = input.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

interface RefPoint {
  pixel: PixelPoint | null;
  latLngText: string;
}

interface CropData {
  pngBase64: string;
  cropLeft: number;
  cropTop: number;
  cropWidth: number;
  cropHeight: number;
}

const REFINE_DISPLAY_SIZE = 440; // CSS px — the crop always renders at this size regardless of native dims

const CONFIDENCE_LABEL: Record<SitePlanResult["confidence"], string> = {
  single: "Measured",
  split: "Estimated (shared)",
  unlabeled: "No code found",
};

const EXTERNAL_SOURCE_LABEL: Record<"google-solar" | "osm", string> = {
  "google-solar": "Google",
  osm: "OSM",
};

function externalCheckText(r: SitePlanResult): string {
  if (r.externalStatus === "not_checked") return "";
  if (r.externalStatus === "not_found") return "No match nearby";
  const src = r.externalSource ? EXTERNAL_SOURCE_LABEL[r.externalSource] : "?";
  const area = r.externalAreaSqm != null ? r.externalAreaSqm.toFixed(1) : "?";
  if (r.externalStatus === "reference_only") {
    return `Cluster reference — ${area} m² ${src}, not individually verifiable`;
  }
  if (r.externalStatus === "match") return `Match — ${area} m² ${src}`;
  const pct = r.externalDeltaPct != null ? Math.abs(r.externalDeltaPct).toFixed(0) : "?";
  return `Mismatch — ${area} m² ${src}, ${pct}% off`;
}

export function SitePlanTab() {
  const [file, setFile] = useState<File | null>(null);
  const [scaleRatio, setScaleRatio] = useState("");
  const [tolerance, setTolerance] = useState("30");
  const [dragActive, setDragActive] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<PagePreview[] | null>(null);
  const [swatches, setSwatches] = useState<ColorSwatch[] | null>(null);
  const [selectedColor, setSelectedColor] = useState<Rgb | null>(null);
  const [customHex, setCustomHex] = useState("");
  const [customHexError, setCustomHexError] = useState<string | null>(null);
  const [results, setResults] = useState<SitePlanResult[] | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [showCalibration, setShowCalibration] = useState(false);
  const [activePoint, setActivePoint] = useState<"A" | "B">("A");
  const [refA, setRefA] = useState<RefPoint>({ pixel: null, latLngText: "" });
  const [refB, setRefB] = useState<RefPoint>({ pixel: null, latLngText: "" });
  const [calibratedRatio, setCalibratedRatio] = useState<number | null>(null);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);

  const [refiningPoint, setRefiningPoint] = useState<"A" | "B" | null>(null);
  const [refiningCrop, setRefiningCrop] = useState<CropData | null>(null);
  const [refiningRoughPixel, setRefiningRoughPixel] = useState<PixelPoint | null>(null);
  const [refiningLoading, setRefiningLoading] = useState(false);
  const [refiningError, setRefiningError] = useState<string | null>(null);

  function chooseFile(f: File | null) {
    setError(null);
    setFile(f);
    setPages(null);
    setSwatches(null);
    setSelectedColor(null);
    setCustomHex("");
    setCustomHexError(null);
    setResults(null);
    setRefA({ pixel: null, latLngText: "" });
    setRefB({ pixel: null, latLngText: "" });
    setCalibratedRatio(null);
    setCalibrationError(null);
    setRefiningPoint(null);
    setRefiningCrop(null);
    setRefiningRoughPixel(null);
    setRefiningError(null);
  }

  async function startRefine(point: "A" | "B", roughPixel: PixelPoint) {
    if (!file || !pages || pages.length === 0) return;
    setRefiningPoint(point);
    setRefiningRoughPixel(roughPixel);
    setRefiningCrop(null);
    setRefiningError(null);
    setRefiningLoading(true);
    try {
      const pdf = await fileToBase64(file);
      const res = await fetch("/api/property-sizing/site-plan/crop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pdf, page: pages[0].page, x: roughPixel.x, y: roughPixel.y }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string } & Partial<CropData>;
      if (!json.ok || !json.pngBase64) {
        setRefiningError(json.error ?? "Couldn't load a close-up for that point.");
        return;
      }
      setRefiningCrop({
        pngBase64: json.pngBase64,
        cropLeft: json.cropLeft!,
        cropTop: json.cropTop!,
        cropWidth: json.cropWidth!,
        cropHeight: json.cropHeight!,
      });
    } catch (e) {
      setRefiningError((e as Error).message);
    } finally {
      setRefiningLoading(false);
    }
  }

  function handlePreviewClick(e: MouseEvent<HTMLImageElement>) {
    if (!pages || pages.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const page1 = pages[0];
    const pixel: PixelPoint = {
      x: ((e.clientX - rect.left) / rect.width) * page1.pixelWidth,
      y: ((e.clientY - rect.top) / rect.height) * page1.pixelHeight,
    };
    void startRefine(activePoint, pixel);
  }

  function finalizeRefine(pixel: PixelPoint) {
    const point = refiningPoint;
    if (!point) return;
    if (point === "A") setRefA((prev) => ({ ...prev, pixel }));
    else setRefB((prev) => ({ ...prev, pixel }));
    setActivePoint(point === "A" ? "B" : "A");
    setRefiningPoint(null);
    setRefiningCrop(null);
    setRefiningRoughPixel(null);
    setRefiningError(null);
    setCalibratedRatio(null);
  }

  function handleRefineClick(e: MouseEvent<HTMLImageElement>) {
    if (!refiningCrop) return;
    const rect = e.currentTarget.getBoundingClientRect();
    finalizeRefine({
      x: refiningCrop.cropLeft + ((e.clientX - rect.left) / rect.width) * refiningCrop.cropWidth,
      y: refiningCrop.cropTop + ((e.clientY - rect.top) / rect.height) * refiningCrop.cropHeight,
    });
  }

  function useRoughClick() {
    if (refiningRoughPixel) finalizeRefine(refiningRoughPixel);
  }

  function cancelRefine() {
    setRefiningPoint(null);
    setRefiningCrop(null);
    setRefiningRoughPixel(null);
    setRefiningError(null);
  }

  function calculateCalibration() {
    setCalibrationError(null);
    setCalibratedRatio(null);
    if (!pages || pages.length === 0) return;
    if (!refA.pixel || !refB.pixel) {
      setCalibrationError("Click both reference points on the plan first.");
      return;
    }
    const latLngA = parseLatLng(refA.latLngText);
    const latLngB = parseLatLng(refB.latLngText);
    if (!latLngA || !latLngB) {
      setCalibrationError('Enter both points\' coordinates as "lat,lng" (from Google Maps → right-click → What\'s here?).');
      return;
    }
    const page1 = pages[0];
    const ratio = scaleRatioFromReference(refA.pixel, refB.pixel, latLngA, latLngB, page1.pointWidth, page1.pixelWidth);
    if (!Number.isFinite(ratio) || ratio <= 0) {
      setCalibrationError("Couldn't calculate a scale from those points — try two points further apart.");
      return;
    }
    setCalibratedRatio(ratio);
  }

  function applyCustomHex() {
    const rgb = parseHexColor(customHex);
    if (!rgb) {
      setCustomHexError('Enter a 6-digit hex colour, e.g. "de78ff".');
      return;
    }
    setCustomHexError(null);
    setSelectedColor(rgb);
  }

  async function loadPreview() {
    setError(null);
    setResults(null);
    if (!file) {
      setError("Drop in a PDF site plan first.");
      return;
    }
    setLoadingPreview(true);
    try {
      const pdf = await fileToBase64(file);
      const res = await fetch("/api/property-sizing/site-plan/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pdf }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        pages?: PagePreview[];
        swatches?: ColorSwatch[];
      };
      if (!json.ok) {
        setError(json.error ?? "Couldn't read that PDF.");
        return;
      }
      setPages(json.pages ?? []);
      setSwatches(json.swatches ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingPreview(false);
    }
  }

  function useCalibratedRatio() {
    if (!calibratedRatio) return;
    setScaleRatio(String(Math.round(calibratedRatio)));
  }

  async function measure() {
    setError(null);
    setResults(null);
    if (!file || !selectedColor) {
      setError("Load the preview and pick a colour to measure first.");
      return;
    }
    const ratio = Number(scaleRatio);
    if (!ratio || ratio <= 0) {
      setError("Enter the drawing's print scale — the N in \"1:N\" shown on the plan.");
      return;
    }
    setMeasuring(true);
    try {
      const pdf = await fileToBase64(file);
      const latLngA = parseLatLng(refA.latLngText);
      const latLngB = parseLatLng(refB.latLngText);
      const calibration =
        refA.pixel && refB.pixel && latLngA && latLngB
          ? { pointA: { pixel: refA.pixel, latLng: latLngA }, pointB: { pixel: refB.pixel, latLng: latLngB } }
          : undefined;
      const res = await fetch("/api/property-sizing/site-plan/measure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pdf,
          scaleRatio: ratio,
          color: selectedColor,
          tolerance: Number(tolerance) || 30,
          calibration,
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; results?: SitePlanResult[] };
      if (!json.ok) {
        setError(json.error ?? "Something went wrong measuring that plan.");
        return;
      }
      setResults(json.results ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMeasuring(false);
    }
  }

  async function copyResults() {
    if (!results) return;
    const rows = [
      ["Code", "Page", "Area (m2)", "Status", "External check", "Notes"],
      ...results.map((r) => [
        r.code,
        String(r.page),
        r.areaSqm.toFixed(1),
        CONFIDENCE_LABEL[r.confidence],
        externalCheckText(r),
        r.flags.join("; "),
      ]),
    ];
    await navigator.clipboard.writeText(tsv(rows));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadCsv() {
    if (!results) return;
    const header = "Code,Page,Area (m2),Status,External check,Notes";
    const lines = results.map((r) =>
      [r.code, String(r.page), r.areaSqm.toFixed(1), CONFIDENCE_LABEL[r.confidence], externalCheckText(r), r.flags.join("; ")]
        .map(csvField)
        .join(",")
    );
    const name = (file?.name ?? "site-plan").replace(/\.pdf$/i, "");
    downloadBlob([header, ...lines].join("\n"), `${name}-measurements.csv`, "text/csv");
  }

  return (
    <div className="mt-8">
      <p className="max-w-2xl text-sm text-ad-muted">
        Upload a coloured site/receptor plan (an ArcGIS/QGIS-style PDF where each building is
        filled with a category colour and labelled with a code). Pick the colour you want and
        the tool measures every shape of that colour and reads its code off the map.
      </p>

      {/* Upload + scale */}
      <div className="mt-4 rounded-xl border border-ad-border bg-white p-5">
        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragActive(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            const f = e.dataTransfer.files?.[0];
            if (f && f.type === "application/pdf") chooseFile(f);
            else setError("That doesn't look like a PDF file.");
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
            dragActive ? "border-ad-orange bg-ad-orange/10" : "border-ad-border hover:bg-ad-surface"
          )}
        >
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              chooseFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
          <p className="font-medium text-ad-ink">
            {file ? file.name : dragActive ? "Drop it here" : "Drag & drop the site plan PDF here, or click to browse"}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="block text-sm font-medium text-ad-ink">
            Print scale (the N in &ldquo;1:N&rdquo;)
            <input
              value={scaleRatio}
              onChange={(e) => setScaleRatio(e.target.value)}
              inputMode="numeric"
              placeholder="e.g. 2750"
              className="mt-1 w-36 rounded-lg border border-ad-border p-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
            />
          </label>
          <label className="block text-sm font-medium text-ad-ink">
            Colour match tolerance
            <input
              value={tolerance}
              onChange={(e) => setTolerance(e.target.value)}
              inputMode="numeric"
              className="mt-1 w-24 rounded-lg border border-ad-border p-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
            />
          </label>
          <button
            className={cn(buttonVariants({ variant: "outline", size: "md" }), loadingPreview && "opacity-60")}
            onClick={loadPreview}
            disabled={loadingPreview || !file}
          >
            {loadingPreview ? "Reading plan…" : "Load preview & colours"}
          </button>
        </div>
        <p className="mt-2 text-xs text-ad-muted">
          The scale ratio is printed on the drawing, e.g. &ldquo;Scale 1:2,750 (when printed at
          A3)&rdquo; — enter 2750. It applies to every page.
        </p>
        {pages && pages.length > 0 && (
          <button
            type="button"
            className="mt-3 text-xs font-medium text-ad-steel underline underline-offset-2"
            onClick={() => setShowCalibration((v) => !v)}
          >
            {showCalibration ? "Hide" : "Printed scale looks wrong? Check it against Google Maps →"}
          </button>
        )}
      </div>

      {/* Google Maps cross-check */}
      {showCalibration && pages && pages.length > 0 && (
        <div className="mt-6 rounded-xl border border-ad-border bg-white p-5">
          <p className="text-sm font-medium text-ad-ink">Check the scale against Google Maps</p>
          <p className="mt-1 max-w-2xl text-xs text-ad-muted">
            Pick two identifiable points on the plan below (a road corner, a building corner —
            anything you can also find on a map). For each, open Google Maps, right-click that
            same real-world spot → &ldquo;What&apos;s here?&rdquo; → copy the coordinates shown, and
            paste them in as &ldquo;lat,lng&rdquo;. The tool works out the real scale from the
            distance between them and compares it to what&apos;s printed.
          </p>
          <p className="mt-2 max-w-2xl text-xs text-ad-muted">
            Setting these two points also switches on an <span className="font-medium text-ad-ink">external check</span>{" "}
            — every isolated (non-shared) building gets compared against its real-world footprint
            (Google, or OpenStreetMap when Google has no data there) and flagged if the two
            disagree by more than 40%. Buildings that share a footprint with a neighbour show a
            reference figure only — an external source can&apos;t verify per-building splits.
          </p>

          {refiningPoint ? (
            <div className="mt-4 rounded-lg border border-ad-border bg-ad-surface p-4">
              <p className="text-sm font-medium text-ad-ink">
                Fine-tune point{" "}
                <span className={refiningPoint === "A" ? "text-ad-orange" : "text-ad-steel"}>{refiningPoint}</span>
                {" "}— click the exact spot
              </p>
              <p className="mt-1 text-xs text-ad-muted">
                Zoomed in for precision. Click the exact corner/point this time.
              </p>
              <div className="mt-3 flex flex-wrap items-start gap-4">
                <div
                  className="relative overflow-hidden rounded-lg border border-ad-border bg-white"
                  style={{ width: REFINE_DISPLAY_SIZE, height: REFINE_DISPLAY_SIZE }}
                >
                  {refiningLoading && (
                    <p className="flex h-full items-center justify-center text-sm text-ad-muted">Loading close-up…</p>
                  )}
                  {refiningError && (
                    <p className="flex h-full items-center justify-center p-4 text-center text-sm text-ad-orange">
                      {refiningError}
                    </p>
                  )}
                  {refiningCrop && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`data:image/png;base64,${refiningCrop.pngBase64}`}
                      alt="Zoomed reference point"
                      onClick={handleRefineClick}
                      className="cursor-crosshair select-none"
                      style={{ width: REFINE_DISPLAY_SIZE, height: REFINE_DISPLAY_SIZE }}
                    />
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    onClick={useRoughClick}
                    disabled={!refiningRoughPixel}
                  >
                    Use rough click instead
                  </button>
                  <button className={cn(buttonVariants({ variant: "outline", size: "sm" }))} onClick={cancelRefine}>
                    Cancel, re-click on the plan
                  </button>
                </div>
              </div>
            </div>
          ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-[1fr_260px]">
            <div className="relative overflow-hidden rounded-lg border border-ad-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:image/png;base64,${pages[0].previewPngBase64}`}
                alt="Site plan page 1 preview"
                onClick={handlePreviewClick}
                className="block w-full cursor-crosshair select-none"
              />
              {refA.pixel && (
                <span
                  className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-ad-orange shadow"
                  style={{
                    left: `${(refA.pixel.x / pages[0].pixelWidth) * 100}%`,
                    top: `${(refA.pixel.y / pages[0].pixelHeight) * 100}%`,
                  }}
                >
                  <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs font-bold text-ad-orange">A</span>
                </span>
              )}
              {refB.pixel && (
                <span
                  className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-ad-steel shadow"
                  style={{
                    left: `${(refB.pixel.x / pages[0].pixelWidth) * 100}%`,
                    top: `${(refB.pixel.y / pages[0].pixelHeight) * 100}%`,
                  }}
                >
                  <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs font-bold text-ad-steel">B</span>
                </span>
              )}
            </div>

            <div className="flex flex-col gap-4">
              <p className="text-xs text-ad-muted">
                Click the plan to drop point <span className="font-semibold text-ad-orange">A</span>, then{" "}
                <span className="font-semibold text-ad-steel">B</span>. Click again to move whichever
                point you set last (currently{" "}
                <span className="font-semibold">{activePoint}</span>).
              </p>
              <label className="block text-sm font-medium text-ad-ink">
                Point A — lat,lng
                <input
                  value={refA.latLngText}
                  onChange={(e) => setRefA((prev) => ({ ...prev, latLngText: e.target.value }))}
                  placeholder="-27.4515, 153.0234"
                  className="mt-1 w-full rounded-lg border border-ad-border p-2 font-mono text-xs text-ad-ink outline-none focus:border-ad-steel"
                />
              </label>
              <label className="block text-sm font-medium text-ad-ink">
                Point B — lat,lng
                <input
                  value={refB.latLngText}
                  onChange={(e) => setRefB((prev) => ({ ...prev, latLngText: e.target.value }))}
                  placeholder="-27.4489, 153.0261"
                  className="mt-1 w-full rounded-lg border border-ad-border p-2 font-mono text-xs text-ad-ink outline-none focus:border-ad-steel"
                />
              </label>
              <button className={cn(buttonVariants({ variant: "outline", size: "sm" }))} onClick={calculateCalibration}>
                Calculate scale
              </button>
              {calibrationError && <p className="text-xs text-ad-orange">{calibrationError}</p>}
              {calibratedRatio && (
                <div className="rounded-lg border border-ad-border bg-ad-surface p-3">
                  <p className="text-sm font-semibold text-ad-ink">
                    Google Maps says 1:{Math.round(calibratedRatio).toLocaleString("en-AU")}
                  </p>
                  {Number(scaleRatio) > 0 && (
                    <p className="mt-1 text-xs text-ad-muted">
                      Printed scale is 1:{Number(scaleRatio).toLocaleString("en-AU")} — that&apos;s{" "}
                      <span className={cn(Math.abs(calibratedRatio - Number(scaleRatio)) / calibratedRatio > 0.03 ? "font-semibold text-ad-orange" : "font-medium text-ad-ink")}>
                        {(((Number(scaleRatio) - calibratedRatio) / calibratedRatio) * 100).toFixed(1)}%
                      </span>{" "}
                      off.
                    </p>
                  )}
                  <button
                    className={cn(buttonVariants({ variant: "accent", size: "sm" }), "mt-2")}
                    onClick={useCalibratedRatio}
                  >
                    Use this scale instead
                  </button>
                </div>
              )}
            </div>
          </div>
          )}
        </div>
      )}

      {/* Swatch picker */}
      {swatches && swatches.length > 0 && (
        <div className="mt-6 rounded-xl border border-ad-border bg-white p-5">
          <p className="text-sm font-medium text-ad-ink">Which colour do you want measured?</p>
          <p className="mt-1 text-xs text-ad-muted">Detected from page 1 — used across all {pages?.length ?? 1} page(s).</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {swatches.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setSelectedColor(s.rgb)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border p-2 transition-colors",
                  selectedColor?.r === s.rgb.r && selectedColor?.g === s.rgb.g && selectedColor?.b === s.rgb.b
                    ? "border-ad-orange bg-ad-orange/10"
                    : "border-ad-border hover:border-ad-steel"
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/png;base64,${s.samplePngBase64}`}
                  alt={s.hex}
                  className="h-16 w-16 rounded-md object-cover"
                />
                <span className="text-xs font-mono text-ad-muted">{s.hex}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Custom colour */}
      {file && (
        <div className="mt-6 rounded-xl border border-ad-border bg-white p-5">
          <p className="text-sm font-medium text-ad-ink">
            Don&apos;t see the right colour above? Type it in directly.
          </p>
          <p className="mt-1 text-xs text-ad-muted">
            Sample the colour from the PDF with any colour-picker (e.g. macOS Digital Colour
            Meter, or a browser eyedropper) and paste the hex code here.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span
              className="h-9 w-9 rounded-lg border border-ad-border"
              style={{ backgroundColor: parseHexColor(customHex) ? `#${customHex.replace(/^#/, "")}` : "transparent" }}
              aria-hidden
            />
            <input
              value={customHex}
              onChange={(e) => {
                setCustomHex(e.target.value);
                setCustomHexError(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && applyCustomHex()}
              placeholder="de78ff"
              className="w-32 rounded-lg border border-ad-border p-2 font-mono text-sm text-ad-ink outline-none focus:border-ad-steel"
            />
            <button className={cn(buttonVariants({ variant: "outline", size: "sm" }))} onClick={applyCustomHex}>
              Use this colour
            </button>
            {selectedColor && !swatches?.some((s) => s.rgb.r === selectedColor.r && s.rgb.g === selectedColor.g && s.rgb.b === selectedColor.b) && (
              <span className="text-xs font-medium text-ad-steel">Using {rgbToHex(selectedColor)}</span>
            )}
          </div>
          {customHexError && <p className="mt-2 text-sm text-ad-orange">{customHexError}</p>}
        </div>
      )}

      {/* Measure */}
      {selectedColor && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            className={cn(buttonVariants({ variant: "accent", size: "md" }), measuring && "opacity-60")}
            onClick={measure}
            disabled={measuring}
          >
            {measuring ? "Measuring every page… this can take a minute" : "Measure this colour across all pages"}
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-ad-orange">{error}</p>}

      {/* Results */}
      {results && (
        <div className="mt-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ad-muted">
              <span className="font-semibold text-ad-ink">{results.length}</span> shape(s) found
            </p>
            <div className="flex gap-2">
              <button className={cn(buttonVariants({ variant: "outline", size: "sm" }))} onClick={downloadCsv}>
                Download CSV
              </button>
              <button className={cn(buttonVariants({ variant: "primary", size: "sm" }))} onClick={copyResults}>
                {copied ? "Copied!" : "Copy results"}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-ad-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-ad-surface text-left text-ad-muted">
                  <th className="px-3 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Page</th>
                  <th className="px-3 py-2 text-right font-medium">Area (m²)</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">External check</th>
                  <th className="px-3 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className={cn("border-t border-ad-border", r.confidence !== "single" && "bg-ad-orange/5")}>
                    <td className="px-3 py-2 font-medium text-ad-ink">{r.code}</td>
                    <td className="px-3 py-2 text-ad-muted">{r.page}</td>
                    <td className="px-3 py-2 text-right font-semibold text-ad-ink">{r.areaSqm.toFixed(1)}</td>
                    <td className="px-3 py-2 text-ad-muted">{CONFIDENCE_LABEL[r.confidence]}</td>
                    <td
                      className={cn(
                        "px-3 py-2 text-xs",
                        r.externalStatus === "mismatch" ? "font-medium text-ad-orange" : "text-ad-muted"
                      )}
                    >
                      {externalCheckText(r)}
                    </td>
                    <td className="px-3 py-2 text-xs text-ad-muted">{r.flags.join("; ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-ad-muted">
            &ldquo;Estimated (shared)&rdquo; rows are buildings that touch a neighbour with no
            gap between them — the area is a proportional split, not an exact measurement.
            Verify those against the drawing before quoting off them.
            {results.some((r) => r.externalStatus === "not_checked") && (
              <>
                {" "}Set the two Google Maps reference points above (in the scale cross-check
                section) to also enable the external check column.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
