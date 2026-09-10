"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { LatLng } from "@/lib/kml/types";
import { bufferLineToPolygon, closeRing } from "@/lib/kml/standard-markup/geometry";
import {
  FILL_OPACITY_PERCENT,
  NEIGHBOUR_FILL,
  OUTLINE_WEIGHT,
  SHAPE_COLORS,
  SITE_RED,
  STROKE_OPACITY_PERCENT,
} from "@/lib/kml/standard-markup/style";
import {
  MAPS_AUTH_FAILURE_MESSAGE,
  MapsKeyMissingError,
  loadGoogleMaps,
  mapsAuthFailed,
  onMapsAuthFailure,
} from "@/lib/maps/loader";
import { createMapBadge, type MapBadge } from "./map-badge";
import { createVertexHandles, type VertexHandles } from "./vertex-handles";
import { MAX_SHAPE_POINTS, MIN_POINTS, type ShapeDraft, type ShapesState } from "./shapes";
import { badgeAnchor, ringAnchor } from "@/lib/kml/standard-markup/measure";
import { lotKey, shapeKey } from "@/lib/markup-layers/plan";

/**
 * Building Markup's map.
 *
 * Replaced a Static Maps PNG with an SVG overlay on top. That arrangement could not pan, its
 * zoom was a slider that refetched the image, and its frame had to be PINNED at Generate so
 * that drawing a shape couldn't shift the photo underneath the operator — which in turn needed
 * a re-fit rule for every case where the frame should move after all (a giant cadastre lot
 * dragging the bounds, unticking that lot, unticking the subject). All of that is gone: the
 * operator points the camera themselves.
 *
 * ONE RULE, inherited from measure-map.tsx and everything here follows from it: **geometry
 * flows one way, overlay to React.** Every mutation — a map click, a vertex drag, a midpoint
 * insert, a right-click delete — writes into the overlay's MVCArray, and syncFromOverlay()
 * mirrors the result into React state, which only the panel reads. React writes geometry back
 * in exactly one place: createOverlay(), before any listener is attached.
 *
 * The obvious alternative — reconcile React into the overlay whenever they differ, guarded by
 * a "we're writing" ref — does not work. The failure isn't a loop (a ref would catch that) but
 * a stale frame: the map is at path N+2 while React renders N, the reconcile pushes N back,
 * and the vertex under your finger jumps backwards.
 */

/** Percentages in the shared style module; Google's options want 0-1. Colours are stored
 *  without a '#', which Static Maps wants and Maps JS doesn't — so the on-screen shape and
 *  the exported PNG can never drift apart on colour or opacity. */
const FILL_OPACITY = FILL_OPACITY_PERCENT / 100;
const STROKE_OPACITY = STROKE_OPACITY_PERCENT / 100;

export interface MarkupMapCommands {
  /** Undo the last point, and clear all points.
   *
   *  Commands, not state writes: under the one-way rule the OVERLAY owns the geometry, so
   *  "drop the last vertex" has to happen in its MVCArray — which then mirrors back into
   *  React. Calling shapes.undoPoint() directly would change the panel's numbers and leave
   *  the shape on the map exactly as it was. */
  undoPoint: (id: string) => void;
  clearPoints: (id: string) => void;
  /** The live viewport, for the PNG export — the server re-renders this exact frame through
   *  the Static Maps API, because Maps JS tiles are cross-origin and the live map's canvas can
   *  never be read back.
   *
   *  Bounds rather than centre+zoom: the map allows FRACTIONAL zoom (17.5 is a real state) and
   *  Static Maps accepts integers only, so rounding would move the frame by up to 40% of its
   *  area. Null until the map's first idle, so an export fired the instant the tab opens
   *  reports "not ready" rather than exporting the wrong frame. */
  getCamera: () => {
    bounds: { south: number; west: number; north: number; east: number };
    mapType: "satellite" | "hybrid" | "roadmap";
  } | null;
}

/** The ring a shape renders as — the SAME functions the server renderer uses, so the preview
 *  can't drift from the exported PNG (same width buffer, same mitre joins, same closing
 *  rule). Empty until it has enough points. */
