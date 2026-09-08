import type { LatLng } from "@/lib/kml/types";

/**
 * The numbered marker drawn on a layer.
 *
 * A google.maps.OverlayView for the same reasons as measure-label.ts: its div lives inside
 * the map's own transformed pane, so it moves with the imagery for free during a pan and
 * draw() only runs when the projection actually changes. A React layer positioned from
 * map.getProjection() would visibly skate behind the tiles during Google's inertial pan.
 *
 * Two silhouettes, and the difference carries meaning: a detected LOT gets the teardrop the
 * old SVG overlay drew (so an operator who has been using this tool sees the marker they
 * always have), and a hand-drawn SHAPE gets a circle in its own colour. Shape plus colour is
 * what tells the two families apart at a glance — which matters because their numbers are
 * independent series, so a "2" teardrop and a "2" circle can be on screen together.
 *
 * The circle also matches the badges the Measure tab bakes into its exported PNG.
 */

export type BadgeShape = "teardrop" | "circle";

export interface MapBadge {
  setLabel: (label: string) => void;
  setPosition: (p: LatLng | null) => void;
  destroy: () => void;
}

type BadgeCtor = new (shape: BadgeShape, color: string) => google.maps.OverlayView & MapBadge;

let Cached: BadgeCtor | null = null;

/** The teardrop, 26x34, tip at (13, 33). */
const TEARDROP_PATH = "M13 33C13 33 24.5 19 24.5 13A11.5 11.5 0 1 0 1.5 13C1.5 19 13 33 13 33Z";
const CIRCLE_R = 12;

/** google.maps.OverlayView doesn't exist until the API script has run, so the subclass cannot
 *  be declared at module scope — `class X extends google.maps.OverlayView` throws at import
 *  time. Built lazily on first use and cached for the life of the page. */
function badgeCtor(): BadgeCtor {
  if (Cached) return Cached;

  class Badge extends google.maps.OverlayView implements MapBadge {
    private readonly root = document.createElement("div");
    private readonly text: SVGTextElement;
    private position: LatLng | null = null;
    private readonly shape: BadgeShape;

    constructor(shape: BadgeShape, color: string) {
      super();
      this.shape = shape;
      const teardrop = shape === "teardrop";
      const w = teardrop ? 26 : CIRCLE_R * 2 + 4;
      const h = teardrop ? 34 : CIRCLE_R * 2 + 4;
      Object.assign(this.root.style, {
        position: "absolute",
        left: "0px",
        top: "0px",
        // Never a click target: a click landing on a badge must still reach the map beneath
        // and place a shape point.
        pointerEvents: "none",
        display: "none",
        width: `${w}px`,
        height: `${h}px`,
      });
      // Inline SVG so the teardrop keeps the exact geometry the old overlay used, and so the
      // number sits inside the head rather than beside it.
      const body = teardrop
        ? `<path d="${TEARDROP_PATH}" fill="${color}" stroke="#ffffff" stroke-width="2" />`
        : `<circle cx="${w / 2}" cy="${h / 2}" r="${CIRCLE_R}" fill="${color}" fill-opacity="0.92" stroke="#ffffff" stroke-width="2" />`;
      const [tx, ty] = teardrop ? [13, 13] : [w / 2, h / 2];
      this.root.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.45))">
        ${body}
        <text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="central"
              font-family="Inter, ui-sans-serif, system-ui, sans-serif"
              font-size="12" font-weight="700" fill="#ffffff"></text>
      </svg>`;
      this.text = this.root.querySelector("text")!;
    }

    onAdd() {
      // floatPane, not overlayLayer: overlayLayer is where Google draws the Polygons, so a
      // div appended there only paints above the shapes that ALREADY existed — the next lot
      // drawn would cover this badge.
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
      this.root.style.display = "block";
      // A teardrop's TIP sits on the point, so it is offset by its full height; a circle is
      // centred on it. transform rather than left/top keeps this on the compositor.
      const anchor = this.shape === "teardrop" ? "translate(-50%,-100%)" : "translate(-50%,-50%)";
      this.root.style.transform = `${anchor} translate(${Math.round(px.x)}px,${Math.round(px.y)}px)`;
    }

    setLabel(label: string) {
      this.text.textContent = label;
    }

    setPosition(p: LatLng | null) {
      this.position = p;
      // Google only calls draw() when ITS projection changes. Moving the badge because the
      // lot moved is our business, so we trigger it ourselves.
      if (this.getProjection()) this.draw();
    }

    destroy() {
      this.setMap(null);
    }
  }

  Cached = Badge as unknown as BadgeCtor;
  return Cached;
}

/** `color` is a full CSS colour including the '#'. */
export function createMapBadge(map: google.maps.Map, shape: BadgeShape, color: string): MapBadge {
  const badge = new (badgeCtor())(shape, color);
  badge.setMap(map);
  return badge;
}
