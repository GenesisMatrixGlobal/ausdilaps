import type { LatLng } from "@/lib/kml/types";

/**
 * The measurement, drawn on the shape it describes.
 *
 * A google.maps.OverlayView rather than the obvious alternatives:
 *  - AdvancedMarkerElement would need a Cloud Console Map ID and would switch the map to
 *    vector rendering (which also silently discards the `styles` that turn POI pins off).
 *  - google.maps.Marker + MarkerLabel is deprecated, can't do two lines, needs a
 *    transparent icon to suppress the red pin, and anchors to that pin rather than to the
 *    centre of the geometry.
 *  - A React layer positioned from map.getProjection() would have to re-render on every
 *    bounds_changed frame, and during Google's inertial pan and zoom animations
 *    getCenter()/getZoom() are only sampled at event granularity, so the labels visibly
 *    skate behind the imagery.
 *
 * The deciding argument for OverlayView: its div lives INSIDE the map's own transformed
 * pane, so it moves with the imagery for free during a pan and draw() only runs when the
 * projection actually changes.
 *
 * Plain DOM, no React: setContent runs on every path change — up to once a frame while a
 * vertex is being dragged — and routing that through React state would put the label a
 * render behind the shape it is labelling.
 */

export interface MeasureLabel {
  setContent: (area: string, length: string | null, index: number) => void;
  /** null hides it — a shape below MIN_POINTS has no meaningful centroid. */
  setPosition: (p: LatLng | null) => void;
  setActive: (active: boolean) => void;
  destroy: () => void;
}

type LabelCtor = new () => google.maps.OverlayView & MeasureLabel;

let Cached: LabelCtor | null = null;

const IDLE_BG = "rgba(35,39,43,0.82)";
const ACTIVE_BG = "rgba(232,100,42,0.94)";

/** google.maps.OverlayView doesn't exist until the API script has run, so the subclass
 *  cannot be declared at module scope — `class X extends google.maps.OverlayView` throws
 *  at import time. Built lazily on first use and cached for the life of the page. */
function labelCtor(): LabelCtor {
  if (Cached) return Cached;

  class Label extends google.maps.OverlayView {
    private readonly root = document.createElement("div");
    private readonly badge = document.createElement("span");
    private readonly area = document.createElement("span");
    private readonly length = document.createElement("span");
    private position: LatLng | null = null;

    constructor() {
      super();
      Object.assign(this.root.style, {
        position: "absolute",
        left: "0px",
        top: "0px",
        // Never a click target: a click that lands on the label still has to reach the map
        // underneath and place a point. Cheaper and more predictable than
        // OverlayView.preventMapHitsFrom(), which does the opposite of what we want.
        pointerEvents: "none",
        display: "none",
        alignItems: "baseline",
        gap: "6px",
        whiteSpace: "nowrap",
        font: "600 12px/1 Inter, ui-sans-serif, system-ui, sans-serif",
        padding: "5px 8px",
        borderRadius: "6px",
        color: "#fff",
        // Not the brand palette. This sits on aerial imagery of unknown colour and has to
        // stay legible over grass, bitumen and a tin roof — near-black at 82% with a
        // hairline ring is the only thing that always reads.
        background: IDLE_BG,
        boxShadow: "0 0 0 1px rgba(255,255,255,0.35), 0 1px 3px rgba(0,0,0,0.4)",
      });
      Object.assign(this.badge.style, {
        opacity: "0.6",
        fontWeight: "400",
        fontVariantNumeric: "tabular-nums",
      });
      Object.assign(this.length.style, { opacity: "0.78", fontWeight: "400" });
      this.root.append(this.badge, this.area, this.length);
    }

    onAdd() {
      // floatPane, not overlayLayer. overlayLayer is where Google draws the Polygons
      // themselves, so a div appended there only paints above the shapes that ALREADY
      // existed — the next measurement drawn would cover this label. floatPane is above
      // every shape whatever order they were created in, and nothing in this tool uses an
      // InfoWindow, so there's nobody up there to collide with.
      this.getPanes()!.floatPane.appendChild(this.root);
    }

    onRemove() {
      this.root.remove();
    }

    draw() {
      const projection = this.getProjection();
      if (!projection || !this.position) {
        this.root.style.display = "none";
        return;
      }
      const px = projection.fromLatLngToDivPixel(
        new google.maps.LatLng(this.position.lat, this.position.lng)
      );
      if (!px) {
        this.root.style.display = "none";
        return;
      }
      this.root.style.display = "flex";
      // transform rather than left/top: draw() runs on every projection change, and a
      // transform stays on the compositor. Rounded so the text never lands on a half pixel.
      this.root.style.transform =
        `translate(-50%,-50%) translate(${Math.round(px.x)}px,${Math.round(px.y)}px)`;
    }

    setContent(area: string, length: string | null, index: number) {
      this.badge.textContent = String(index);
      this.area.textContent = area;
      this.length.textContent = length ?? "";
    }

    setPosition(p: LatLng | null) {
      this.position = p;
      // Google only calls draw() when ITS projection changes. Moving the label because the
      // shape moved is our business, so we trigger it ourselves.
      if (this.getProjection()) this.draw();
    }

    setActive(active: boolean) {
      this.root.style.background = active ? ACTIVE_BG : IDLE_BG;
      this.root.style.zIndex = active ? "2" : "1";
    }

    destroy() {
      this.setMap(null);
    }
  }

  Cached = Label as unknown as LabelCtor;
  return Cached;
}

export function createMeasureLabel(map: google.maps.Map): MeasureLabel {
  const label = new (labelCtor())();
  label.setMap(map);
  return label;
}
