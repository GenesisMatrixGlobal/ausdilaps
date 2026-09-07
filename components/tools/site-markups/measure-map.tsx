"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { LatLng } from "@/lib/kml/types";
import { centroidOf } from "@/lib/kml/standard-markup/geometry";
import {
  MIN_POINTS,
  formatArea,
  formatLength,
  measureShape,
  ringFor,
  ringSelfIntersects,
  type ShapeMode,
} from "@/lib/kml/standard-markup/measure";
import { MapsKeyMissingError, loadGoogleMaps } from "@/lib/maps/loader";
import { createMeasureLabel, type MeasureLabel } from "./measure-label";
import { MAX_POINTS, type MeasureState } from "./measure-shapes";

/**
 * The Measure tab's map.
 *
 * ONE RULE, and everything here follows from it: **geometry flows one way, overlay to
 * React.** Every geometry mutation — a map click, a vertex drag, a midpoint insert, Undo,
 * Clear, a right-click delete — writes into the overlay's MVCArray, and syncFromOverlay()
 * mirrors the result into React state, which only the sidebar reads. React writes geometry
 * back in exactly one place: createOverlay(), before any listener is attached.
 *
 * The obvious alternative — reconcile React state into the overlay whenever they differ,
 * guarded by a "we're writing" ref — does not work. The failure isn't an infinite loop
 * (which a ref would catch) but a stale frame: the map is at path N+2 while React renders
 * N, the reconcile sees "not equal", pushes N back, and the vertex under your finger jumps
 * backwards. With one direction there is nothing to guard.
 */

export interface MapCommands {
  undoPoint: (id: string) => void;
  clearPoints: (id: string) => void;
  /** The live viewport, for the PNG export — the server re-renders this exact frame
   *  through the Static Maps API, because Maps JS tiles are cross-origin and the live
   *  map's canvas can never be read back.
   *
   *  Bounds rather than centre+zoom: the map allows FRACTIONAL zoom, and Static Maps only
   *  accepts integers, so rounding would move the frame. Null until the map has settled
   *  enough to report bounds. */
  getCamera: () => {
    bounds: { south: number; west: number; north: number; east: number };
    mapType: "satellite" | "hybrid" | "roadmap";
  } | null;
  /** Fly to a point, or fit a viewport. The only way the parent moves the camera. */
  goTo: (target: { lat: number; lng: number; zoom?: number | null }) => void;
  fit: (bounds: { south: number; west: number; north: number; east: number }) => void;
}

/** ONE colour for every shape, selected or not.
 *
 *  Selection used to swap the shape to steel blue, which was too dark to pick out against
 *  aerial imagery — the shapes you weren't editing effectively disappeared into the photo.
 *  Selection is signalled by the things that actually mean "editable": Google's vertex
 *  handles (only the selected overlay is `editable`, so its dots are the only ones on
 *  screen), a heavier stroke, and the orange label. It also matches the exported PNG,
 *  which has no notion of selection at all. */
const SHAPE_COLOR = "#e8642a";
/** Low on purpose — you're measuring the imagery, not admiring the fill. */
const FILL_OPACITY = 0.18;
const FILL_OPACITY_ACTIVE = 0.26;

interface Handles {
  mode: ShapeMode;
  widthMetres: number;
  /** The editable overlay: the boundary in area mode, the centreline in line mode. */
  editor: google.maps.Polygon | google.maps.Polyline;
  /** Line mode only — the buffered ribbon, derived and non-interactive. */
  ribbon: google.maps.Polygon | null;
  label: MeasureLabel;
  /** The last path read out of the overlay. The samePath() bail compares against this,
   *  and a mode switch carries it across to the replacement overlay. */
  last: LatLng[];
  listeners: google.maps.MapsEventListener[];
}

