"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { latLngToPixel, pixelToLatLng } from "@/lib/kml/standard-markup/projection";

const MAX_COUNCIL_POINTS = 10;
const MAX_COUNCIL_ASSETS = 5;
const DEFAULT_COUNCIL_WIDTH_M = 10;
const MIN_COUNCIL_WIDTH_M = 5;
const MAX_COUNCIL_WIDTH_M = 20;
const COUNCIL_WIDTH_STEP_M = 1;

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
type MapType = "satellite" | "hybrid" | "roadmap";

const MAP_TYPE: MapType = "hybrid";

interface LatLng {
  lat: number;
  lng: number;
}

interface Neighbour {
  id: string;
  ring: LatLng[];
  areaSqm: number | null;
  label: string;
}

interface Projection {
  center: LatLng;
  zoom: number;
  imageSizePx: number;
  scale: number;
}

interface GenerateResponse {
  image: string;
  subjectRing: LatLng[];
  neighbours: Neighbour[];
  matchedAddress: string | null;
  mapType: MapType;
  zoomAdjust: number;
  flags: string[];
  center: LatLng;
  zoom: number;
  imageSizePx: number;
  scale: number;
}

interface CouncilAsset {
  points: LatLng[];
  widthMetres: number;
}

interface CouncilAssetDraft extends CouncilAsset {
  id: string;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "standard-markup"
  );
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const bytes = atob(base64);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type: mimeType });
}

interface PlaceSuggestion {
  placeId: string;
  text: string;
}

interface ParsedAddress {
  street: string;
  suburb: string;
  postcode: string;
  state: string;
}

/** Google-style type-ahead address search — proxies through our own server-side routes
 *  (which hold the Places API key) rather than loading the Maps JS library client-side,
 *  so no second, publicly-exposed key is needed. Reuses one session token per search
 *  (reset after a selection) so Google bills the whole autocomplete-to-details flow as
 *  one cheaper session instead of per-keystroke. */
