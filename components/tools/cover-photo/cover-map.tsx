"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { LatLng } from "@/lib/kml/types";
import type { LatLngBox } from "@/lib/kml/standard-markup/projection";
import {
  MAPS_AUTH_FAILURE_MESSAGE,
  MapsKeyMissingError,
  loadGoogleMaps,
  mapsAuthFailed,
  onMapsAuthFailure,
} from "@/lib/maps/loader";
import { createVertexHandles, type VertexHandles } from "@/components/tools/shared/vertex-handles";
import { MAX_DRAWN_POINTS } from "@/lib/cover-photo/schema";
import {
  COVER_ASPECT,
  COVER_DIM_OUTSIDE_PERCENT,
  COVER_FILL_OPACITY_PERCENT,
  COVER_GREEN,
  COVER_OUTLINE_WEIGHT,
  COVER_STROKE_OPACITY_PERCENT,
} from "@/lib/cover-photo/style";

/**
 * The cover photo's map: ONE green area polygon on a live aerial.
 *
 * A focused sibling of Building Markup's markup-map.tsx, not a mode of it. That component's
 * job is a list of lots, several hand-drawn shapes in three colours, numbered badges and the
 * quote sheet's selection state; none of that exists here, and a "cover photo" flag threaded
 * through 788 lines would be harder to follow than this file.
 *
 * What IS carried over, verbatim and for the reasons documented there:
 *  - the one-way rule: geometry flows overlay -> React. Every mutation (map click, vertex
 *    drag, midpoint insert, right-click delete) writes into the overlay's MVCArray and
 *    syncFromOverlay() mirrors it up. React writes geometry back in exactly ONE place —
 *    createOverlay(), before any listener is attached. Reconciling both ways behind a
 *    "we're writing" ref fails as a stale frame, with the vertex jumping backwards under
 *    the operator's finger.
 *  - the map options, each of which is load-bearing (see the comments on mapOptions).
 *  - our own vertex handles, because Google's are ~5px and unresizable.
 */

const FILL_OPACITY = COVER_FILL_OPACITY_PERCENT / 100;
const STROKE_OPACITY = COVER_STROKE_OPACITY_PERCENT / 100;
const HEX = `#${COVER_GREEN}`;
/** A polygon needs three points to be an area at all. */
const MIN_POINTS = 3;

/**
 * Half-width of the dim layer's outer ring, in degrees.
 *
 * ⚠️ NOT the whole world. A polygon spanning -180..180 renders DEGENERATELY in Maps JS — it
 * reports the right paths, the right fill and visible:true, and paints nothing at all, which
 * is a thoroughly confusing way to fail. Verified by swapping the same polygon to a local box
 * with everything else unchanged and watching it appear. 2 degrees is ~220 km, so it covers
 * any viewport this tool is ever framed at, and the map's maxZoom keeps you nowhere near the
 * edge.
 */
const DIM_SPAN_DEGREES = 2;

/** The outer ring of the dim layer, around the shape being punched out of it. */
function dimOuterRing(around: LatLng): LatLng[] {
  const d = DIM_SPAN_DEGREES;
  return [
    { lat: around.lat - d, lng: around.lng - d },
    { lat: around.lat - d, lng: around.lng + d },
    { lat: around.lat + d, lng: around.lng + d },
    { lat: around.lat + d, lng: around.lng - d },
  ];
}

export interface CoverMapCommands {
  /** The live viewport, for the export — the server re-renders this exact frame through the
   *  Static Maps API, because Maps JS tiles are cross-origin and the live canvas can never be
   *  read back.
   *
   *  Bounds rather than centre+zoom: the map allows FRACTIONAL zoom (17.5 is a real state) and
   *  Static Maps accepts integers only, so rounding would move the frame. Null until the map's
   *  first idle, so an export fired the instant the tool opens reports "not ready" rather than
   *  rendering the wrong place. */
  getCamera: () => {
    bounds: LatLngBox;
    mapType: "satellite" | "hybrid" | "roadmap";
  } | null;
  /** Drop the last point placed — the overlay owns the geometry, so this has to happen in its
   *  MVCArray rather than in React state. */
  undoPoint: () => void;
}

