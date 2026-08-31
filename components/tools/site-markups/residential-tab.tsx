"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { SyncToSalesforce } from "@/components/tools/shared/sync-to-salesforce";
import { AddressSearch, type ParsedAddress } from "./address-search";
import { ShapePanel } from "./shape-panel";
import { useShapes } from "./shapes";
import { MarkupCanvas, type Projection } from "./markup-canvas";
import { SITE_RED } from "@/lib/kml/standard-markup/style";
import { markerLabel } from "@/lib/kml/standard-markup/labels";
import { pointInRing } from "@/lib/kml/standard-markup/geometry";

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
  fitZoom: number;
  imageSizePx: number;
  scale: number;
}

/** The pinned frame. Captured once, by Generate, and sent on every later render so that
 *  nothing the operator does to the geometry can shift the photo under them. */
interface Frame {
  center: LatLng;
  fitZoom: number;
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

export function ResidentialMarkupTab() {
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
  // Matches the excludedIds convention: state records what's been REMOVED, so a fresh
  // snapshot starts with everything the lookup found.
  const [hideSubject, setHideSubject] = useState(false);
  const [projection, setProjection] = useState<Projection | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickBusy, setPickBusy] = useState(false);
  const [pickMessage, setPickMessage] = useState<string | null>(null);
  const shapes = useShapes();

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
      setHideSubject(false);
      shapes.reset();
      setImageDataUrl(`data:image/png;base64,${json.image}`);
      setFlags(json.flags);
      zoomSettled.current = zoomAdjust;
      setProjection({ center: json.center, zoom: json.zoom, imageSizePx: json.imageSizePx, scale: json.scale });
      // The only place the frame is ever set. Every later render reuses it.
      setFrame({ center: json.center, fitZoom: json.fitZoom });
      setPicking(false);
      setPickMessage(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  /** Refetches the aerial tile. Zoom is the only thing that needs this — every other
   *  control changes what the overlay draws, which costs nothing. */
  async function refreshBasemap() {
    if (!result) return;
    setError(null);
    setRegenerating(true);
    try {
      const res = await fetch("/api/kml/standard-markup/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // Every vector — site, lots, bubbles, shapes — is drawn by the overlay now, so
          // this request fetches only the basemap (plus the composited legend and north
          // arrow). That is what makes a checkbox instant: unticking a lot changes what
          // the overlay renders, with no round trip at all. The subject ring is still
          // sent because it anchors the frame; `hideSubject` stops it being drawn.
          subjectRing: result.subjectRing,
          neighbours: [],
          mapType: result.mapType,
          zoomAdjust,
          hideSubject: true,
          frame,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; image?: string; flags?: string[]; error?: string; center?: LatLng; zoom?: number; imageSizePx?: number; scale?: number }
        | null;
      if (!res.ok || !json?.image) {
        setError(json?.error ?? "Something went wrong refreshing the map.");
        return;
      }
      setImageDataUrl(`data:image/png;base64,${json.image}`);
      setFlags(json.flags ?? []);
      if (json.center && json.zoom !== undefined && json.imageSizePx !== undefined && json.scale !== undefined) {
        zoomSettled.current = zoomAdjust;
      setProjection({ center: json.center, zoom: json.zoom, imageSizePx: json.imageSizePx, scale: json.scale });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRegenerating(false);
    }
  }

  /** Ids key the exclude-set and the checkboxes, so a duplicate would make two lots
   *  toggle as one — the same rule resolve.ts applies server-side, applied here against
   *  the list as it currently stands. */
  function uniqueLotId(idKey: string, existing: Neighbour[]): string {
    const base = idKey || crypto.randomUUID();
    const used = new Set(existing.map((n) => n.id));
    let id = base;
    for (let dup = 2; used.has(id); dup++) id = `${base}#${dup}`;
    return id;
  }

  async function handlePick(point: LatLng) {
    if (!result) return;
    setPicking(false);
    setPickMessage(null);

    // Both of these are answered locally — no point paying for a cadastre round trip to
    // be told about a lot we already have.
    if (pointInRing(point, result.subjectRing)) {
      setPickMessage("That's the project site — it's already on the map.");
      return;
    }
    const existing = result.neighbours.find((n) => pointInRing(point, n.ring));
    if (existing) {
      setPickMessage(`Lot ${existing.label} is already in the list.`);
      return;
    }

    setPickBusy(true);
    try {
      const res = await fetch("/api/kml/standard-markup/parcel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lat: point.lat, lng: point.lng, state }),
      });
      const json = (await res.json().catch(() => null)) as
        | {
            ok: boolean;
            parcel?: { idKey: string; ring: LatLng[]; areaSqm: number | null; kind: "lot" | "road" | "other" } | null;
            error?: string;
          }
        | null;
      if (!res.ok || !json?.ok) {
        setPickMessage(json?.error ?? "Couldn't look that lot up — try again.");
        return;
      }
      if (!json.parcel) {
        setPickMessage("No titled parcel there — try clicking inside the lot.");
        return;
      }
      if (json.parcel.kind !== "lot") {
        setPickMessage(
          json.parcel.kind === "road"
            ? "That's a road reserve, not a lot — use a custom shape for road frontage."
            : "That's an easement or interest, not a titled lot."
        );
        return;
      }
      const added: Neighbour = {
        id: uniqueLotId(json.parcel.idKey, result.neighbours),
        ring: json.parcel.ring,
        areaSqm: json.parcel.areaSqm,
        // Continues the existing numbering rather than renumbering — a lot's pin must
        // never change number once the operator has seen it.
        label: markerLabel(result.neighbours.length),
      };
      // No render needed — the overlay draws the new lot and its bubble straight away.
      setResult({ ...result, neighbours: [...result.neighbours, added] });
    } catch (e) {
      setPickMessage((e as Error).message);
    } finally {
      setPickBusy(false);
    }
  }

  // Zoom is the one control that still needs the server: a different zoom means a
  // different basemap tile. Debounced so dragging the slider across its range costs one
  // Static Maps call at the end rather than one per step. Skips the first run so
  // generating a snapshot doesn't immediately refetch what it just fetched.
  const zoomSettled = useRef(zoomAdjust);
  useEffect(() => {
    if (!result || zoomSettled.current === zoomAdjust) return;
    const t = setTimeout(() => {
      zoomSettled.current = zoomAdjust;
      void refreshBasemap();
    }, 400);
    return () => clearTimeout(t);
    // refreshBasemap closes over current state each render; re-running on zoomAdjust and
    // result is exactly the intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomAdjust, result]);

  function toggleNeighbour(id: string) {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Re-renders without the numbered neighbour pins — those reference numbers are for staff's
  // own check/uncheck workflow, not something a client needs to see, so the on-screen preview
  // and the exported file are deliberately different.
  //
  // Shared by Download and Sync To Salesforce so the file filed into Box is byte-identical to
  // the one an operator would have downloaded and uploaded by hand.
  async function renderCleanImageBase64(): Promise<string> {
    if (!result) throw new Error("Generate a markup first.");
    const res = await fetch("/api/kml/standard-markup/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subjectRing: result.subjectRing,
        neighbours: result.neighbours,
        mapType: result.mapType,
        zoomAdjust,
        excludeIds: Array.from(excludedIds),
        hideSubject,
        frame,
        // The export DOES bake the shapes — unlike the on-screen preview above, a .png
        // has no overlay to draw them.
        shapes: shapes.payload(),
      }),
    });
    const json = (await res.json().catch(() => null)) as { ok: boolean; image?: string; error?: string } | null;
    if (!res.ok || !json?.image) {
      throw new Error(json?.error ?? "Something went wrong rendering the image.");
    }
    return json.image;
  }

  async function download() {
    if (!result) return;
    setError(null);
    setDownloading(true);
    try {
      const image = await renderCleanImageBase64();
      const blob = base64ToBlob(image, "image/png");
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
        <SyncToSalesforce
          getImageBase64={renderCleanImageBase64}
          fallbackName={`${slugify(street)}-${slugify(suburb)}-standard-markup.png`}
          disabled={!imageDataUrl}
        />
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
          <MarkupCanvas
            imageDataUrl={imageDataUrl}
            alt={`${street} standard markup`}
            projection={projection}
            shapes={shapes}
            lots={result.neighbours.filter((n) => !excludedIds.has(n.id))}
            subjectRing={result.subjectRing}
            hideSubject={hideSubject}
            pickMode={picking}
            onPick={handlePick}
            onCancelPick={() => setPicking(false)}
          />

          <div className="w-full max-w-xs space-y-4">
            {/* First in the column, and deliberately far from the Custom shapes Width
                slider at the bottom — the two are the same "− slider +" control and were
                easy to mix up when adjacent. Zoom is also a set-once thing, so it doesn't
                belong among the controls being worked with repeatedly. */}
            <div className="rounded-xl border border-ad-border bg-white p-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-ad-ink">Zoom</p>
                {/* The only server round trip left in the tool, so it's the only place
                    that needs a wait indicator. */}
                {regenerating && <span className="text-xs text-ad-muted">Refreshing…</span>}
              </div>
              <div className="mt-2 flex items-center gap-2">
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
                  aria-label="Zoom"
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

            {/* Always rendered, unlike before — the project site row lives here, and a
                property with no detected neighbours still needs it. */}
            <div className="rounded-xl border border-ad-border bg-white p-4">
              <p className="text-sm font-medium text-ad-ink">Detected lots</p>
              <p className="mt-1 text-xs text-ad-muted">
                Uncheck anything that shouldn&apos;t be included.
              </p>
              <ul className="mt-3 space-y-2">
                <li className="flex items-center gap-2 text-sm text-ad-ink">
                  <input
                    type="checkbox"
                    checked={!hideSubject}
                    onChange={() => setHideSubject((h) => !h)}
                    className="h-4 w-4 accent-ad-steel"
                  />
                  <span
                    className="h-4 w-4 shrink-0 rounded-sm border border-black/10"
                    style={{ backgroundColor: `#${SITE_RED}` }}
                  />
                  <span>Project site</span>
                </li>
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
              {/* Lives here because it adds a row to the list above — the same
                  relationship "+ Add shape" has to the shape list. Outline, not primary:
                  it only arms a map click, and a solid button beside the others read as
                  though it did the work itself. */}
              <button
                type="button"
                onClick={() => {
                  setPickMessage(null);
                  setPicking((p) => !p);
                }}
                disabled={pickBusy}
                aria-pressed={picking}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "mt-3 w-full",
                  picking && "border-ad-steel bg-ad-steel/10 text-ad-ink",
                  pickBusy && "opacity-60"
                )}
              >
                {pickBusy ? "Looking up…" : picking ? "Cancel" : "+ Add lot from map"}
              </button>

              {pickMessage && !picking && !pickBusy && (
                <p className="mt-2 text-xs text-ad-orange">{pickMessage}</p>
              )}
            </div>
            <ShapePanel shapes={shapes} />

            {/* No Regenerate button: every edit in this column is live now. Zoom is the
                only thing that still needs the server, and it refetches itself. */}
          </div>
        </div>
      )}
    </div>
  );
}