function ringFor(shape: { points: LatLng[]; mode: "line" | "area"; widthMetres: number }): LatLng[] {
  if (shape.points.length < MIN_POINTS[shape.mode]) return [];
  return shape.mode === "area"
    ? closeRing(shape.points)
    : bufferLineToPolygon(shape.points, shape.widthMetres);
}

interface ShapeHandles {
  mode: "line" | "area";
  widthMetres: number;
  color: keyof typeof SHAPE_COLORS;
  /** The editable overlay: the boundary in area mode, the centreline in line mode. */
  editor: google.maps.Polygon | google.maps.Polyline;
  /** Line mode only — the buffered ribbon, derived and non-interactive. */
  ribbon: google.maps.Polygon | null;
  /** The last path read out of the overlay. samePath() compares against this, and a mode
   *  switch carries it across to the replacement overlay. */
  last: LatLng[];
  /** The numbered circle badge. */
  badge: MapBadge;
  /** Only the SELECTED shape has handles — see styleShape. */
  handles: VertexHandles | null;
  listeners: google.maps.MapsEventListener[];
}

interface LotHandles {
  polygon: google.maps.Polygon;
  badge: MapBadge;
}

function mapOptions(maps: typeof google.maps): google.maps.MapOptions {
  return {
    // Brisbane. Only ever seen for the moment before the first snapshot.
    center: { lat: -27.4698, lng: 153.0251 },
    zoom: 13,
    // hybrid, not satellite: street names and lot numbers are how an estimator confirms the
    // cadastre picked the right property.
    mapTypeId: "hybrid",

    // Raster explicitly, and NO mapId. A mapId switches the map to vector rendering, which
    // silently discards `styles` and makes OverlayView-based badges impossible.
    renderingType: maps.RenderingType.RASTER,

    // Anything that breaks plan view is off: a tilted or rotated frame stops the outline on
    // screen corresponding to the square metres in the sheet, and the export is always
    // north-up.
    tilt: 0,
    heading: 0,
    rotateControl: false,

    gestureHandling: "greedy",
    // Load-bearing, not cosmetic: a POI pin under the cursor otherwise opens an info window
    // and EATS the click meant to place a point — and hybrid over an Australian suburb is
    // covered in them.
    clickableIcons: false,
    disableDoubleClickZoom: true,
    keyboardShortcuts: false,

    // Past 21 Australian aerial imagery is upsampled.
    maxZoom: 21,
    // Smooth zoom. A raster map defaults this FALSE, which makes every wheel notch a whole
    // level — one frame too far out, the next too far in, nothing usable between. The export
    // is unaffected because it frames from getBounds(), not from the zoom.
    isFractionalZoomEnabled: true,

    draggableCursor: "crosshair",
    draggingCursor: "grabbing",

    mapTypeControl: true,
    mapTypeControlOptions: {
      // Only the three the export can render. The default dropdown also offers terrain and a
      // "Labels" tickbox that silently turns hybrid into satellite.
      mapTypeIds: ["hybrid", "satellite", "roadmap"],
      style: maps.MapTypeControlStyle.HORIZONTAL_BAR,
      position: maps.ControlPosition.TOP_LEFT,
    },
    scaleControl: true,
    fullscreenControl: true,
    zoomControl: true,
    streetViewControl: false,

    // ⚠️ NO `styles`, and do not add one back. Legacy JSON styling silently breaks tile
    // rendering on this API version: the map reports a valid getCenter(), logs nothing, and
    // never loads a tile. Verified by bisection — ANY non-empty styles array does it, on every
    // map type, whatever the rule. `clickableIcons: false` above is the part that actually
    // mattered.
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

export function MarkupMap({
  shapes,
  subjectRing,
  hideSubject,
  lots,
  numbers,
  pickMode,
  onPick,
  fitRequest,
  ref,
}: {
  shapes: ShapesState;
  subjectRing: LatLng[];
  hideSubject: boolean;
  /** Only the lots that are ticked on the MAP. Unticking one removes its polygon and its badge. */
  lots: { id: string; ring: LatLng[] }[];
  /** Quote item number per layer key. A layer absent from this map is drawn but NOT numbered —
   *  which is how the project site gets shown to a client without becoming a line item. Derived
   *  once by the tab from rowsFrom(), so the bubble, the sheet and the legend always agree. */
  numbers: Map<string, number>;
  /** While true a map click reports a coordinate for the cadastre lookup instead of placing a
   *  shape point. */
  pickMode: boolean;
  onPick: (point: LatLng) => void;
  /**
   * "Frame these rings, once." Declarative rather than an imperative fit() from the parent
   * because of a race the imperative version loses: on the FIRST snapshot the map mounts in
   * the same render that the geometry arrives, so a fit fired a frame later finds the map
   * still loading and silently does nothing — the operator's first markup would never be
   * framed. Keyed, so it re-fits when a NEW markup arrives and not when a checkbox changes.
   */
  fitRequest: { key: string; rings: LatLng[][] } | null;
  ref?: React.Ref<MarkupMapCommands>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // State, not a ref: the effects below have to re-run once the map exists, and a ref
  // mutation wouldn't re-render.
  const [map, setMap] = useState<google.maps.Map | null>(null);
  // Initialised from the sticky flag rather than set in an effect: the rejection may have
  // landed before this component existed, and a synchronous setState in an effect body is
  // both a cascading render and a React-compiler lint error.
  const [error, setError] = useState<string | null>(() =>
    mapsAuthFailed() ? MAPS_AUTH_FAILURE_MESSAGE : null
  );
  const shapeHandles = useRef<Map<string, ShapeHandles>>(new Map());
  const lotHandles = useRef<Map<string, LotHandles>>(new Map());
  const subjectRef = useRef<google.maps.Polygon | null>(null);

  // Live props for handlers attached once, which would otherwise capture the first render's
  // closures. Assigned in an effect rather than during render (a ref write during render is
  // what react-hooks flags), and declared FIRST so it has already run by the time the
  // reconcile effects below read it — effects run in declaration order.
  const latest = useRef({ shapes, pickMode, onPick, fitRequest, numbers });
  useEffect(() => {
    latest.current = { shapes, pickMode, onPick, fitRequest, numbers };
  });

  // ---------------------------------------------------------------- derived + mirror

  /** A shape's badge number: its 1-based position in the list, which is what the panel and the
   *  Quote Line Item sheet both show. Read off the synchronous mirror, because this is called
   *  from Google's listeners between renders. */
  const shapeNumber = useCallback((id: string) => {
    const shape = (latest.current.shapes.listRef.current ?? []).find((x) => x.id === id);
    return shape ? latest.current.numbers.get(shapeKey(shape)) ?? null : null;
  }, []);

  /** The ribbon, recomputed from h.last. Called from syncFromOverlay (every path change, at
   *  gesture speed) and from the reconcile effect (every width change) — one function so the
   *  two can't diverge. */
  const refreshRibbon = useCallback((h: ShapeHandles, number: number | null) => {
    const ring = ringFor({ points: h.last, mode: h.mode, widthMetres: h.widthMetres });
    if (h.ribbon) {
      // setPath on the existing instance — a new Polygon per frame leaks listeners, flickers,
      // and re-enters the overlay pane at the end of the stack.
      h.ribbon.setPath(ring);
      h.ribbon.setVisible(ring.length >= 3);
    }
    // Hidden unless it is BOTH measurable and a ticked line item. A shape below MIN_POINTS has
    // no meaningful centroid; an unticked one is deliberately not part of the quote and must
    // carry no number.
    h.badge.setLabel(number === null ? "" : String(number));
    // badgeAnchor, not the ring centroid: a line's ribbon is L-shaped at any bend and the
    // centroid of an L sits in the notch, which put the pin on the neighbour's lot.
    h.badge.setPosition(number === null ? null : badgeAnchor({ points: h.last, mode: h.mode, widthMetres: h.widthMetres }));
    // The handle set is derived from the path, so it follows every geometry change — and
    // no-ops while a drag is in flight. See vertex-handles.ts.
    h.handles?.refresh();
  }, []);

  /** The single overlay -> React mirror. Also the only place the ribbon is refreshed, so it
   *  can never lag the handles by a render. */
  const syncFromOverlay = useCallback(
    (id: string) => {
      const h = shapeHandles.current.get(id);
      if (!h) return;
      const points = readPath(h.editor);
      if (samePath(points, h.last)) return;
      h.last = points;
      refreshRibbon(h, shapeNumber(id));
      latest.current.shapes.setPoints(id, points);
    },
    [refreshRibbon, shapeNumber]
  );

  // ---------------------------------------------------------------- shape overlays

  const destroyShape = useCallback((h: ShapeHandles) => {
    h.handles?.destroy();
    h.badge.destroy();
    for (const l of h.listeners) l.remove();
    // The MVCArray holds its own listeners. Miss this and every mode toggle leaves a handler
    // behind writing into a dead shape's slot.
    google.maps.event.clearInstanceListeners(h.editor.getPath());
    google.maps.event.clearInstanceListeners(h.editor);
    h.editor.setMap(null);
    h.ribbon?.setMap(null);
  }, []);

  const createShape = useCallback(
    (target: google.maps.Map, shape: ShapeDraft): ShapeHandles => {
      const path = shape.points.map((p) => new google.maps.LatLng(p.lat, p.lng));
      const hex = `#${SHAPE_COLORS[shape.color]}`;

      // draggable deliberately OFF on every overlay. On a pannable map, "drag the shape's
      // fill" and "pan the map" are the same gesture on adjacent pixels — and translating a
      // shape changes neither its area nor its length, so there is nothing to gain. It was the
      // right call on the old static image, which had no panning to compete with.
      // `editable` is set per-selection in styleShape, not here.
      const shared = { map: target, clickable: true, editable: false, draggable: false, zIndex: 30 };
      const editor: google.maps.Polygon | google.maps.Polyline =
        shape.mode === "area"
          ? new google.maps.Polygon({
              ...shared,
              // `[path]`, not `path` — a ONE-ring LatLng[][] rather than a bare LatLng[].
              //
              // Google treats a bare empty array as "no rings at all", so getPaths() comes
              // back empty and getPath() (which is getPaths().getAt(0)) returns UNDEFINED —
              // and the very next line, mvc.addListener(), throws "Cannot read properties of
              // undefined". Hit for real: add a shape, switch it to Area before placing any
              // points, and the whole tool white-screened. Wrapping guarantees exactly one
              // ring, empty or not, so the MVCArray the one-way rule depends on always exists.
              paths: [path],
              // geodesic:false everywhere — geodesic edges would bow bufferLineToPolygon's
              // mitred corners into something that no longer matches the ring we measured.
              geodesic: false,
              strokeColor: hex,
              strokeWeight: OUTLINE_WEIGHT,
              strokeOpacity: STROKE_OPACITY,
              fillColor: hex,
              fillOpacity: FILL_OPACITY,
            })
          : new google.maps.Polyline({
              ...shared,
              path,
              geodesic: false,
              // Thin. This is the CENTRELINE, a construction line — the ribbon below is the
              // thing being measured, and a fat centreline reads as a competing answer.
              strokeColor: hex,
              strokeWeight: OUTLINE_WEIGHT,
              strokeOpacity: STROKE_OPACITY,
            });

      const ribbon =
        shape.mode === "line"
          ? new google.maps.Polygon({
              map: target,
              paths: ringFor(shape),
              // Purely derived. clickable:false means it neither receives NOR blocks mouse
              // events, so a click on the ribbon reaches the map and places a point.
              clickable: false,
              editable: false,
              draggable: false,
              geodesic: false,
              zIndex: 20,
              strokeColor: hex,
              strokeWeight: OUTLINE_WEIGHT,
              strokeOpacity: STROKE_OPACITY,
              fillColor: hex,
              fillOpacity: FILL_OPACITY,
            })
          : null;

      const h: ShapeHandles = {
        mode: shape.mode,
        widthMetres: shape.widthMetres,
        color: shape.color,
        editor,
        ribbon,
        last: shape.points,
        // Teardrop, like a lot's — one glyph for everything now that there is one number
        // series. Coloured by the shape's own colour, so the bubble still says which legend row
        // it belongs to.
        badge: createMapBadge(target, "teardrop", hex),
        handles: null,
        listeners: [],
      };

      const mvc = editor.getPath();
      h.listeners.push(
        mvc.addListener("set_at", () => syncFromOverlay(shape.id)),
        mvc.addListener("insert_at", () => syncFromOverlay(shape.id)),
        mvc.addListener("remove_at", () => syncFromOverlay(shape.id)),
        // A click on an overlay has to do the same job as a click on the map, then stop().
        // Without this you simply cannot add a fourth point inside the triangle you just drew.
        editor.addListener("click", (e: google.maps.PolyMouseEvent) => {
          e.stop();
          if (!e.latLng) return;
          const state = latest.current;
          // Pick mode wins: the operator is choosing a lot, not editing a shape.
          if (state.pickMode) {
            state.onPick({ lat: e.latLng.lat(), lng: e.latLng.lng() });
            return;
          }
          // Clicking someone else's shape SELECTS it — a better affordance than
          // sidebar-only selection, and it stops a stray click landing a point in the
          // wrong shape.
          if (state.shapes.activeIdRef.current !== shape.id) {
            state.shapes.select(shape.id);
            return;
          }
          if (mvc.getLength() >= MAX_SHAPE_POINTS) return;
          mvc.push(e.latLng);
        }),
        // Right-click a vertex to delete it. Google's editable UI gives handles and midpoint
        // ghosts but no delete — this is the missing third of the gesture. PolyMouseEvent.vertex
        // is only set when the click landed on a vertex.
        editor.addListener("contextmenu", (e: google.maps.PolyMouseEvent) => {
          if (e.vertex === undefined) return;
          e.stop();
          mvc.removeAt(e.vertex);
        })
      );

      return h;
    },
    [syncFromOverlay]
  );

  const styleShape = useCallback((map: google.maps.Map, h: ShapeHandles, isActive: boolean) => {
    // Selection is signalled by the handles existing and by a heavier stroke. Colour
    // deliberately does NOT change: it maps the shape onto a legend row, so it has to match
    // the exported PNG, which has no notion of selection.
    //
    // `editable` stays FALSE always. Google's own handles are the thing being replaced —
    // leaving it on would give two sets of handles fighting over the same vertices.
    h.editor.setOptions({
      editable: false,
      strokeWeight: isActive ? OUTLINE_WEIGHT * 2 : OUTLINE_WEIGHT,
    });
    if (isActive && !h.handles) {
      h.handles = createVertexHandles(map, h.editor, {
        color: `#${SHAPE_COLORS[h.color]}`,
        // An area's outline is a ring, so it has a segment between its last and first points;
        // a line's does not.
        closed: h.mode === "area",
        minPoints: MIN_POINTS[h.mode],
        maxPoints: MAX_SHAPE_POINTS,
      });
    } else if (!isActive && h.handles) {
      h.handles.destroy();
      h.handles = null;
    }
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
      // Only touch the DOM if THIS run actually built a map: Maps JS appends into the
      // container and never clears, so a discarded map's DOM has to go or a remount stacks a
      // live map on a dead grey one — but an unconditional clear also rips out the DOM of the
      // map the previous run created and is still using.
      if (created) container.replaceChildren();
      setMap(null);
    };
  }, []);

  // A rejected key resolves the loader and returns a Map object, then never paints — so the
  // rejection has to be subscribed to separately or the operator just gets a blank grey box.
  useEffect(() => onMapsAuthFailure(() => setError(MAPS_AUTH_FAILURE_MESSAGE)), []);

  // Teardown in its own effect, so a signature change can never accidentally nuke everything.
  useEffect(
    () => () => {
      shapeHandles.current.forEach(destroyShape);
      // Must clear as well as destroy: the ref survives a StrictMode remount, and a stale key
      // would make the "already exists" check skip creation, leaving state with no overlays.
      shapeHandles.current.clear();
      lotHandles.current.forEach((l) => {
        l.polygon.setMap(null);
        l.badge.destroy();
      });
      lotHandles.current.clear();
      subjectRef.current?.setMap(null);
      subjectRef.current = null;
    },
    [destroyShape]
  );

  // Click on empty map: place a point into the active shape, or report a pick.
  useEffect(() => {
    if (!map) return;
    const listener = map.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const point = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      const state = latest.current;
      if (state.pickMode) {
        state.onPick(point);
        return;
      }
      const id = state.shapes.activeIdRef.current;
      const h = id ? shapeHandles.current.get(id) : undefined;
      if (h) {
        if (h.editor.getPath().getLength() >= MAX_SHAPE_POINTS) return;
        // The overlay owns the geometry — pushing fires insert_at, which syncs to React.
        h.editor.getPath().push(e.latLng);
        return;
      }
      // No overlay yet: this click creates the shape (or extends one that has no overlay
      // because it had no points), so React state is the only place to put it. createShape()
      // reads it back a render later.
      state.shapes.addPoint(point);
    });
    return () => listener.remove();
  }, [map]);

  // ---------------------------------------------------------------- reconcile: shapes

  // Everything that changes an overlay's STRUCTURE or STYLE — deliberately not its geometry.
  // A pure geometry write leaves this string identical, so this effect does not even run
  // during a drag. Depending on the array itself (a new identity on every write) would re-run
  // the whole reconcile at drag frame rate.
  const shapeSignature =
    shapes.shapes
      .map((s) => `${s.id}:${s.mode}:${s.widthMetres}:${s.color}:${numbers.get(shapeKey(s)) ?? ""}`)
      .join("|") + `#${shapes.activeShapeId ?? ""}`;

  useEffect(() => {
    if (!map) return;
    const handles = shapeHandles.current;
    const list = latest.current.shapes.listRef.current ?? [];
    const activeId = latest.current.shapes.activeIdRef.current;
    const wanted = new Set(list.map((s) => s.id));

    for (const [id, h] of handles) {
      if (!wanted.has(id)) {
        destroyShape(h);
        handles.delete(id);
      }
    }

    for (const s of list) {
      let h = handles.get(s.id);
      // A mode or colour change means a different Google class or a restyle from scratch, so
      // the overlay is replaced. Read the path BEFORE destroying, or the points already
      // placed are lost.
      if (h && (h.mode !== s.mode || h.color !== s.color)) {
        const carried = h.last;
        destroyShape(h);
        handles.delete(s.id);
        h = createShape(map, { ...s, points: carried });
        handles.set(s.id, h);
        if (!samePath(carried, s.points)) latest.current.shapes.setPoints(s.id, carried);
      }
      if (!h) {
        // The ONE React -> overlay geometry write in the whole tool. Runs before any listener
        // is attached, which is also what rehydrates after Open .json.
        h = createShape(map, s);
        handles.set(s.id, h);
      }
      if (h.widthMetres !== s.widthMetres) {
        h.widthMetres = s.widthMetres;
      }
      styleShape(map, h, s.id === activeId);
      // Cheap, and keeps the badge's number right after a removal renumbers the list — and the
      // ribbon right after a width change.
      refreshRibbon(h, latest.current.numbers.get(shapeKey(s)) ?? null);
    }
  }, [map, shapeSignature, createShape, destroyShape, refreshRibbon, styleShape]);

  // ---------------------------------------------------------------- reconcile: cadastre

  // The subject boundary. Read-only — it comes from the cadastre, and the way to correct it is
  // to untick it and draw a red shape by hand.
  useEffect(() => {
    if (!map) return;
    if (hideSubject || subjectRing.length < 3) {
      subjectRef.current?.setMap(null);
      subjectRef.current = null;
      return;
    }
    const hex = `#${SITE_RED}`;
    if (!subjectRef.current) {
      subjectRef.current = new google.maps.Polygon({
        map,
        clickable: false,
        editable: false,
        draggable: false,
        geodesic: false,
        // Under the lots and the shapes: it is the largest outline and the backdrop for them.
        zIndex: 5,
        strokeColor: hex,
        // The one thing drawn at full stroke opacity — it is the site.
        strokeOpacity: 1,
        strokeWeight: OUTLINE_WEIGHT,
        fillColor: hex,
        fillOpacity: FILL_OPACITY,
      });
    }
    subjectRef.current.setPath(closeRing(subjectRing));
  }, [map, subjectRing, hideSubject]);

  // Detected lots, keyed on id so unticking one removes exactly its polygon and badge.
  const lotSignature = lots.map((l) => `${l.id}:${numbers.get(lotKey(l.id)) ?? ""}`).join("|");
  useEffect(() => {
    if (!map) return;
    const handles = lotHandles.current;
    const wanted = new Map(lots.map((l) => [l.id, l]));

    for (const [id, h] of handles) {
      if (!wanted.has(id)) {
        h.polygon.setMap(null);
        h.badge.destroy();
        handles.delete(id);
      }
    }

    for (const lot of lots) {
      let h = handles.get(lot.id);
      if (!h) {
        const hex = `#${NEIGHBOUR_FILL}`;
        h = {
          polygon: new google.maps.Polygon({
            map,
            // Read-only, and NOT clickable: a lot covers most of the frame, so a clickable
            // one would swallow every click meant to place a shape point or pick a lot.
            clickable: false,
            editable: false,
            draggable: false,
            geodesic: false,
            zIndex: 10,
            strokeColor: hex,
            strokeOpacity: STROKE_OPACITY,
            strokeWeight: OUTLINE_WEIGHT,
            fillColor: hex,
            fillOpacity: FILL_OPACITY,
          }),
          // Blue, matching the outline it sits on — the bubble's colour is now the item's own
          // colour throughout rather than orange for every lot.
          badge: createMapBadge(map, "teardrop", `#${NEIGHBOUR_FILL}`),
        };
        handles.set(lot.id, h);
      }
      h.polygon.setPath(closeRing(lot.ring));
      const number = numbers.get(lotKey(lot.id)) ?? null;
      h.badge.setLabel(number === null ? "" : String(number));
      // An unticked sheet row means "not a line item" — drawn, but no bubble.
      h.badge.setPosition(number === null ? null : ringAnchor(lot.ring));
    }
    // lotSignature covers add/remove/relabel; the rings themselves only change when the
    // cadastre is re-resolved, which replaces the whole list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, lotSignature]);

  // Frame a newly arrived markup, once the map is actually ready for it.
  const fitKey = fitRequest?.key ?? null;
  useEffect(() => {
    if (!map || !fitKey) return;
    const rings = (latest.current.fitRequest?.rings ?? []).filter((r) => r.length >= 3);
    if (rings.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    for (const ring of rings) for (const p of ring) bounds.extend(new google.maps.LatLng(p.lat, p.lng));
    map.fitBounds(bounds, 40);
    // A single small lot fits all the way to maxZoom, where the imagery is upsampled. Clamp
    // once the fit has settled — `idle`, not bounds_changed, so this fires after the
    // animation rather than fighting it.
    google.maps.event.addListenerOnce(map, "idle", () => {
      if ((map.getZoom() ?? 0) > 20) map.setZoom(20);
    });
  }, [map, fitKey]);

  // The crosshair is the wrong affordance in pick mode — the operator is choosing an existing
  // lot, not drawing.
  useEffect(() => {
    if (!map) return;
    map.setOptions({ draggableCursor: pickMode ? "copy" : "crosshair" });
  }, [map, pickMode]);

  // ---------------------------------------------------------------- commands + keys

  useImperativeHandle(
    ref,
    (): MarkupMapCommands => ({
      undoPoint: (id) => {
        const path = shapeHandles.current.get(id)?.editor.getPath();
        if (path && path.getLength() > 0) path.removeAt(path.getLength() - 1);
      },
      clearPoints: (id) => {
        shapeHandles.current.get(id)?.editor.getPath().clear();
      },
      getCamera: () => {
        if (!map) return null;
        const b = map.getBounds();
        if (!b) return null;
        const ne = b.getNorthEast();
        const sw = b.getSouthWest();
        const raw = map.getMapTypeId();
        const mapType = raw === "satellite" || raw === "roadmap" ? raw : "hybrid";
        return {
          bounds: { south: sw.lat(), west: sw.lng(), north: ne.lat(), east: ne.lng() },
          mapType,
        };
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
      const state = latest.current.shapes;
      if (e.key === "Escape") {
        state.select(null);
        return;
      }
      const id = state.activeIdRef.current;
      if (!id) return;
      if (e.key === "Backspace" || (e.key === "z" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        const path = shapeHandles.current.get(id)?.editor.getPath();
        if (path && path.getLength() > 0) path.removeAt(path.getLength() - 1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [map]);

  return (
    // Height from the viewport, not a square: the row is as wide as the screen allows now, and a
    // square that wide would be taller than the screen. 78vh keeps the toolbar above and a sliver
    // of the sheet below in view; the floor stops a short laptop window crushing it.
    <div className="relative h-[78vh] min-h-[440px] w-full overflow-hidden rounded-xl border border-ad-border bg-ad-surface">
      <div ref={containerRef} className="h-full w-full" />
      {(!map || error) && (
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
      {pickMode && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-ad-ink/85 px-3 py-2 text-xs text-white">
          Click the lot you want to add.
        </div>
      )}
    </div>
  );
}