function mapOptions(maps: typeof google.maps): google.maps.MapOptions {
  return {
    // Brisbane. Only ever seen for the moment before the first address resolves.
    center: { lat: -27.4698, lng: 153.0251 },
    zoom: 13,
    // hybrid, not satellite: the street names are half the point of a cover photo's border.
    mapTypeId: "hybrid",

    // Raster explicitly, and NO mapId. A mapId switches the map to vector rendering, which
    // silently discards `styles` and breaks OverlayView-based children.
    renderingType: maps.RenderingType.RASTER,

    // Plan view only. A tilted or rotated frame would stop the outline on screen matching the
    // exported PNG, which is always north-up.
    tilt: 0,
    heading: 0,
    rotateControl: false,

    // Scroll-wheel and trackpad zoom need Cmd on a Mac / Ctrl on Windows; Google picks the key
    // for the platform and shows the hint itself. Without it the map swallows every scroll
    // meant for the page.
    gestureHandling: "cooperative",
    // Load-bearing, not cosmetic: a POI pin under the cursor otherwise opens an info window
    // and EATS the click meant to place a point — and hybrid over an Australian suburb is
    // covered in them.
    clickableIcons: false,
    disableDoubleClickZoom: true,
    keyboardShortcuts: false,

    // Past 21 Australian aerial imagery is upsampled.
    //
    // ⚠️ The REAL ceiling is 20.5, and it is the map's WIDTH that keeps us under it — see the
    // container's max-width. At 20.5 Maps JS stops scaling zoom-20 tiles and starts asking for
    // zoom-21 ones, which often do not exist here: the map goes grey and only fills in once
    // you zoom and it re-requests. That is what "it doesn't actually load the image properly
    // until I zoom" was at 68 Mason St, Newport, on a full-width map fitting at ~20.8.
    //
    // Left at 21 rather than capped at 20 so the toolbar's Zoom control keeps working; the
    // default frame simply never asks for more. The EXPORT is unaffected either way — it
    // re-renders from the bounds through Static Maps and downsamples, so the PNG keeps its
    // detail whatever the preview is showing.
    maxZoom: 21,
    // Smooth zoom. A raster map defaults this FALSE, which makes every wheel notch a whole
    // level — one frame too far out, the next too far in, nothing usable between. Framing a
    // cover photo is exactly the job that needs the in-between. The export is unaffected
    // because it frames from getBounds(), not from the zoom.
    isFractionalZoomEnabled: true,

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
    // ⚠️ Google's own zoom buttons are OFF, deliberately. They step to the next WHOLE zoom
    // level, which with isFractionalZoomEnabled is a variable jump of up to 2x the ground —
    // and they sit in the map's bottom-right, right where you reach for a zoom. Two controls
    // on one screen stepping by different amounts is why "+" felt like it went in way too far
    // (Rhys, 2026-09-16): he was hitting Google's, not the toolbar's. The toolbar's Zoom is
    // now the only one, and it moves one measured step at a time. Cmd/Ctrl + scroll still
    // gives free-form zoom for anyone who wants it.
    zoomControl: false,
    streetViewControl: false,

    // ⚠️ NO `styles`, and do not add one back. Legacy JSON styling silently breaks tile
    // rendering on this API version: the map reports a valid getCenter(), logs nothing and
    // never loads a tile. `clickableIcons: false` above is the part that actually mattered.
    // (The SERVER render does pass styles to the Static Maps API, which is a different API
    // and unaffected — see lib/cover-photo/render.ts.)
  };
}

/** Exact equality, not a tolerance: these are the same doubles Google handed us, round
 *  tripped through lat()/lng(). A tolerance would only mask a bug. */
function samePath(a: LatLng[], b: LatLng[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => p.lat === b[i].lat && p.lng === b[i].lng);
}

function readPath(overlay: google.maps.Polygon): LatLng[] {
  return overlay
    .getPath()
    .getArray()
    .map((ll) => ({ lat: ll.lat(), lng: ll.lng() }));
}

