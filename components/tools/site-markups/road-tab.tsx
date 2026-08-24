"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { SyncToSalesforce } from "@/components/tools/shared/sync-to-salesforce";

const MAP_TYPE = "hybrid";

// Safety orange, matching the Residential Mark Up convention. Fixed rather than chosen —
// the API still accepts a `color`, this just stops it being a decision per snapshot.
const LINE_COLOR = "e8642a";

function zoomLabel(zoomAdjust: number): string {
  if (zoomAdjust === 0) return "Auto";
  const steps = Math.abs(zoomAdjust);
  const step = steps === 1 ? "step" : "steps";
  return zoomAdjust > 0 ? `${steps} ${step} tighter` : `${steps} ${step} wider`;
}

/** Mirrors formatLengthKm in lib/kml/site-markup/overlay.ts so the panel and this list
 *  never disagree about the same number. */
function formatKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(2)} km`;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "site-markup"
  );
}

type InputMode = "cross_streets" | "coordinates" | "route_url";

export function RoadMarkupTab() {
  const [inputMode, setInputMode] = useState<InputMode>("cross_streets");
  const [roadName, setRoadName] = useState("");
  const [fromDesc, setFromDesc] = useState("");
  const [toDesc, setToDesc] = useState("");
  const [area, setArea] = useState("");
  const [fromCoord, setFromCoord] = useState("");
  const [toCoord, setToCoord] = useState("");
  const [routeUrl, setRouteUrl] = useState("");
  const [routeLabel, setRouteLabel] = useState("");
  const [showWaypointPins, setShowWaypointPins] = useState(true);
  const [roads, setRoads] = useState<{ name: string | null; m: number }[]>([]);
  const [tracedLengthKm, setTracedLengthKm] = useState<number | null>(null);
  const [opacityPercent, setOpacityPercent] = useState(55);
  const [zoomAdjust, setZoomAdjust] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [traceFlags, setTraceFlags] = useState<string[]>([]);

  async function generate() {
    setError(null);
    setTraceFlags([]);
    setTracedLengthKm(null);
    setRoads([]);

    const render = { color: LINE_COLOR, opacityPercent, mapType: MAP_TYPE, zoomAdjust };
    let body: Record<string, unknown>;

    if (inputMode === "route_url") {
      if (!routeUrl.trim()) {
        setError("Paste a Google Maps directions link.");
        return;
      }
      body = {
        mode: "route_url",
        url: routeUrl,
        ...(routeLabel.trim() ? { label: routeLabel } : {}),
        showWaypointPins,
        ...render,
      };
    } else if (inputMode === "coordinates") {
      if (!fromCoord.trim() || !toCoord.trim()) {
        setError("Enter both the from and to coordinates.");
        return;
      }
      body = {
        mode: "coordinates",
        from: fromCoord,
        to: toCoord,
        // Optional here — sent only when filled, so the server skips the
        // does-this-route-follow-the-road check rather than testing against "".
        ...(roadName.trim() ? { roadName } : {}),
        ...render,
      };
    } else {
      if (!roadName.trim() || !fromDesc.trim() || !toDesc.trim() || !area.trim()) {
        setError("Enter the road name, both cross streets, and the suburb/postcode.");
        return;
      }
      body = { mode: "cross_streets", roadName, fromDesc, toDesc, area, ...render };
    }

    setLoading(true);
    try {
      const res = await fetch("/api/kml/site-markup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
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
      const roadsHeader = res.headers.get("X-Route-Roads");
      if (roadsHeader) {
        try {
          const parsed = JSON.parse(decodeURIComponent(roadsHeader));
          if (Array.isArray(parsed)) setRoads(parsed);
        } catch {
          // ignore malformed header — the breakdown is advisory, the image is the output
        }
      }
      const lengthHeader = res.headers.get("X-Traced-Length-Km");
      if (lengthHeader) {
        const km = Number(lengthHeader);
        if (Number.isFinite(km)) setTracedLengthKm(km);
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

  async function imageBase64(): Promise<string> {
    if (!imageBlob) throw new Error("Generate a snapshot first.");
    const buffer = await imageBlob.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function download() {
    if (!imageBlob) return;
    const url = URL.createObjectURL(imageBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      inputMode === "route_url"
        ? `${slugify(routeLabel || "route")}-site-markup.png`
        : inputMode === "coordinates"
          ? `${slugify(roadName || "road")}-${slugify(fromCoord)}-to-${slugify(toCoord)}-site-markup.png`
          : `${slugify(roadName)}-${slugify(fromDesc)}-to-${slugify(toDesc)}-site-markup.png`;
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

      <div className="mt-5 flex gap-2">
        {(
          [
            { key: "cross_streets", label: "Cross streets" },
            { key: "coordinates", label: "Coordinates" },
            { key: "route_url", label: "Google route" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setInputMode(tab.key)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
              inputMode === tab.key
                ? "border-ad-ink bg-ad-ink text-white"
                : "border-ad-border text-ad-muted hover:text-ad-ink"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 rounded-xl border border-ad-border bg-white p-5 sm:grid-cols-2">
        {inputMode === "route_url" ? (
          <>
            <label className="block text-sm font-medium text-ad-ink sm:col-span-2">
              Google Maps directions link
              <textarea
                value={routeUrl}
                onChange={(e) => setRouteUrl(e.target.value)}
                rows={3}
                placeholder="https://www.google.com/maps/dir/..."
                className="mt-1 w-full resize-y rounded-lg border border-ad-border p-2 font-mono text-xs text-ad-ink outline-none focus:border-ad-steel"
              />
            </label>
            <label className="block text-sm font-medium text-ad-ink sm:col-span-2">
              Label <span className="font-normal text-ad-muted">(optional)</span>
              <input
                value={routeLabel}
                onChange={(e) => setRouteLabel(e.target.value)}
                placeholder="e.g. Kuraby footpath run — shown on the image"
                className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
              />
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-ad-ink sm:col-span-2">
              <input
                type="checkbox"
                checked={showWaypointPins}
                onChange={(e) => setShowWaypointPins(e.target.checked)}
                className="h-4 w-4 rounded border-ad-border"
              />
              Number the waypoints on the image
              <span className="font-normal text-ad-muted">
                — turn off for a client-facing copy
              </span>
            </label>
            <p className="text-xs text-ad-muted sm:col-span-2">
              Build the path of travel in Google Maps, then copy the URL from the address bar — or
              use Share and paste the short link. Place names are fine: the coordinates are read
              from the link itself, so it works whether or not Google relabelled your points.
            </p>
          </>
        ) : inputMode === "cross_streets" ? (
          <>
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
          </>
        ) : (
          <>
            <label className="block text-sm font-medium text-ad-ink">
              From coordinate
              <input
                value={fromCoord}
                onChange={(e) => setFromCoord(e.target.value)}
                placeholder="-34.0521, 151.1548"
                className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
              />
            </label>
            <label className="block text-sm font-medium text-ad-ink">
              To coordinate
              <input
                value={toCoord}
                onChange={(e) => setToCoord(e.target.value)}
                placeholder="-34.0489, 151.1502"
                className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
              />
            </label>
            <label className="block text-sm font-medium text-ad-ink sm:col-span-2">
              Road name <span className="font-normal text-ad-muted">(optional)</span>
              <input
                value={roadName}
                onChange={(e) => setRoadName(e.target.value)}
                placeholder="e.g. Nicholson Parade — checks the traced route follows it"
                className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
              />
            </label>
            <p className="text-xs text-ad-muted sm:col-span-2">
              Paste decimal degrees, degrees/minutes/seconds, or a Google Maps link — right-click a
              point in Google Maps and copy the coordinates. Both points must sit on a road.
            </p>
          </>
        )}

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
        <SyncToSalesforce
          getImageBase64={imageBase64}
          fallbackName={`${slugify(inputMode === "route_url" ? routeLabel || "route" : roadName || "road")}-site-markup.png`}
          disabled={!imageBlob}
        />
        {error && <span className="text-sm text-ad-orange">{error}</span>}
      </div>

      {tracedLengthKm !== null && (
        <p className="mt-4 text-sm text-ad-muted">
          Traced length: <span className="font-medium text-ad-ink">{tracedLengthKm.toFixed(2)} km</span>
        </p>
      )}

      {roads.length > 1 && (
        <div className="mt-4 max-w-md rounded-lg border border-ad-border bg-white p-4">
          <p className="text-sm font-medium text-ad-ink">Roads travelled, in order</p>
          <ol className="mt-2 space-y-1 text-sm">
            {roads.map((road, i) => (
              <li key={i} className="flex justify-between gap-4 text-ad-muted">
                <span>
                  {i + 1}. {road.name ?? "Unnamed road"}
                </span>
                <span className="tabular-nums text-ad-ink">{formatKm(road.m / 1000)}</span>
              </li>
            ))}
          </ol>
          <div className="mt-2 flex justify-between gap-4 border-t border-ad-border pt-2 text-sm font-medium text-ad-ink">
            <span>Total</span>
            <span className="tabular-nums">
              {formatKm(roads.reduce((sum, r) => sum + r.m, 0) / 1000)}
            </span>
          </div>
        </div>
      )}

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
