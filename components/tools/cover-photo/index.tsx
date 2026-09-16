"use client";

// Cover Photo Generator — the front-page image for a report.
//
// One address, one green boundary, one 600x442 PNG, filed against the Survey. Most of the
// time the whole job is: type the address, press Generate, press Send to Salesforce.
//
// It repurposes Building Markup's machinery — the state cadastre lookup, the live aerial map,
// the server-side Static Maps re-render — and throws away everything that serves a quote
// rather than a report: no lots, no line items, no numbered badges, no legend, no north arrow
// and no measurements. The boundary is always green and always an area.

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import type { LatLng } from "@/lib/kml/types";
import type { LatLngBox } from "@/lib/kml/standard-markup/projection";
import { AddressSearch, type PlaceSelection } from "@/components/tools/shared/address-search";
import { downloadBlob } from "@/components/tools/shared/download";
import { coverViewFor } from "@/lib/cover-photo/frame";
import { COVER_ASPECT, COVER_HEIGHT_PX, COVER_WIDTH_PX } from "@/lib/cover-photo/style";
import { CoverMap, type CoverMapCommands } from "./cover-map";
import { SyncCoverPhoto } from "./sync-cover-photo";

/** The states with a cadastre adapter. Anywhere else the tool still works — the operator
 *  draws the boundary by hand — so this decides whether to ASK, not whether to proceed. */
const CADASTRE_STATES = ["QLD", "NSW", "VIC"] as const;
type CadastreState = (typeof CADASTRE_STATES)[number];

function isCadastreState(value: string): value is CadastreState {
  return (CADASTRE_STATES as readonly string[]).includes(value);
}

/** A box around a point, for an address whose parcel we couldn't resolve — roughly a suburban
 *  street's worth of ground, so the operator lands somewhere they can recognise and draw. */