function AddressSearch({ onSelect }: { onSelect: (parsed: ParsedAddress) => void }) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionToken = useRef(crypto.randomUUID());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  // Set right before select() calls setQuery() to display the chosen address — query is
  // also the search effect's trigger, so without this a selection's own text update
  // would re-fire the search 300ms later and pop the dropdown back open.
  const suppressNextSearch = useRef(false);

  // Closes on an actual outside click, rather than the input's own onBlur — blur fires
  // before a click on the dropdown registers, which needs a fragile setTimeout race to
  // work around and was closing the dropdown before the click landed.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (suppressNextSearch.current) {
      suppressNextSearch.current = false;
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (query.trim().length < 3) {
        setSuggestions([]);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch("/api/places/autocomplete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input: query, sessionToken: sessionToken.current }),
        });
        const json = (await res.json().catch(() => null)) as { ok: boolean; suggestions?: PlaceSuggestion[] } | null;
        setSuggestions(json?.ok ? (json.suggestions ?? []) : []);
        setOpen(true);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  async function select(suggestion: PlaceSuggestion) {
    suppressNextSearch.current = true;
    setOpen(false);
    setQuery(suggestion.text);
    setError(null);
    try {
      const res = await fetch("/api/places/details", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ placeId: suggestion.placeId, sessionToken: sessionToken.current }),
      });
      const json = (await res.json().catch(() => null)) as (ParsedAddress & { ok: boolean; error?: string }) | null;
      sessionToken.current = crypto.randomUUID();
      if (!json?.ok) {
        setError(json?.error ?? "Couldn't read that address — try entering it manually.");
        return;
      }
      onSelect({ street: json.street, suburb: json.suburb, postcode: json.postcode, state: json.state });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder="Start typing an address…"
        className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
      />
      {loading && <p className="mt-1 text-xs text-ad-muted">Searching…</p>}
      {error && <p className="mt-1 text-xs text-ad-orange">{error}</p>}
      {open && suggestions.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded-lg border border-ad-border bg-white py-1 shadow-lg">
          {suggestions.map((s) => (
            <li key={s.placeId}>
              <button
                type="button"
                onClick={() => select(s)}
                className="block w-full px-3 py-2 text-left text-sm text-ad-ink hover:bg-ad-surface"
              >
                {s.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StandardMarkupTab() {
  const [street, setStreet] = useState("");
  const [suburb, setSuburb] = useState("");
  const [postcode, setPostcode] = useState("");
  const [state, setState] = useState<SupportedState>("QLD");
  const [manualEntry, setManualEntry] = useState(false);
  const [parsedSummary, setParsedSummary] = useState<string | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [zoomAdjust, setZoomAdjust] = useState(1);
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flags, setFlags] = useState<string[]>([]);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [projection, setProjection] = useState<Projection | null>(null);
  const [councilAssets, setCouncilAssets] = useState<CouncilAssetDraft[]>([]);
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);

  // Clicking the image always does something sensible — no separate "start placing"
  // toggle. No asset currently active -> this click starts a brand-new one. One's
  // already active -> the click extends it. "Finish this asset" (below) clears the
  // active id so the next click starts another independent one — this is what lets a
  // property have two disconnected council assets (e.g. front road + rear laneway).
  function handleImageClick(e: MouseEvent<HTMLImageElement>) {
    if (!projection) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pixel = {
      x: ((e.clientX - rect.left) / rect.width) * projection.imageSizePx,
      y: ((e.clientY - rect.top) / rect.height) * projection.imageSizePx,
    };
    const point = pixelToLatLng(projection, pixel);

    if (activeAssetId) {
      setCouncilAssets((prev) =>
        prev.map((a) =>
          a.id === activeAssetId && a.points.length < MAX_COUNCIL_POINTS ? { ...a, points: [...a.points, point] } : a
        )
      );
      return;
    }

    if (councilAssets.length >= MAX_COUNCIL_ASSETS) return;
    const id = crypto.randomUUID();
    setCouncilAssets((prev) => [...prev, { id, points: [point], widthMetres: DEFAULT_COUNCIL_WIDTH_M }]);
    setActiveAssetId(id);
  }

  function finishActiveAsset() {
    setActiveAssetId(null);
  }

  function removeAsset(id: string) {
    setCouncilAssets((prev) => prev.filter((a) => a.id !== id));
    setActiveAssetId((current) => (current === id ? null : current));
  }

  function undoActivePoint() {
    if (!activeAssetId) return;
    setCouncilAssets((prev) => prev.map((a) => (a.id === activeAssetId ? { ...a, points: a.points.slice(0, -1) } : a)));
  }

  function clearActivePoints() {
    if (!activeAssetId) return;
    setCouncilAssets((prev) => prev.map((a) => (a.id === activeAssetId ? { ...a, points: [] } : a)));
  }

  function setActiveWidth(widthMetres: number) {
    if (!activeAssetId) return;
    setCouncilAssets((prev) => prev.map((a) => (a.id === activeAssetId ? { ...a, widthMetres } : a)));
  }

  const activeAsset = councilAssets.find((a) => a.id === activeAssetId) ?? null;

  function handleAddressSelect(parsed: ParsedAddress) {
    setStreet(parsed.street);
    setSuburb(parsed.suburb);
    setPostcode(parsed.postcode);
    setParsedSummary(
      [parsed.street, parsed.suburb, parsed.postcode, parsed.state].filter(Boolean).join(" · ")
    );
    const supported = STATES.find((s) => s.key === parsed.state && !s.disabled);
    if (supported) {
      setState(parsed.state as SupportedState);
      setAddressError(null);
    } else {
      setAddressError(`This tool doesn't support ${parsed.state || "that state"} yet — enter the address manually.`);
    }
  }

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
        body: JSON.stringify({ street, suburb, postcode: postcode || undefined, state, mapType: MAP_TYPE, zoomAdjust }),
      });
      const json = (await res.json().catch(() => null)) as (GenerateResponse & { ok: boolean; error?: string }) | null;
      if (!res.ok || !json) {
        setError(json?.error ?? "Something went wrong generating the snapshot.");
        return;
      }
      setResult(json);
      setExcludedIds(new Set());
      setCouncilAssets([]);
      setActiveAssetId(null);
      setImageDataUrl(`data:image/png;base64,${json.image}`);
      setFlags(json.flags);
      setProjection({ center: json.center, zoom: json.zoom, imageSizePx: json.imageSizePx, scale: json.scale });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function councilAssetsPayload(): CouncilAsset[] {
    return councilAssets
      .filter((a) => a.points.length >= 2)
      .map(({ points, widthMetres }) => ({ points, widthMetres }));
  }

  async function regenerate() {
    if (!result) return;
    setError(null);
    setRegenerating(true);
    try {
      const res = await fetch("/api/kml/standard-markup/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subjectRing: result.subjectRing,
          neighbours: result.neighbours,
          mapType: result.mapType,
          zoomAdjust,
          excludeIds: Array.from(excludedIds),
          councilAssets: councilAssetsPayload(),
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; image?: string; flags?: string[]; error?: string; center?: LatLng; zoom?: number; imageSizePx?: number; scale?: number }
        | null;
      if (!res.ok || !json?.image) {
        setError(json?.error ?? "Something went wrong regenerating the snapshot.");
        return;
      }
      setImageDataUrl(`data:image/png;base64,${json.image}`);
      setFlags(json.flags ?? []);
      if (json.center && json.zoom !== undefined && json.imageSizePx !== undefined && json.scale !== undefined) {
        setProjection({ center: json.center, zoom: json.zoom, imageSizePx: json.imageSizePx, scale: json.scale });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRegenerating(false);
    }
  }

  function toggleNeighbour(id: string) {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Re-renders without the numbered neighbour pins for the download — those reference
  // numbers are for staff's own check/uncheck workflow, not something a client needs to
  // see, so the on-screen preview and the downloaded file are deliberately different.
  async function download() {
    if (!result) return;
    setError(null);
    setDownloading(true);
    try {
      const res = await fetch("/api/kml/standard-markup/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subjectRing: result.subjectRing,
          neighbours: result.neighbours,
          mapType: result.mapType,
          zoomAdjust,
          excludeIds: Array.from(excludedIds),
          hideMarkers: true,
          councilAssets: councilAssetsPayload(),
        }),
      });
      const json = (await res.json().catch(() => null)) as { ok: boolean; image?: string; error?: string } | null;
      if (!res.ok || !json?.image) {
        setError(json?.error ?? "Something went wrong preparing the download.");
        return;
      }
      const blob = base64ToBlob(json.image, "image/png");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slugify(street)}-${slugify(suburb)}-standard-markup.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="mt-8">
      <p className="text-ad-muted">
        Snapshot an address with its surrounding lots highlighted in blue, auto-scoped to the property.
      </p>

      <div className="mt-4 grid gap-4 rounded-xl border border-ad-border bg-white p-5 sm:grid-cols-2">
        {!manualEntry ? (
          <div className="sm:col-span-2">
            <p className="text-sm font-medium text-ad-ink">Address</p>
            <AddressSearch onSelect={handleAddressSelect} />
            {parsedSummary && !addressError && (
              <p className="mt-1 text-xs text-ad-muted">{parsedSummary}</p>
            )}
            {addressError && <p className="mt-1 text-xs text-ad-orange">{addressError}</p>}
            <button
              type="button"
              onClick={() => {
                setManualEntry(true);
                setAddressError(null);
              }}
              className="mt-2 text-xs text-ad-steel underline underline-offset-2 hover:text-ad-ink"
            >
              Enter manually instead
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
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
            <button
              type="button"
              onClick={() => setManualEntry(false)}
              className="text-left text-xs text-ad-steel underline underline-offset-2 hover:text-ad-ink sm:col-span-2"
            >
              Search by address instead
            </button>
          </div>
        )}

        {result && (
          <div>
            <p className="text-sm font-medium text-ad-ink">Zoom</p>
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setZoomAdjust((z) => Math.max(-3, z - 1))}
                disabled={zoomAdjust <= -3}
                aria-label="Zoom out"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-ad-border text-ad-ink hover:bg-ad-border/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                −
              </button>
              <input
                type="range"
                min={-3}
                max={3}
                step={1}
                value={zoomAdjust}
                onChange={(e) => setZoomAdjust(Number(e.target.value))}
                className="w-full"
              />
              <button
                type="button"
                onClick={() => setZoomAdjust((z) => Math.min(3, z + 1))}
                disabled={zoomAdjust >= 3}
                aria-label="Zoom in"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-ad-border text-ad-ink hover:bg-ad-border/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                +
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          className={cn(buttonVariants({ variant: "primary", size: "md" }), loading && "opacity-60")}
          onClick={generate}
          disabled={loading || (!manualEntry && !!addressError)}
        >
          {loading ? "Generating snapshot…" : "Generate snapshot"}
        </button>
        <button
          className={cn(buttonVariants({ variant: "accent", size: "md" }), downloading && "opacity-60")}
          onClick={download}
          disabled={!imageDataUrl || downloading}
        >
          {downloading ? "Preparing…" : "Download .png"}
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

      {imageDataUrl && result && (
        <div className="mt-6 flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="relative max-w-4xl overflow-hidden rounded-xl border border-ad-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageDataUrl}
              alt={`${street} standard markup`}
              onClick={handleImageClick}
              className="block w-full cursor-crosshair"
            />
            {projection &&
              councilAssets.map((asset) =>
                asset.points.map((p, i) => {
                  const px = latLngToPixel(projection, p);
                  const leftPct = (px.x / projection.imageSizePx) * 100;
                  const topPct = (px.y / projection.imageSizePx) * 100;
                  const isActive = asset.id === activeAssetId;
                  return (
                    <span
                      key={`${asset.id}-${i}`}
                      style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                      className={cn(
                        "absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-[10px] font-semibold text-white shadow",
                        isActive ? "bg-ad-orange" : "bg-ad-orange/50"
                      )}
                    >
                      {i + 1}
                    </span>
                  );
                })
              )}
          </div>

          <div className="w-full max-w-xs space-y-4">
            {result.neighbours.length > 0 && (
              <div className="rounded-xl border border-ad-border bg-white p-4">
                <p className="text-sm font-medium text-ad-ink">Neighbouring lots</p>
                <p className="mt-1 text-xs text-ad-muted">
                  Uncheck any that shouldn&apos;t be included, then regenerate.
                </p>
                <ul className="mt-3 space-y-2">
                  {result.neighbours.map((n) => (
                    <li key={n.id} className="flex items-center gap-2 text-sm text-ad-ink">
                      <input
                        type="checkbox"
                        checked={!excludedIds.has(n.id)}
                        onChange={() => toggleNeighbour(n.id)}
                        className="h-4 w-4 accent-ad-steel"
                      />
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ad-orange text-xs font-semibold text-white">
                        {n.label}
                      </span>
                      <span>Lot {n.label}{n.areaSqm ? ` — ${n.areaSqm} m²` : ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-xl border border-ad-border bg-white p-4">
              <p className="text-sm font-medium text-ad-ink">Council assets</p>
              <p className="mt-1 text-xs text-ad-muted">
                Click points directly on the image to start one (up to {MAX_COUNCIL_POINTS} points). Finish it,
                then click again elsewhere to start another independent one — up to {MAX_COUNCIL_ASSETS} per
                property.
              </p>

              {activeAsset && (
                <div className="mt-3 rounded-lg bg-ad-surface p-3">
                  <p className="text-xs text-ad-muted">
                    Placing asset {councilAssets.findIndex((a) => a.id === activeAsset.id) + 1} —{" "}
                    {activeAsset.points.length}/{MAX_COUNCIL_POINTS} points
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={undoActivePoint}
                      disabled={activeAsset.points.length === 0}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "flex-1")}
                    >
                      Undo point
                    </button>
                    <button
                      type="button"
                      onClick={clearActivePoints}
                      disabled={activeAsset.points.length === 0}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "flex-1")}
                    >
                      Clear
                    </button>
                  </div>

                  <p className="mt-3 text-sm font-medium text-ad-ink">Width ({activeAsset.widthMetres}m)</p>
                  <div className="mt-1 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveWidth(Math.max(MIN_COUNCIL_WIDTH_M, activeAsset.widthMetres - COUNCIL_WIDTH_STEP_M))}
                      disabled={activeAsset.widthMetres <= MIN_COUNCIL_WIDTH_M}
                      aria-label="Decrease width"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-ad-border text-ad-ink hover:bg-ad-border/20 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      −
                    </button>
                    <input
                      type="range"
                      min={MIN_COUNCIL_WIDTH_M}
                      max={MAX_COUNCIL_WIDTH_M}
                      step={COUNCIL_WIDTH_STEP_M}
                      value={activeAsset.widthMetres}
                      onChange={(e) => setActiveWidth(Number(e.target.value))}
                      className="w-full"
                    />
                    <button
                      type="button"
                      onClick={() => setActiveWidth(Math.min(MAX_COUNCIL_WIDTH_M, activeAsset.widthMetres + COUNCIL_WIDTH_STEP_M))}
                      disabled={activeAsset.widthMetres >= MAX_COUNCIL_WIDTH_M}
                      aria-label="Increase width"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-ad-border text-ad-ink hover:bg-ad-border/20 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={finishActiveAsset}
                    className={cn(buttonVariants({ variant: "primary", size: "sm" }), "mt-3 w-full")}
                  >
                    Finish this asset
                  </button>
                </div>
              )}

              {councilAssets.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {councilAssets.map((asset, i) => (
                    <li key={asset.id} className="flex items-center justify-between gap-2 text-sm text-ad-ink">
                      <span>
                        Asset {i + 1} — {asset.points.length} pts, {asset.widthMetres}m
                        {asset.id === activeAssetId && <span className="text-ad-muted"> (active)</span>}
                      </span>
                      <span className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setActiveAssetId(asset.id)}
                          disabled={asset.id === activeAssetId}
                          className="text-xs text-ad-steel underline underline-offset-2 hover:text-ad-ink disabled:cursor-not-allowed disabled:no-underline disabled:opacity-40"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => removeAsset(asset.id)}
                          className="text-xs text-ad-orange underline underline-offset-2 hover:text-ad-ink"
                        >
                          Remove
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {!activeAsset && councilAssets.length >= MAX_COUNCIL_ASSETS && (
                <p className="mt-3 text-xs text-ad-orange">
                  Max {MAX_COUNCIL_ASSETS} council assets — remove one to add another.
                </p>
              )}
            </div>

            <button
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full", regenerating && "opacity-60")}
              onClick={regenerate}
              disabled={regenerating}
            >
              {regenerating ? "Regenerating…" : "Regenerate"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
