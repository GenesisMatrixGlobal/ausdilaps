// Draggable vertex and midpoint handles for an editable overlay.
//
// WHY THIS EXISTS: Google's own `editable: true` handles are ~5px and there is no supported way
// to resize them. PolygonOptions and PolylineOptions are exactly `clickable, draggable,
// editable, fill*, geodesic, map, paths, stroke*, visible, zIndex` — `editable` is a bare
// boolean, and the handle geometry is inline-styled on obfuscated elements, so a CSS override
// would fight Google's own drag maths (it computes handle position from the same box it draws)
// and could break vertex editing outright on a channel roll. Operators couldn't hit them.
//
// THE ONE-WAY RULE IS UNTOUCHED. A handle writes straight into the overlay's MVCArray
// (setAt/insertAt/removeAt); the host's existing set_at/insert_at/remove_at listeners fire
// exactly as before and syncFromOverlay() mirrors into React. This swaps the input device, not
// the state model — so nothing here knows React exists.
//
// THE COST: Google's midpoint "ghost" handles are part of the same `editable` UI and cannot be
// kept once it is off, so they are rebuilt here.

import type { LatLng } from "@/lib/kml/types";

/** Vertex handle radius, in px. Google's is ~5 and that is the whole complaint; a
 *  google.maps.Marker's hit area is its icon, so this is the grab target too. */
const VERTEX_SCALE = 8;
/** Midpoints read as "not yet a point": smaller and translucent, the same language Google
 *  used for its ghosts. */
const MIDPOINT_SCALE = 5.5;
const MIDPOINT_OPACITY = 0.55;

export interface VertexHandles {
  /** Rebuild from the overlay's current path. Cheap to call; a no-op mid-drag. */
  refresh: () => void;
  destroy: () => void;
}

/** Midpoint of a segment. Planar is right here: these are metres apart on a plan-view map, so
 *  a great-circle midpoint would differ by far less than a pixel. */
function midpoint(a: LatLng, b: LatLng): LatLng {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}

/**
 * Attaches handles to one overlay's path.
 *
 * `closed` adds a handle on the closing edge — an area's outline is a ring, a line's is not.
 * `minPoints` stops a click deleting the vertex that makes the shape measurable.
 */
export function createVertexHandles(
  map: google.maps.Map,
  overlay: google.maps.Polygon | google.maps.Polyline,
  options: { color: string; closed: boolean; minPoints: number; maxPoints: number }
): VertexHandles {
  const path = overlay.getPath();
  let markers: google.maps.Marker[] = [];
  let listeners: google.maps.MapsEventListener[] = [];
  // A handle is derived from the path, and a drag changes the path on every frame — so a
  // rebuild triggered by that change would destroy the marker under the operator's finger
  // mid-gesture. Deferred until dragend. Same class of failure as the stale-frame problem the
  // one-way rule exists to prevent, and the easiest thing here to get wrong.
  let dragging = false;
  let destroyed = false;

  function icon(scale: number, opacity: number): google.maps.Symbol {
    return {
      // A symbol, not an image: `scale` is then the one number that sets both the drawn size
      // and the hit area. AdvancedMarkerElement would give richer DOM but needs a mapId, which
      // switches the map to vector rendering, discards the `styles` and breaks the
      // OverlayView badges — so google.maps.Marker (deprecated but supported, and fine on a
      // raster map) is the only option that fits.
      path: google.maps.SymbolPath.CIRCLE,
      scale,
      fillColor: "#ffffff",
      fillOpacity: opacity,
      strokeColor: options.color,
      strokeWeight: 2.5,
    };
  }

  function clear() {
    for (const l of listeners) l.remove();
    listeners = [];
    for (const m of markers) m.setMap(null);
    markers = [];
  }

  function build() {
    clear();
    const points = path.getArray().map((ll) => ({ lat: ll.lat(), lng: ll.lng() }));

    points.forEach((p, i) => {
      const marker = new google.maps.Marker({
        map,
        position: p,
        draggable: true,
        crossOnDrag: false,
        icon: icon(VERTEX_SCALE, 1),
        // Above every polygon and every midpoint, so a vertex is always the thing you grab.
        zIndex: 60,
        cursor: "grab",
      });
      markers.push(marker);
      listeners.push(
        marker.addListener("dragstart", () => {
          dragging = true;
        }),
        // Live, not on dragend: the outline has to track the finger, which is what setAt
        // through the MVCArray gives for free.
        marker.addListener("drag", (e: google.maps.MapMouseEvent) => {
          if (e.latLng) path.setAt(i, e.latLng);
        }),
        marker.addListener("dragend", () => {
          dragging = false;
          refresh();
        }),
        // Click to delete — Google's handle UI had no delete gesture at all, which is why the
        // host also carries a right-click handler nobody discovers.
        marker.addListener("click", () => {
          if (path.getLength() <= options.minPoints) return;
          path.removeAt(i);
        })
      );
    });

    // One midpoint per segment. `closed` includes the wrap-around edge.
    if (points.length >= 2 && path.getLength() < options.maxPoints) {
      const segments = options.closed ? points.length : points.length - 1;
      for (let i = 0; i < segments; i++) {
        const from = points[i];
        const to = points[(i + 1) % points.length];
        const marker = new google.maps.Marker({
          map,
          position: midpoint(from, to),
          draggable: true,
          crossOnDrag: false,
          icon: icon(MIDPOINT_SCALE, MIDPOINT_OPACITY),
          zIndex: 50,
          cursor: "copy",
        });
        markers.push(marker);
        // The index the new vertex will take. Captured now; the insert happens on dragstart.
        const insertAt = i + 1;
        let inserted = false;
        listeners.push(
          marker.addListener("dragstart", (e: google.maps.MapMouseEvent) => {
            dragging = true;
            // Becomes a real vertex the moment the drag starts, so it tracks the finger from
            // the first frame — which is how Google's ghosts behaved.
            if (e.latLng && path.getLength() < options.maxPoints) {
              path.insertAt(insertAt, e.latLng);
              inserted = true;
            }
          }),
          marker.addListener("drag", (e: google.maps.MapMouseEvent) => {
            if (inserted && e.latLng) path.setAt(insertAt, e.latLng);
          }),
          marker.addListener("dragend", () => {
            dragging = false;
            inserted = false;
            refresh();
          })
        );
      }
    }
  }

  function refresh() {
    if (destroyed || dragging) return;
    build();
  }

  build();

  return {
    refresh,
    destroy: () => {
      destroyed = true;
      clear();
    },
  };
}
