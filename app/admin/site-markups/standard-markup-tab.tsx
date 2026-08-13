"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

const STATES = [
  { key: "QLD", label: "QLD", disabled: false },
  { key: "NSW", label: "NSW", disabled: false },
  { key: "VIC", label: "VIC", disabled: false },
  { key: "SA", label: "SA", disabled: true },
  { key: "WA", label: "WA", disabled: true },
  { key: "TAS", label: "TAS", disabled: true },
  { key: "ACT", label: "ACT", disabled: true },
  { key: "NT", label: "NT", disabled: true },
] as const;

type SupportedState = "QLD" | "NSW" | "VIC";

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
      .replace(/(^-|-$)/g, "") || "standard-markup"
  );
}

export function StandardMarkupTab() {
  const [street, setStreet] = useState("");
  const [suburb, setSuburb] = useState("");
  const [postcode, setPostcode] = useState("");
  const [state, setState] = useState<SupportedState>("QLD");
  const [mapType, setMapType] = useState<MapType>("hybrid");
  const [zoomAdjust, setZoomAdjust] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [flags, setFlags] = useState<string[]>([]);

  async function generate() {
    setError(null);
    setFlags([]);
    if (!street.trim() || !suburb.trim()) {
      setError("Enter the street address and suburb.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/kml/standard-markup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ street, suburb, postcode: postcode || undefined, state, mapType, zoomAdjust }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(json?.error ?? "Something went wrong generating the snapshot.");
        return;
      }
      const flagsHeader = res.headers.get("X-Trace-Flags");
      if (flagsHeader) {
        try {
          setFlags(JSON.parse(decodeURIComponent(flagsHeader)));
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
    a.download = `${slugify(street)}-${slugify(suburb)}-standard-markup.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-8">
      <p className="max-w-2xl text-ad-muted">
        Snapshot one address with its surrounding lots (blue) and the road/footpath frontage
        that needs surveying (orange) — auto-scoped to 1 neighbouring property either side, or
        the intersection and a bit of each road on a corner block. Needs{" "}
        <code className="rounded bg-ad-surface px-1 py-0.5 text-xs">GOOGLE_MAPS_API_KEY</code> (same
        key as Site Markup), plus{" "}
        <code className="rounded bg-ad-surface px-1 py-0.5 text-xs">NSW_POINT_API_KEY</code> if
        using NSW.
      </p>

      <div className="mt-4 grid gap-4 rounded-xl border border-ad-border bg-white p-5 sm:grid-cols-2">
        <label className="block text-sm font-medium text-ad-ink">
          Street address
          <input
            value={street}
            onChange={(e) => setStreet(e.target.value)}
            placeholder="e.g. 8 Ironwood Ct"
            className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
          />
        </label>
        <label className="block text-sm font-medium text-ad-ink">
          Suburb
          <input
            value={suburb}
            onChange={(e) => setSuburb(e.target.value)}
            placeholder="e.g. Mountain Creek"
            className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
          />
        </label>
        <label className="block text-sm font-medium text-ad-ink">
          Postcode (optional)
          <input
            value={postcode}
            onChange={(e) => setPostcode(e.target.value)}
            placeholder="e.g. 4557"
            className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
          />
        </label>
        <div>
          <p className="text-sm font-medium text-ad-ink">State</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {STATES.map((s) => (
              <button
                key={s.key}
                type="button"
                disabled={s.disabled}
                onClick={() => setState(s.key as SupportedState)}
                title={s.disabled ? "Not supported yet" : undefined}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm",
                  s.disabled
                    ? "cursor-not-allowed border-ad-border text-ad-muted/50"
                    : state === s.key
                      ? "border-ad-steel bg-ad-steel/10 text-ad-ink"
                      : "border-ad-border text-ad-muted hover:text-ad-ink"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

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

      {flags.length > 0 && (
        <div className="mt-6 max-w-md rounded-lg border border-ad-orange/40 bg-ad-orange/5 p-3 text-sm text-ad-ink">
          <p className="font-medium">Worth a manual check:</p>
          <ul className="mt-1 list-disc pl-5 text-ad-muted">
            {flags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {imageUrl && (
        <div className="mt-6 max-w-md overflow-hidden rounded-xl border border-ad-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={`${street} standard markup`} className="block w-full" />
        </div>
      )}
    </div>
  );
}