export function CoverMap({
  ring,
  ringKey,
  drawing,
  onRingChange,
  fitRequest,
  ref,
}: {
  ring: LatLng[];
  /**
   * Which GENERATION of the ring is loaded. The overlay owns the geometry, so React may only
   * replace it wholesale — a new address resolved, or the operator cleared it to draw. Bumping
   * this key is how the parent says "this is a different ring now, rebuild"; edits made on the
   * map flow back through onRingChange and leave the key alone.
   */
  ringKey: string;
  /** While true a map click places a point. While false the map only pans and zooms — a stray
   *  click must not add a vertex to a cadastre boundary the operator is happy with. Dragging
   *  existing vertices works in both. */
  drawing: boolean;
  onRingChange: (ring: LatLng[]) => void;
  /** "Frame this box, once." Declarative rather than an imperative fit() from the parent
   *  because of a race the imperative version loses: on the first Generate the map mounts in
   *  the same render the geometry arrives, so a fit fired a frame later finds the map still
   *  loading and silently does nothing. Keyed, so it re-frames on a NEW address and not on
   *  every edit. */
  fitRequest: { key: string; box: LatLngBox } | null;
  ref?: React.Ref<CoverMapCommands>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // State, not a ref: the effects below have to re-run once the map exists, and a ref mutation
  // wouldn't re-render.
  const [map, setMap] = useState<google.maps.Map | null>(null);
  // Initialised from the sticky flag rather than set in an effect: the rejection may have
  // landed before this component existed.
  const [error, setError] = useState<string | null>(() =>
    mapsAuthFailed() ? MAPS_AUTH_FAILURE_MESSAGE : null
  );

  const polygonRef = useRef<google.maps.Polygon | null>(null);
  /** The dark scrim. A second polygon rather than anything clever: the world as its outer ring
   *  and the property as a HOLE, which is the live-map equivalent of the export's evenodd
   *  path. Without it the preview would show a bright surround and the PNG a dimmed one —
   *  exactly the preview/export drift CLAUDE.md calls the standing hazard on these tools. */
  const dimRef = useRef<google.maps.Polygon | null>(null);
  const handlesRef = useRef<VertexHandles | null>(null);
  const listenersRef = useRef<google.maps.MapsEventListener[]>([]);
  /** The last path read out of the overlay, so samePath() has something to compare against. */
  const lastRef = useRef<LatLng[]>(ring);

  // Live props for handlers attached once, which would otherwise capture the first render's
  // closures. Assigned in an effect rather than during render (a ref write during render is
  // what the React compiler lint flags), and declared FIRST so it has already run by the time
  // the effects below read it — effects run in declaration order.
  const latest = useRef({ ring, drawing, onRingChange, fitRequest });
  useEffect(() => {
    latest.current = { ring, drawing, onRingChange, fitRequest };
  });

  /** Repoints the scrim's hole at the current outline. Below MIN_POINTS there is no area to
   *  punch out, and dimming the whole map while someone is still placing points would just be
   *  in the way — so the layer hides itself until the shape exists. */
  const refreshDim = useCallback((points: LatLng[]) => {
    const dim = dimRef.current;
    if (!dim) return;
    if (points.length < MIN_POINTS) {
      dim.setVisible(false);
      return;
    }
    // Reversed: Google renders an inner path as a hole only when it is wound opposite to the
    // outer one.
    dim.setPaths([dimOuterRing(points[0]), [...points].reverse()]);
    dim.setVisible(true);
  }, []);

  /** The single overlay -> React mirror. */
  const syncFromOverlay = useCallback(() => {
    const polygon = polygonRef.current;
    if (!polygon) return;
    const points = readPath(polygon);
    if (samePath(points, lastRef.current)) return;
    lastRef.current = points;
    handlesRef.current?.refresh();
    refreshDim(points);
    latest.current.onRingChange(points);
  }, [refreshDim]);

  const destroyOverlay = useCallback(() => {
    dimRef.current?.setMap(null);
    dimRef.current = null;
    handlesRef.current?.destroy();
    handlesRef.current = null;
    for (const l of listenersRef.current) l.remove();
    listenersRef.current = [];
    const polygon = polygonRef.current;
    if (polygon) {
      // The MVCArray holds its own listeners. Miss this and a handler is left behind writing
      // into a dead overlay.
      google.maps.event.clearInstanceListeners(polygon.getPath());
      google.maps.event.clearInstanceListeners(polygon);
      polygon.setMap(null);
    }
    polygonRef.current = null;
  }, []);

  // The map itself.
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
      // container and never clears, so a discarded map's DOM has to go — but an unconditional
      // clear also rips out the DOM of the map the previous run is still using.
      if (created) container.replaceChildren();
      setMap(null);
    };
  }, []);

  // A rejected key resolves the loader and returns a Map object, then never paints — so the
  // rejection has to be subscribed to separately or the operator just gets a blank grey box.
  useEffect(() => onMapsAuthFailure(() => setError(MAPS_AUTH_FAILURE_MESSAGE)), []);

  // Teardown in its own effect, so a ringKey change can never accidentally nuke everything.
  useEffect(() => () => destroyOverlay(), [destroyOverlay]);

  // ---------------------------------------------------------------- the overlay
  //
  // THE ONLY place React writes geometry into the overlay. Keyed on ringKey, so an edit made
  // on the map (which changes `ring` but not the key) never rebuilds the polygon the operator
  // is holding.
  useEffect(() => {
    if (!map) return;
    destroyOverlay();

    const initial = latest.current.ring;
    lastRef.current = initial;

    if (COVER_DIM_OUTSIDE_PERCENT > 0) {
      dimRef.current = new google.maps.Polygon({
        map,
        // Never clickable: it covers the entire map, so a clickable scrim would swallow every
        // click meant to place a point.
        clickable: false,
        editable: false,
        draggable: false,
        zIndex: 20,
        strokeWeight: 0,
        fillColor: "#000000",
        fillOpacity: COVER_DIM_OUTSIDE_PERCENT / 100,
        // Real paths arrive from refreshDim below; this is only a valid starting shape.
        paths: [dimOuterRing(initial[0] ?? { lat: -27.4698, lng: 153.0251 })],
        visible: false,
      });
      refreshDim(initial);
    }

    const polygon = new google.maps.Polygon({
      map,
      clickable: true,
      // `editable` stays FALSE always: our own handles replace Google's, and leaving this on
      // would give two sets fighting over the same vertices.
      editable: false,
      // draggable deliberately OFF. On a pannable map, "drag the shape's fill" and "pan the
      // map" are the same gesture on adjacent pixels — and translating the boundary is never
      // something a cover photo wants.
      draggable: false,
      zIndex: 30,
      // `[path]`, not `path` — a ONE-ring LatLng[][] rather than a bare LatLng[]. Google reads
      // a bare empty array as "no rings at all", so getPaths() comes back empty, getPath()
      // returns UNDEFINED and the very next line throws. Wrapping guarantees exactly one ring,
      // empty or not, so the MVCArray the one-way rule depends on always exists.
      paths: [initial.map((p) => new google.maps.LatLng(p.lat, p.lng))],
      // geodesic:false — geodesic edges would bow the outline away from the straight-line ring
      // the server renders.
      geodesic: false,
      strokeColor: HEX,
      strokeWeight: COVER_OUTLINE_WEIGHT,
      strokeOpacity: STROKE_OPACITY,
      fillColor: HEX,
      fillOpacity: FILL_OPACITY,
    });
    polygonRef.current = polygon;

    const mvc = polygon.getPath();
    listenersRef.current = [
      mvc.addListener("set_at", syncFromOverlay),
      mvc.addListener("insert_at", syncFromOverlay),
      mvc.addListener("remove_at", syncFromOverlay),
      // A click on the overlay has to do the same job as a click on the map, then stop().
      // Without this you cannot add a point inside the shape you just drew.
      polygon.addListener("click", (e: google.maps.PolyMouseEvent) => {
        e.stop();
        if (!e.latLng || !latest.current.drawing) return;
        if (mvc.getLength() >= MAX_DRAWN_POINTS) return;
        mvc.push(e.latLng);
      }),
      // Right-click a vertex to delete it. Google's editable UI gives handles and midpoint
      // ghosts but no delete — this is the missing third of the gesture. PolyMouseEvent.vertex
      // is only set when the click landed on a vertex.
      polygon.addListener("contextmenu", (e: google.maps.PolyMouseEvent) => {
        if (e.vertex === undefined) return;
        e.stop();
        mvc.removeAt(e.vertex);
      }),
    ];

    // Always on: there is one shape and it is always the one being edited, so there is no
    // selection state to express.
    handlesRef.current = createVertexHandles(map, polygon, {
      color: HEX,
      // An area's outline is a ring, so it has a segment between its last and first points.
      closed: true,
      minPoints: MIN_POINTS,
      maxPoints: MAX_DRAWN_POINTS,
    });
  }, [map, ringKey, destroyOverlay, syncFromOverlay, refreshDim]);

  // Click on empty map: place a point.
  useEffect(() => {
    if (!map) return;
    const listener = map.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng || !latest.current.drawing) return;
      const mvc = polygonRef.current?.getPath();
      if (!mvc || mvc.getLength() >= MAX_DRAWN_POINTS) return;
      // The overlay owns the geometry — pushing fires insert_at, which syncs to React.
      mvc.push(e.latLng);
    });
    return () => listener.remove();
  }, [map]);

  // The crosshair is only the right affordance while points are being placed.
  useEffect(() => {
    if (!map) return;
    map.setOptions({ draggableCursor: drawing ? "crosshair" : "" });
  }, [map, drawing]);

  // Frame a newly resolved address, once the map is actually ready for it.
  const fitKey = fitRequest?.key ?? null;
  useEffect(() => {
    if (!map || !fitKey) return;
    const box = latest.current.fitRequest?.box;
    if (!box) return;
    // Zero padding: the box already carries the margin that coverViewFor() worked out, and
    // fitBounds padding would add a second, unmeasured one on top of it.
    map.fitBounds(
      new google.maps.LatLngBounds(
        new google.maps.LatLng(box.south, box.west),
        new google.maps.LatLng(box.north, box.east)
      ),
      0
    );
  }, [map, fitKey]);

  useImperativeHandle(
    ref,
    (): CoverMapCommands => ({
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
      undoPoint: () => {
        const path = polygonRef.current?.getPath();
        if (path && path.getLength() > 0) path.removeAt(path.getLength() - 1);
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
      if (!latest.current.drawing) return;
      if (e.key === "Backspace" || (e.key === "z" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        const path = polygonRef.current?.getPath();
        if (path && path.getLength() > 0) path.removeAt(path.getLength() - 1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [map]);

  return (
    // The map is shown at the OUTPUT's aspect ratio, which is what makes this tool
    // what-you-see-is-what-you-get: the operator frames a 600x442 rectangle and the export
    // renders that rectangle. A differently-shaped map would mean the PNG never quite matches
    // what was on screen.
    // Shown at the OUTPUT's size, not just its aspect — which makes this tool
    // what-you-see-is-what-you-get twice over: the operator frames the cover photo at 1:1, and
    // the default frame fits inside the imagery ceiling.
    //
    // ⚠️ The width cap is load-bearing, not styling. The map's width decides the zoom the
    // default frame fits at: wider map, same 78 m of ground, deeper zoom. Past 20.5 Maps JS
    // starts requesting zoom-21 tiles, which often do not exist over Australia — the grey map
    // that only fills in when you zoom. 760px is the widest that keeps a 78 m frame under 20.5
    // at EVERY Australian latitude; Cairns is the binding case at 772px, Hobart would allow
    // 1008px. Widen this past 772 and northern QLD jobs start coming up grey.
    <div
      className="relative w-full max-w-[760px] overflow-hidden rounded-xl border border-ad-border bg-ad-surface"
      style={{ aspectRatio: String(COVER_ASPECT) }}
    >
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
      {drawing && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-ad-ink/85 px-3 py-2 text-xs text-white">
          Click to place points around the property. Drag a point to move it, right-click one to
          delete it, Backspace to undo.
        </div>
      )}
    </div>
  );
}