function mapOptions(maps: typeof google.maps): google.maps.MapOptions {
  return {
    // Brisbane. Only ever seen for the moment before the first search.
    center: { lat: -27.4698, lng: 153.0251 },
    zoom: 13,

    // hybrid, not satellite: street names and lot numbers are how an estimator confirms
    // they're measuring the right frontage before trusting the number.
    mapTypeId: "hybrid",

    // Raster explicitly, and no mapId. Keeps `styles` working (cloud styling silently
    // overrides it once a mapId is set), keeps a WebGL context off the page, and means the
    // map has no tilt or heading to acquire by accident. The cost is that
    // AdvancedMarkerElement is unavailable, which is why the labels are an OverlayView.
    renderingType: maps.RenderingType.RASTER,

    // Anything that breaks plan view is off: a tilted or rotated frame makes the ribbon on
    // screen stop corresponding to the metres in the panel.
    tilt: 0,
    heading: 0,
    rotateControl: false,

    // greedy — "cooperative" makes a scroll-wheel zoom require ctrl and throws the "use
    // ctrl + scroll to zoom" toast. This tool has the operator's whole attention.
    gestureHandling: "greedy",
    // The highest-value option here. A POI pin under the cursor otherwise opens an info
    // window and EATS the click that was meant to place a point — and hybrid over an
    // Australian suburb is covered in them.
    clickableIcons: false,
    // Double-click is how you finish a shape in every other drawing tool. Leave zoom on
    // it and a stray second click jumps the map mid-measurement.
    disableDoubleClickZoom: true,
    // Arrow keys would pan the map; a stray arrow key while the panel has focus shouldn't
    // move the imagery.
    keyboardShortcuts: false,

    // Past 21 Australian aerial imagery is upsampled — you'd be measuring blur with false
    // precision.
    maxZoom: 21,
    // Smooth zoom. A raster map defaults this to FALSE, which makes every wheel notch a
    // whole level — a 2x jump, so one frame is too far out and the next is too far in with
    // nothing usable between. Verified that RASTER honours it: setZoom(17.5) sticks.
    // The PNG export is unaffected because it frames from getBounds(), not from the zoom.
    isFractionalZoomEnabled: true,

    draggableCursor: "crosshair",
    draggingCursor: "grabbing",

    mapTypeControl: true,
    mapTypeControlOptions: {
      // Only the three that matter. The default dropdown also offers terrain and a
      // "Labels" tickbox that silently turns hybrid into satellite.
      mapTypeIds: ["hybrid", "satellite", "roadmap"],
      style: maps.MapTypeControlStyle.HORIZONTAL_BAR,
      position: maps.ControlPosition.TOP_LEFT,
    },
    // A metric scale bar is a free, independent sanity check on every number the panel
    // prints — the cheapest bug detector in the tool.
    scaleControl: true,
    fullscreenControl: true,
    zoomControl: true,
    // Pegman owns a big click target in the corner and has nothing to do with measuring.
    streetViewControl: false,

    // ⚠️ NO `styles`, and do not add one back.
    //
    // Legacy JSON styling silently breaks tile rendering on this API version: the map
    // creates its container div, reports a valid getCenter(), logs NOTHING to the console,
    // and simply never loads a tile. Verified by bisection — ANY non-empty styles array
    // does it, on hybrid, satellite and roadmap alike, whatever the rule; `styles: []` is
    // fine. Google has moved styling to cloud-based map IDs, and the legacy path now fails
    // hard rather than warning.
    //
    // The cost is that POI pins stay visible on hybrid. That's cosmetic only — the
    // load-bearing part was `clickableIcons: false` above, which stops a pin eating the
    // click meant to place a point. An operator who wants a clean frame can switch to
    // Satellite with the map-type control.
    //
    // Turning them off properly would need a cloud-styled `mapId`, which brings vector
    // rendering, tilt/heading, and no OverlayView-based labels. Not worth it to hide pins.
  };
}

/** Exact equality, not a tolerance: these are the same doubles Google handed us, round
 *  tripped through lat()/lng(). A tolerance would only mask a bug. */
function samePath(a: LatLng[], b: LatLng[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => p.lat === b[i].lat && p.lng === b[i].lng);
}

function readPath(overlay: google.maps.Polygon | google.maps.Polyline): LatLng[] {
  return overlay
    .getPath()
    .getArray()
    .map((ll) => ({ lat: ll.lat(), lng: ll.lng() }));
}