function boxAround(point: LatLng, metres = 120): LatLngBox {
  const dLat = metres / 111_320;
  const dLng = metres / (111_320 * Math.cos((point.lat * Math.PI) / 180));
  return {
    north: point.lat + dLat / 2,
    south: point.lat - dLat / 2,
    east: point.lng + dLng / 2,
    west: point.lng - dLng / 2,
  };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function CoverPhotoTool() {
  const mapRef = useRef<CoverMapCommands>(null);

  const [place, setPlace] = useState<PlaceSelection | null>(null);
  const [ring, setRing] = useState<LatLng[]>([]);
  /** Bumped whenever React replaces the ring wholesale. The overlay owns the geometry, so
   *  this is how the map is told "different ring now, rebuild" — an edit made on the map
   *  changes `ring` and leaves this alone. */
  const [ringKey, setRingKey] = useState("empty");
  const [drawing, setDrawing] = useState(false);
  const [fitRequest, setFitRequest] = useState<{ key: string; box: LatLngBox } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generated, setGenerated] = useState(false);
  /** The toolbar's Zoom control: positive is tighter, negative is wider. Re-frames around the
   *  boundary rather than the current centre, so it can't walk off the property.
   *
   *  A REF, not state, and for a reason: nothing on screen displays the step, but two quick
   *  clicks land in the same React batch — so reading it from state meant both handlers saw
   *  the same stale value and the second click did nothing. Verified: -, - used to move one
   *  step, not two. */
  const zoomStepRef = useRef(0);

  const frame = useCallback((box: LatLngBox | null) => {
    if (box) setFitRequest({ key: `${Date.now()}`, box });
  }, []);

  const loadRing = useCallback(
    (next: LatLng[]) => {
      setRing(next);
      setRingKey(`${Date.now()}`);
    },
    []
  );

  async function generate() {
    if (!place) return;
    setBusy(true);
    setError(null);
    setNote(null);
    setDrawing(false);
    try {
      let resolved: LatLng[] = [];
      let message: string | null = null;

      if (isCadastreState(place.state)) {
        const res = await fetch("/api/cover-photo/parcel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            street: place.street,
            suburb: place.suburb,
            postcode: place.postcode || undefined,
            state: place.state,
          }),
        });
        const json = await res.json();
        if (!json.ok) {
          setError(json.error ?? "Couldn't look that address up.");
          return;
        }
        resolved = json.ring ?? [];
        message = json.note ?? null;
      } else {
        message = `There's no parcel cadastre for ${place.state || "that state"} — draw the boundary by hand.`;
      }

      loadRing(resolved);
      setGenerated(true);
      zoomStepRef.current = 0;
      // A resolved parcel frames itself with its own margin; without one, fall back to the
      // geocoded point so the operator at least lands on the property.
      frame(
        resolved.length >= 3
          ? coverViewFor(resolved, 0)
          : place.location
            ? boxAround(place.location)
            : null
      );
      if (resolved.length < 3) {
        setDrawing(true);
        setNote(message ?? "No boundary found — draw it by hand.");
      } else {
        setNote(message);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Renders the PNG server-side from the frame currently on screen.
   *
   *  Called lazily — at download or upload time, never on every map move — so a billed Static
   *  Maps render only happens when the operator actually wants the image. */
  const renderImage = useCallback(async (): Promise<string> => {
    if (ring.length < 3) throw new Error("Draw the property boundary first.");
    const camera = mapRef.current?.getCamera();
    if (!camera) throw new Error("The map isn't ready yet — give it a moment and try again.");
    const res = await fetch("/api/cover-photo/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ring, bounds: camera.bounds, mapType: camera.mapType }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error ?? "The render failed.");
    return json.imageBase64 as string;
  }, [ring]);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const base64 = await renderImage();
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const name = place ? `${slug(place.street)}-${slug(place.suburb)}-cover-photo.png` : "cover-photo.png";
      downloadBlob(bytes, name, "image/png");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const hasBoundary = ring.length >= 3;

  /** Re-frames one step in or out. Bounded so a held-down button can't leave the operator
   *  looking at a continent or at four roof tiles. */
  function stepZoom(by: number) {
    const next = Math.max(-4, Math.min(6, zoomStepRef.current + by));
    if (next === zoomStepRef.current) return;
    zoomStepRef.current = next;
    frame(coverViewFor(ring, next));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[280px] flex-1">
          <AddressSearch
            onSelect={(selected) => {
              setPlace(selected);
              setError(null);
            }}
            placeholder="Start typing the property address…"
          />
        </div>
        <button
          className={cn(buttonVariants({ variant: "primary", size: "md" }))}
          onClick={generate}
          disabled={busy || !place}
        >
          {busy ? "Working…" : generated ? "Regenerate" : "Generate"}
        </button>
      </div>

      {error && <p className="text-sm text-ad-orange">{error}</p>}
      {note && <p className="text-sm text-ad-muted">{note}</p>}

      {/* Above the map, not below it (Rhys, 2026-09-16). The map is the tall element on the
          page, so a toolbar under it sits off the bottom of the screen on a laptop by the
          time the operator has scrolled the drawing into view. */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Drawing is the exception, not the default — most cover photos are the cadastre
            boundary untouched. The button says which of the two states you are in rather than
            adding a mode switch nobody would find. */}
        <button
          className={cn(buttonVariants({ variant: drawing ? "primary" : "outline", size: "md" }))}
          onClick={() => {
            if (drawing) {
              setDrawing(false);
              return;
            }
            // Entering draw mode on an existing boundary would have the next click bolt a
            // point onto the cadastre outline, which is never what is wanted — start clean.
            loadRing([]);
            setDrawing(true);
            setNote(null);
          }}
        >
          {drawing ? "Done drawing" : hasBoundary ? "Draw the area instead" : "Draw the area"}
        </button>
        {drawing && (
          <>
            <button
              className={cn(buttonVariants({ variant: "outline", size: "md" }))}
              onClick={() => mapRef.current?.undoPoint()}
              disabled={ring.length === 0}
            >
              Undo point
            </button>
            <button
              className={cn(buttonVariants({ variant: "outline", size: "md" }))}
              onClick={() => loadRing([])}
              disabled={ring.length === 0}
            >
              Clear
            </button>
          </>
        )}
        {/* Re-frames around the BOUNDARY, which is what the operator means by "zoom" here —
            Google's own +/- zoom the current centre, so after a pan they stop being about the
            property at all. Scroll and drag still work as normal on top of this. */}
        <div className="inline-flex items-center gap-1 rounded-full border border-ad-border bg-white p-1">
          <button
            type="button"
            aria-label="Zoom out"
            className="flex h-7 w-7 items-center justify-center rounded-full text-ad-ink hover:bg-ad-surface disabled:opacity-40 disabled:hover:bg-transparent"
            onClick={() => stepZoom(-1)}
            disabled={!hasBoundary}
          >
            &minus;
          </button>
          <span className="px-1 text-sm text-ad-muted">Zoom</span>
          <button
            type="button"
            aria-label="Zoom in"
            className="flex h-7 w-7 items-center justify-center rounded-full text-ad-ink hover:bg-ad-surface disabled:opacity-40 disabled:hover:bg-transparent"
            onClick={() => stepZoom(1)}
            disabled={!hasBoundary}
          >
            +
          </button>
        </div>
        <button
          className={cn(buttonVariants({ variant: "outline", size: "md" }))}
          onClick={download}
          disabled={busy || !hasBoundary}
        >
          Download .png
        </button>
        <SyncCoverPhoto getImageBase64={renderImage} disabled={!hasBoundary} />
      </div>

      {/* No map until there is an address. Mounting one is a billed Dynamic Maps load, and an
          empty map of Brisbane tells the operator nothing — it mounts on the address PICK
          rather than on Generate, so Google Maps is already loaded by the time the cadastre
          answers and the first frame lands without a wait. */}
      {place ? (
        <CoverMap
          ref={mapRef}
          ring={ring}
          ringKey={ringKey}
          drawing={drawing}
          onRingChange={setRing}
          fitRequest={fitRequest}
        />
      ) : (
        <div
          className="flex w-full items-center justify-center rounded-xl border border-dashed border-ad-border bg-ad-surface"
          style={{ aspectRatio: String(COVER_ASPECT) }}
        >
          <p className="text-sm text-ad-muted">Find an address to start.</p>
        </div>
      )}

      <p className="text-xs text-ad-muted">
        The photo is exactly what the map shows, at {COVER_WIDTH_PX}&times;{COVER_HEIGHT_PX}. Pan
        and zoom to re-frame it; hold &#8984; or Ctrl to zoom with the scroll wheel.
      </p>
    </div>
  );
}
