"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import {
  MAPS_AUTH_FAILURE_MESSAGE,
  MapsKeyMissingError,
  loadGoogleMaps,
  onMapsAuthFailure,
} from "@/lib/maps/loader";
import { boundsOfFrame, type Bounds, type Frame } from "@/lib/floor-plan/frame";

/**
 * Point the camera yourself.
 *
 * Replaces a fixed zoom the tool chose and a pair of Wider/Closer buttons that refetched the
 * picture a whole level at a time. The complaint that produced this was exactly right: the
 * view "snapped to a zoom I haven't actually set". A live map has no zoom to snap to.
 *
 * The map is shaped to the A4 sheet's photo area, so what is in the box is what prints —
 * there is no second cropping step to be surprised by. Confirming hands back getBounds(),
 * not a zoom: the map's zoom is fractional and Static Maps takes integers, and
 * lib/floor-plan/frame.ts reproduces a fractional frame exactly by solving for the image
 * size instead of rounding the zoom.
 *
 * Marking up happens on the still that comes back, not on this map. That is deliberate — the
 * A4 sheet IS a still, so framing first means the pins you place are the pins that print.
 */
export function FramePicker({
  start,
  title,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
}: {
  /** Where to open. A frame to reopen, or a point to centre on. */
  start: Frame | { centre: { lat: number; lng: number }; zoom: number };
  title: string;
  confirmLabel: string;
  onConfirm: (bounds: Bounds) => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Read inside the effect only — `start` is the opening camera and must never re-create the
  // map, which would throw away whatever the operator has since panned to.
  const startRef = useRef(start);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let created: google.maps.Map | null = null;

    loadGoogleMaps()
      .then((maps) => {
        // The load is async, so StrictMode's first cleanup can land before it resolves.
        if (cancelled) return;
        const s = startRef.current;
        created = new maps.Map(container, {
          center: s.centre,
          zoom: s.zoom,
          mapTypeId: "satellite",
          // Raster, no mapId: keeps a WebGL context off the page and means the map has no
          // tilt or heading to acquire by accident. See measure-map.tsx for the long version.
          renderingType: maps.RenderingType.RASTER,
          tilt: 0,
          heading: 0,
          rotateControl: false,
          // A plain wheel zooms. "cooperative" would demand ctrl and throw a toast, and
          // framing a photo is the operator's whole attention here.
          gestureHandling: "greedy",
          clickableIcons: false,
          // A raster map defaults this to false, which makes every wheel notch a 2x jump —
          // one frame too far out, the next too far in, nothing usable between. That IS the
          // bug being fixed, so it matters more here than anywhere.
          isFractionalZoomEnabled: true,
          maxZoom: 21,
          mapTypeControl: true,
          mapTypeControlOptions: {
            // Hybrid puts street names on the sheet, which is worth having on a site plan.
            mapTypeIds: ["satellite", "hybrid"],
            style: maps.MapTypeControlStyle.HORIZONTAL_BAR,
            position: maps.ControlPosition.TOP_LEFT,
          },
          scaleControl: true,
          zoomControl: true,
          streetViewControl: false,
          fullscreenControl: false,
          keyboardShortcuts: false,
        });
        // A saved frame is a rectangle, not a centre — fit it so a reframe reopens on exactly
        // what is on the sheet rather than near it.
        if ("width" in startRef.current) {
          const b = boundsOfFrame(startRef.current);
          created.fitBounds(
            new maps.LatLngBounds({ lat: b.south, lng: b.west }, { lat: b.north, lng: b.east }),
            0
          );
        }
        mapRef.current = created;
        setReady(true);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(
          e instanceof MapsKeyMissingError ? e.message : (e as Error).message || "Couldn't load Google Maps."
        );
      });

    return () => {
      cancelled = true;
      // Maps JS appends into the container and never clears, so a discarded map's DOM has to
      // go or a remount stacks a live map on a dead grey one.
      if (created) container.replaceChildren();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // A rejected key resolves the loader and returns a Map that never paints, so the rejection
  // has to be subscribed to separately or the operator just gets a blank grey box.
  useEffect(() => onMapsAuthFailure(() => setError(MAPS_AUTH_FAILURE_MESSAGE)), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function confirm() {
    const b = mapRef.current?.getBounds();
    if (!b) {
      setError("The map is still loading — try again in a moment.");
      return;
    }
    const ne = b.getNorthEast();
    const sw = b.getSouthWest();
    onConfirm({ north: ne.lat(), east: ne.lng(), south: sw.lat(), west: sw.lng() });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ad-ink/60 p-4">
      <div className="flex max-h-full w-full max-w-lg flex-col rounded-xl bg-white p-4 shadow-xl">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold text-ad-ink">{title}</h3>
          <p className="text-xs text-ad-muted">Scroll to zoom, drag to move</p>
        </div>

        {error ? (
          <p className="mt-3 rounded-lg border border-ad-orange bg-ad-orange/10 p-3 text-xs text-ad-ink">
            {error}
          </p>
        ) : (
          // Shaped to the sheet's photo area, so the box IS the page. min-h-0 lets it shrink
          // inside the flex column on a short window instead of pushing the buttons off.
          <div className="mt-3 min-h-0 flex-1">
            <div
              ref={containerRef}
              style={{ aspectRatio: "31 / 40" }}
              className="mx-auto h-full max-h-[62vh] rounded-lg bg-ad-surface"
            />
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!ready || !!busy}
            className={cn(buttonVariants({ variant: "accent", size: "sm" }))}
          >
            {busy ? "Capturing…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
