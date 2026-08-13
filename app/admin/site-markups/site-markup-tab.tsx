"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

const COLOR_PRESETS = [
  { label: "Highlighter yellow", value: "ffeb00" },
  { label: "Safety orange", value: "e8642a" },
  { label: "Alert red", value: "ff3b30" },
  { label: "Survey cyan", value: "00c2ff" },
];

const MAP_TYPES = [
  { key: "satellite", label: "Satellite" },
  { key: "hybrid", label: "Satellite + labels" },
  { key: "roadmap", label: "Map" },
] as const;

type MapType = (typeof MAP_TYPES)[number]["key"];

function zoomLabel(zoomAdjust: number): string {
  if (zoomAdjust === 0) return "Auto";
  const steps = Math.abs(zoomAdjust);
  const step = steps === 1 ? "step" : "steps";
  return zoomAdjust > 0 ? `${steps} ${step} tighter` : `${steps} ${step} wider`;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "site-markup"
  );
}

export function SiteMarkupTab() {
  const [roadName, setRoadName] = useState("");
  const [fromDesc, setFromDesc] = useState("");
  const [toDesc, setToDesc] = useState("");
  const [area, setArea] = useState("");
  const [color, setColor] = useState(COLOR_PRESETS[0].value);
  const [opacityPercent, setOpacityPercent] = useState(55);
  const [mapType, setMapType] = useState<MapType>("hybrid");
  const [zoomAdjust, setZoomAdjust] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [traceFlags, setTraceFlags] = useState<string[]>([]);

  async function generate() {
    setError(null);
    setTraceFlags([]);
    if (!roadName.trim() || !fromDesc.trim() || !toDesc.trim() || !area.trim()) {
      setError("Enter the road name, both cross streets, and the suburb/postcode.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/kml/site-markup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roadName, fromDesc, toDesc, area, color, opacityPercent, mapType, zoomAdjust }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(json?.error ?? "Something went wrong generating the snapshot.");
        return;
      }
      const flagsHeader = res.headers.get("X-Trace-Flags");
      if (flagsHeader) {
        try {
          setTraceFlags(JSON.parse(decodeURIComponent(flagsHeader)));
        } catch {
          // ignore malformed header — flags are advisory only
        }
      }
      const blob = await res.blob();
      setImageUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
      setImageBlob(blob);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function download() {
    if (!imageBlob) return;
    const url = URL.createObjectURL(imageBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(roadName)}-${slugify(fromDesc)}-to-${slugify(toDesc)}-site-markup.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-8">
      <p className="max-w-2xl text-ad-muted">
        Snapshot the exact stretch of road to inspect, highlighted from above, so the field team
        knows exactly where to survey on site. Needs{" "}
        <code className="rounded bg-ad-surface px-1 py-0.5 text-xs">GOOGLE_MAPS_API_KEY</code> with
        the Maps Static API enabled (same key as the &ldquo;Find Google Maps links&rdquo; feature).
      </p>

      <div className="mt-4 grid gap-4 rounded-xl border border-ad-border bg-white p-5 sm:grid-cols-2">
        <label className="block text-sm font-medium text-ad-ink">
          Road name
          <input
            value={roadName}
            onChange={(e) => setRoadName(e.target.value)}
            placeholder="e.g. Mason St"
            className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
          />
        </label>
        <label className="block text-sm font-medium text-ad-ink">
          Suburb, postcode
          <input
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="e.g. Newport, VIC 3015"
            className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
          />
        </label>
        <label className="block text-sm font-medium text-ad-ink">
          From cross street
          <input
            value={fromDesc}
            onChange={(e) => setFromDesc(e.target.value)}
            placeholder="e.g. Melbourne Rd"
            className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
          />
        </label>
        <label className="block text-sm font-medium text-ad-ink">
          To cross street
          <input
            value={toDesc}
            onChange={(e) => setToDesc(e.target.value)}
            placeholder="e.g. Maddox Rd"
            className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
          />
        </label>

        <div>
          <p className="text-sm font-medium text-ad-ink">Markup colour</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {COLOR_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => setColor(preset.value)}
                title={preset.label}
                aria-label={preset.label}
                className={cn(
                  "h-8 w-8 rounded-full border-2 transition-colors",
                  color === preset.value ? "border-ad-ink" : "border-transparent"
                )}
                style={{ backgroundColor: `#${preset.value}` }}
              />
            ))}
            <input
              type="color"
              value={`#${color}`}
              onChange={(e) => setColor(e.target.value.replace("#", ""))}
              className="h-8 w-8 cursor-pointer rounded-full border border-ad-border bg-transparent p-0"
              aria-label="Custom colour"
            />
          </div>
        </div>

        <label className="block text-sm font-medium text-ad-ink">
          Opacity ({opacityPercent}%)
          <input
            type="range"
            min={20}
            max={90}
            value={opacityPercent}
            onChange={(e) => setOpacityPercent(Number(e.target.value))}
            className="mt-3 w-full"
          />
        </label>

        <label className="block text-sm font-medium text-ad-ink">
          Zoom ({zoomLabel(zoomAdjust)})
          <input
            type="range"
            min={-3}
            max={3}
            step={1}
            value={zoomAdjust}
            onChange={(e) => setZoomAdjust(Number(e.target.value))}
            className="mt-3 w-full"
          />
        </label>

        <div className="sm:col-span-2">
          <p className="text-sm font-medium text-ad-ink">Base imagery</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {MAP_TYPES.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setMapType(opt.key)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm",
                  mapType === opt.key
                    ? "border-ad-steel bg-ad-steel/10 text-ad-ink"
                    : "border-ad-border text-ad-muted hover:text-ad-ink"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          className={cn(buttonVariants({ variant: "primary", size: "md" }), loading && "opacity-60")}
          onClick={generate}
          disabled={loading}
        >
          {loading ? "Generating snapshot…" : "Generate snapshot"}
        </button>
        <button
          className={cn(buttonVariants({ variant: "accent", size: "md" }))}
          onClick={download}
          disabled={!imageBlob}
        >
          Download .png
        </button>
        {error && <span className="text-sm text-ad-orange">{error}</span>}
      </div>

      {traceFlags.length > 0 && (
        <div className="mt-6 max-w-md rounded-lg border border-ad-orange/40 bg-ad-orange/5 p-3 text-sm text-ad-ink">
          <p className="font-medium">Worth a manual check:</p>
          <ul className="mt-1 list-disc pl-5 text-ad-muted">
            {traceFlags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {imageUrl && (
        <div className="mt-6 max-w-md overflow-hidden rounded-xl border border-ad-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={`${roadName} site markup`} className="block w-full" />
        </div>
      )}
    </div>
  );
}