export function MeasureMap({
  shapes,
  active,
  ref,
}: {
  shapes: MeasureState;
  /** False while another tab is showing. The map stays mounted (so measurements and the
   *  paid map load survive a tab switch) but a hidden map needs a nudge on the way back. */
  active: boolean;
  /** Exposes MapCommands to the panel. useImperativeHandle rather than the parent passing
   *  a ref for this component to fill: React assigns the parent's ref itself, whereas a
   *  child writing into a ref prop is a post-render mutation of someone else's value. */
  ref?: React.Ref<MapCommands>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // State, not a ref: the effects below have to re-run once the map exists, and a ref
  // mutation wouldn't re-render. Same reasoning as ToolFrame's portal slot.
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handlesRef = useRef<Map<string, Handles>>(new Map());

  // Live props for the imperative handlers, which are attached once and would otherwise
  // capture the first render's closures. Assigned in an effect rather than during render
  // (writing a ref during render is what react-hooks flags), and declared FIRST so it has
  // already run by the time the reconcile effect below reads it — effects run in
  // declaration order.
  const latest = useRef(shapes);
  useEffect(() => {
    latest.current = shapes;
  });

  // ---------------------------------------------------------------- derived + mirror

  /** Ribbon and label, recomputed from h.last. Called from syncFromOverlay (every path
   *  change, at gesture speed) and from the reconcile effect (every width change) — one
   *  function so the two can't diverge. */
  const refreshDerived = useCallback((id: string, h: Handles) => {
    const points = h.last;
    const shape = { points, mode: h.mode, widthMetres: h.widthMetres };
    const enough = points.length >= MIN_POINTS[h.mode];
    const ring = enough ? ringFor(shape) : [];

    if (h.ribbon) {
      // setPath on the existing instance — a new Polygon per frame leaks listeners,
      // flickers, and re-enters the overlay pane at the end of the stack.
      h.ribbon.setPath(ring);
      h.ribbon.setVisible(enough);
    }

    if (!enough) {
      h.label.setPosition(null);
      return;
    }
    const index = latest.current.listRef.current.findIndex((m) => m.id === id) + 1;
    // A bowtie makes ringAreaSqm report the difference of the two lobes. Say so rather
    // than print a confident wrong number.
    if (h.mode === "area" && ringSelfIntersects(points)) {
      h.label.setContent("crosses itself", null, index);
    } else {
      const measured = measureShape(shape);
      h.label.setContent(
        formatArea(measured.areaSqm),
        measured.lengthMetres === null ? null : formatLength(measured.lengthMetres),
        index
      );
    }
    h.label.setPosition(centroidOf(ring));
  }, []);

  /** The single overlay -> React mirror. Also the only place the ribbon and label are
   *  refreshed, so those can never lag the handles by a render: they're plain DOM and
   *  overlay writes in the same tick as the path read, while React state (which only the
   *  panel reads) settles whenever React gets round to it. */
  const syncFromOverlay = useCallback(
    (id: string) => {
      const h = handlesRef.current.get(id);
      if (!h) return;
      const points = readPath(h.editor);
      if (samePath(points, h.last)) return;
      h.last = points;
      refreshDerived(id, h);
      latest.current.setPoints(id, points);
    },
    [refreshDerived]
  );

  // ---------------------------------------------------------------- overlay lifecycle

  const destroy = useCallback((h: Handles) => {
    for (const l of h.listeners) l.remove();
    // The MVCArray holds its own listeners. Miss this and every mode toggle leaves a
    // handler behind writing into a dead shape's slot.
    google.maps.event.clearInstanceListeners(h.editor.getPath());
    google.maps.event.clearInstanceListeners(h.editor);
    h.editor.setMap(null);
    h.ribbon?.setMap(null);
    h.label.destroy();
  }, []);

  const createOverlay = useCallback(
    (
      target: google.maps.Map,
      id: string,
      mode: ShapeMode,
      points: LatLng[],
      widthMetres: number
    ): Handles => {
      const path = points.map((p) => new google.maps.LatLng(p.lat, p.lng));

      // draggable is deliberately OFF on every overlay. On a pannable map, "drag the
      // shape's fill" and "pan the map" are the same gesture on adjacent pixels, so
      // measurements would get shoved around by accident constantly — and translating a
      // shape changes neither its area nor its length, so there is nothing to gain.
      // (It was the right call on the Residential tab's static image: no panning to
      // compete with.) `editable` is set per-selection in applyStyle, not here.
      const shared = { map: target, clickable: true, editable: false, draggable: false, zIndex: 20 };
      // geodesic:false everywhere — geodesic edges would bow bufferLineToPolygon's mitred
      // corners into something that no longer matches the ring we measured.
      const editor: google.maps.Polygon | google.maps.Polyline =
        mode === "area"
          ? new google.maps.Polygon({
              ...shared,
              paths: path,
              geodesic: false,
              strokeColor: SHAPE_COLOR,
              strokeWeight: 2,
              strokeOpacity: 0.95,
              fillColor: SHAPE_COLOR,
              fillOpacity: FILL_OPACITY,
            })
          : new google.maps.Polyline({
              ...shared,
              path,
              geodesic: false,
              // Thin. This is the CENTRELINE — a construction line, not the measurement.
              // The ribbon below is the thing being measured, and a fat centreline reads
              // as a second, competing answer.
              strokeColor: SHAPE_COLOR,
              strokeWeight: 2,
              strokeOpacity: 0.95,
            });

      const ribbon =
        mode === "line"
          ? new google.maps.Polygon({
              map: target,
              paths: ringFor({ points, mode, widthMetres }),
              // Purely derived. clickable:false means it neither receives NOR blocks mouse
              // events, so a click on the ribbon reaches the map and places a point, and a
              // drag on it pans. editable would be nonsense — its vertices are computed,
              // so a handle on one would have nothing to write to.
              clickable: false,
              editable: false,
              draggable: false,
              geodesic: false,
              // Under the centreline. Belt and braces only: Google draws editing control
              // points in the overlayMouseTarget pane, above the overlayLayer pane that
              // holds every Polygon and Polyline, so a vertex handle can't be occluded by
              // another shape's fill whatever the zIndex.
              zIndex: 10,
              strokeColor: SHAPE_COLOR,
              strokeWeight: 2,
              strokeOpacity: 0.9,
              fillColor: SHAPE_COLOR,
              fillOpacity: FILL_OPACITY,
            })
          : null;

      const h: Handles = {
        mode,
        widthMetres,
        editor,
        ribbon,
        label: createMeasureLabel(target),
        last: points,
        listeners: [],
      };

      const mvc = editor.getPath();
      h.listeners.push(
        mvc.addListener("set_at", () => syncFromOverlay(id)),
        mvc.addListener("insert_at", () => syncFromOverlay(id)),
        mvc.addListener("remove_at", () => syncFromOverlay(id)),
        // A click on an overlay has to do the same job as a click on the map, then stop().
        // If Google would also have fired the map's own click, stop() suppresses it; if it
        // wouldn't have, stop() is a no-op. Exactly one point either way — without this
        // you simply cannot add a fourth point inside the triangle you just drew.
        editor.addListener("click", (e: google.maps.PolyMouseEvent) => {
          e.stop();
          if (!e.latLng) return;
          const state = latest.current;
          // Clicking someone else's shape SELECTS it — a better affordance than
          // sidebar-only selection, and it stops a stray click landing a point in the
          // wrong measurement.
          if (state.activeIdRef.current !== id) {
            state.select(id);
            return;
          }
          if (mvc.getLength() >= MAX_POINTS) return;
          mvc.push(e.latLng);
        }),
        // Right-click a vertex to delete it. Google's editable UI gives you handles and
        // midpoint ghosts but no delete — this is the missing third of the gesture.
        // PolyMouseEvent.vertex is only set when the click landed on a vertex.
        editor.addListener("contextmenu", (e: google.maps.PolyMouseEvent) => {
          if (e.vertex === undefined) return;
          e.stop();
          mvc.removeAt(e.vertex);
        })
      );

      refreshDerived(id, h);
      return h;
    },
    [refreshDerived, syncFromOverlay]
  );

  const applyStyle = useCallback((h: Handles, isActive: boolean) => {
    // `editable` is the whole selection mechanic: Google draws vertex handles and midpoint
    // ghosts only on an editable overlay, so deselecting a shape removes its dots and
    // leaves the outline — and a stray drag can't deform a finished measurement. Colour
    // deliberately does NOT change; see SHAPE_COLOR.
    if (h.mode === "area") {
      (h.editor as google.maps.Polygon).setOptions({
        editable: isActive,
        strokeWeight: isActive ? 3.5 : 2,
        fillOpacity: isActive ? FILL_OPACITY_ACTIVE : FILL_OPACITY,
      });
    } else {
      (h.editor as google.maps.Polyline).setOptions({
        editable: isActive,
        strokeWeight: isActive ? 3.5 : 2,
      });
    }
    h.ribbon?.setOptions({ fillOpacity: isActive ? FILL_OPACITY_ACTIVE : FILL_OPACITY });
    h.label.setActive(isActive);
  }, []);

  // ---------------------------------------------------------------- the map itself

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let created: google.maps.Map | null = null;

    loadGoogleMaps()
      .then((maps) => {
        // The load is async, so StrictMode's first cleanup can land before it resolves.
        // Without this the discarded first mount still builds a map into the very div the
        // second mount is about to build into.
        if (cancelled) return;
        created = new maps.Map(container, mapOptions(maps));
        setMap(created);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(
          e instanceof MapsKeyMissingError ? e.message : (e as Error).message || "Couldn't load Google Maps."
        );
      });

    return () => {
      cancelled = true;
      // Deliberately NOT clearInstanceListeners(created): it strips Google's OWN internal
      // listeners along with ours, and we don't need it — every listener we add is tracked
      // and removed individually.
      //
      // Only touch the DOM if THIS run actually built a map. Maps JS appends into the
      // container and never clears, so a discarded map's DOM has to go or a remount
      // stacks a live map on a dead grey one — but an unconditional clear also rips out
      // the DOM of the map the *previous* run created and is still using.
      if (created) container.replaceChildren();
      setMap(null);
    };
  }, []);

  // Teardown of the overlays lives in its own effect so a signature change can never
  // accidentally nuke everything.
  useEffect(
    () => () => {
      handlesRef.current.forEach(destroy);
      // Must clear as well as destroy: handlesRef survives a StrictMode remount, and a
      // stale key would make the "already exists" check below skip creation, leaving
      // state with no overlays at all.
      handlesRef.current.clear();
    },
    [destroy]
  );

  // Click on empty map: place a point into the active measurement, creating one if none
  // is active.
  useEffect(() => {
    if (!map) return;
    const listener = map.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const state = latest.current;
      const id = state.ensureActive();
      if (!id) return; // at the cap
      const h = handlesRef.current.get(id);
      if (h) {
        if (h.editor.getPath().getLength() >= MAX_POINTS) return;
        // The overlay owns the geometry — pushing fires insert_at, which syncs to React.
        h.editor.getPath().push(e.latLng);
        return;
      }
      // No overlay yet: this is the click that created the measurement, so React state is
      // the only place to put the point. createOverlay() reads it back a render later.
      state.appendPoint(id, { lat: e.latLng.lat(), lng: e.latLng.lng() });
    });
    return () => listener.remove();
  }, [map]);

  // ---------------------------------------------------------------- reconcile

  // Everything that changes an overlay's STRUCTURE or STYLE — deliberately not its
  // geometry. A pure geometry write leaves this string identical, so this effect does not
  // even run during a drag. Depending on the array itself (a new identity on every write)
  // would re-run the whole reconcile at drag frame rate.
  const signature =
    shapes.list.map((m) => `${m.id}:${m.mode}:${m.widthMetres}`).join("|") +
    `#${shapes.activeId ?? ""}`;

  useEffect(() => {
    if (!map) return;
    const handles = handlesRef.current;
    const { list, activeId } = latest.current;
    const wanted = new Set(list.map((m) => m.id));

    for (const [id, h] of handles) {
      if (!wanted.has(id)) {
        destroy(h);
        handles.delete(id);
      }
    }

    for (const m of list) {
      let h = handles.get(m.id);
      if (h && h.mode !== m.mode) {
        // A mode switch means a different Google class, so the overlay is replaced. Read
        // the path BEFORE destroying or the points already placed are lost.
        const carried = h.last;
        destroy(h);
        handles.delete(m.id);
        h = createOverlay(map, m.id, m.mode, carried, m.widthMetres);
        handles.set(m.id, h);
        // The carried path is authoritative; push it back so state matches the new overlay.
        if (!samePath(carried, m.points)) latest.current.setPoints(m.id, carried);
      }
      if (!h) {
        // The ONE React -> overlay geometry write in the whole tool. Runs before any
        // listener is attached, which is also what rehydrates after a tab switch.
        h = createOverlay(map, m.id, m.mode, m.points, m.widthMetres);
        handles.set(m.id, h);
      }
      if (h.widthMetres !== m.widthMetres) {
        h.widthMetres = m.widthMetres;
        refreshDerived(m.id, h);
      }
      applyStyle(h, m.id === activeId);
      // Cheap, and keeps the label's index badge right after a removal renumbers the list.
      refreshDerived(m.id, h);
    }
  }, [map, signature, applyStyle, createOverlay, destroy, refreshDerived]);

  // ---------------------------------------------------------------- commands + keys

  // Undo and Clear are commands, not state: "assign this array of points to that overlay"
  // is an instruction, and routing it through React would reintroduce the second direction
  // the one-way rule exists to remove.
  useImperativeHandle(
    ref,
    (): MapCommands => ({
      undoPoint: (id) => {
        const path = handlesRef.current.get(id)?.editor.getPath();
        if (path && path.getLength() > 0) path.removeAt(path.getLength() - 1);
      },
      clearPoints: (id) => {
        handlesRef.current.get(id)?.editor.getPath().clear();
      },
      getCamera: () => {
        if (!map) return null;
        // Undefined until the map's first idle, so an export fired the instant the tab
        // opens reports "not ready" rather than exporting the wrong frame.
        const b = map.getBounds();
        if (!b) return null;
        const ne = b.getNorthEast();
        const sw = b.getSouthWest();
        // Only the three the export can render. `terrain` isn't offered in the map-type
        // control, but a URL or a future option could still set it.
        const raw = map.getMapTypeId();
        const mapType = raw === "satellite" || raw === "roadmap" ? raw : "hybrid";
        return {
          bounds: { south: sw.lat(), west: sw.lng(), north: ne.lat(), east: ne.lng() },
          mapType,
        };
      },
      goTo: ({ lat, lng, zoom }) => {
        if (!map) return;
        map.setCenter({ lat, lng });
        map.setZoom(zoom ?? 19);
      },
      fit: (bounds) => {
        if (!map) return;
        map.fitBounds(bounds, 24);
        // A street address's viewport is one building, so fitBounds runs to maxZoom.
        // Clamp once the fit has settled — a suburb or park keeps its own fitted zoom
        // while a house lands at 20 instead of 21-of-upsampled-pixels. `idle`, not
        // bounds_changed, so this fires once after the animation.
        google.maps.event.addListenerOnce(map, "idle", () => {
          if ((map.getZoom() ?? 0) > 20) map.setZoom(20);
        });
      },
    }),
    [map]
  );

  useEffect(() => {
    if (!map) return;
    function onKeyDown(e: KeyboardEvent) {
      // Guarded, or this eats backspaces in the address box.
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      const state = latest.current;
      const id = state.activeIdRef.current;
      if (e.key === "Escape") {
        state.select(null);
        return;
      }
      if (!id) return;
      if (e.key === "Backspace" || (e.key === "z" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        const path = handlesRef.current.get(id)?.editor.getPath();
        if (path && path.getLength() > 0) path.removeAt(path.getLength() - 1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [map]);

  // A map built or left in a display:none container comes back with a grey void where
  // tiles should be, because it sized itself against a zero-height div. Re-centring is
  // enough to make it re-measure and redraw.
  useEffect(() => {
    if (!map || !active) return;
    const center = map.getCenter();
    if (center) map.setCenter(center);
  }, [map, active]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-ad-border bg-ad-surface">
      <div ref={containerRef} className="h-full w-full" />
      {!map && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          {error ? (
            <p className="max-w-md rounded-lg border border-ad-orange/40 bg-white p-4 text-sm text-ad-ink">
              {error}
            </p>
          ) : (
            <p className="text-sm text-ad-muted">Loading map…</p>
          )}
        </div>
      )}
    </div>
  );
}
