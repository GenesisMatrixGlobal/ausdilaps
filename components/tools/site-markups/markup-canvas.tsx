"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import type { LatLng } from "@/lib/kml/types";
import { bufferLineToPolygon, centroidOf, closeRing } from "@/lib/kml/standard-markup/geometry";
import { latLngToPixel, pixelToLatLng } from "@/lib/kml/standard-markup/projection";
import {
  FILL_OPACITY_PERCENT,
  OUTLINE_WEIGHT,
  SHAPE_COLORS,
  STROKE_OPACITY_PERCENT,
} from "@/lib/kml/standard-markup/style";
import type { ShapeDraft, ShapesState } from "./shapes";
import { MIN_POINTS } from "./shapes";

// Straight from the shared style module the server renderer uses, so the on-screen shape
// cannot drift from the one Static Maps draws. Opacities are percentages there; SVG wants
// 0-1. Colours are stored without a '#', which Static Maps wants and SVG doesn't.
const FILL_OPACITY = FILL_OPACITY_PERCENT / 100;
const STROKE_OPACITY = STROKE_OPACITY_PERCENT / 100;

export interface Projection {
  center: LatLng;
  zoom: number;
  imageSizePx: number;
  scale: number;
}

type Drag =
  | { kind: "point"; shapeId: string; index: number }
  | { kind: "shape"; shapeId: string; lastPoint: LatLng }
  | null;

/** The ring an shape will actually render as — computed with the SAME functions the
 *  server renderer uses, so the preview can't drift from the exported PNG (same width
 *  buffer, same mitre joins, same closing rule). Empty until it has enough points. */
function ringFor(shape: ShapeDraft): LatLng[] {
  if (shape.points.length < MIN_POINTS[shape.mode]) return [];
  return shape.mode === "area"
    ? closeRing(shape.points)
    : bufferLineToPolygon(shape.points, shape.widthMetres);
}

export function MarkupCanvas({
  imageDataUrl,
  alt,
  projection,
  shapes,
  pickMode = false,
  onPick,
  onCancelPick,
  lots = [],
}: {
  imageDataUrl: string;
  alt: string;
  projection: Projection | null;
  shapes: ShapesState;
  /** While true the map is armed for "Detect lot boundary": a click reports a coordinate
   *  instead of placing a shape point, and the whole overlay stops taking pointer events
   *  so a click landing on an existing shape can't be swallowed by its drag handler. */
  pickMode?: boolean;
  onPick?: (point: LatLng) => void;
  onCancelPick?: () => void;
  /** The numbered lot bubbles. Drawn here rather than baked into the map image so they
   *  layer ABOVE any custom shape — a translucent area shape used to tint them, because
   *  this overlay always sits on top of the image. Drawing them here also makes them
   *  live: a lot added by clicking gets its bubble without waiting for a re-render. */
  lots?: { id: string; ring: LatLng[]; label: string }[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // A ref, not state: nothing in the render output reads it (the cursor styling keys off
  // selection, not drag), and a pointerdown must be visible to the very next pointermove
  // even when React hasn't re-rendered in between. It also saves a re-render per move.
  const dragRef = useRef<Drag>(null);

  /** Pointer position as a real coordinate. Uses the container's box rather than the
   *  image's so it still resolves correctly mid-drag, when the pointer may have been
   *  captured by a dot and left the image entirely. */
  function toLatLng(e: { clientX: number; clientY: number }): LatLng | null {
    const el = containerRef.current;
    if (!el || !projection) return null;
    const rect = el.getBoundingClientRect();
    return pixelToLatLng(projection, {
      x: ((e.clientX - rect.left) / rect.width) * projection.imageSizePx,
      y: ((e.clientY - rect.top) / rect.height) * projection.imageSizePx,
    });
  }

  function handleImageClick(e: ReactPointerEvent<HTMLImageElement>) {
    const point = toLatLng(e);
    if (!point) return;
    if (pickMode) {
      onPick?.(point);
      return;
    }
    shapes.addPoint(point);
  }

  function begin(e: ReactPointerEvent, next: Drag) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = next;
  }

  function onPointerMove(e: ReactPointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const now = toLatLng(e);
    if (!now) return;
    if (drag.kind === "point") {
      // Absolute, not accumulated — the point simply goes where the pointer is, so a
      // fast drag can't drift away from the cursor.
      shapes.movePoint(drag.shapeId, drag.index, now);
      return;
    }
    // Delta from the last frame, so the grab point stays under the cursor wherever on
    // the shape the drag started.
    shapes.translateShape(drag.shapeId, now.lat - drag.lastPoint.lat, now.lng - drag.lastPoint.lng);
    dragRef.current = { ...drag, lastPoint: now };
  }

  function endDrag() {
    dragRef.current = null;
  }

  // Esc backs out of an armed pick. Mounted only while armed, so it can never swallow
  // an Esc meant for something else.
  useEffect(() => {
    if (!pickMode || !onCancelPick) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancelPick!();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickMode, onCancelPick]);

  const size = projection?.imageSizePx ?? 0;

  return (
    <div
      ref={containerRef}
      className="relative max-w-4xl touch-none overflow-hidden rounded-xl border border-ad-border select-none"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageDataUrl} alt={alt} onClick={handleImageClick} className={cn("block w-full", pickMode ? "cursor-copy" : "cursor-crosshair")} />

      {/* The instruction belongs where the click has to happen, not in the sidebar the
          operator has already looked away from. Only exists while armed, so it costs
          nothing the rest of the time. */}
      {pickMode && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-3 bg-ad-ink/85 px-3 py-2 text-xs text-white">
          <span>Click a lot to add it</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCancelPick?.();
            }}
            className="pointer-events-auto rounded border border-white/40 px-2 py-0.5 font-medium hover:bg-white/15"
          >
            Cancel <span className="text-white/60">Esc</span>
          </button>
        </div>
      )}

      {projection && (
        <>
          {/* pointer-events:none on the root so clicks fall through to the image; only the
              selected shape's own shape opts back in as a drag handle. */}
          <svg
            viewBox={`0 0 ${size} ${size}`}
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-hidden
          >
            {shapes.shapes.map((shape) => {
              const ring = ringFor(shape);
              if (ring.length < 3) return null;
              const points = ring
                .map((p) => {
                  const px = latLngToPixel(projection, p);
                  return `${px.x},${px.y}`;
                })
                .join(" ");
              const isActive = shape.id === shapes.activeShapeId;
              return (
                <polygon
                  key={shape.id}
                  points={points}
                  fill={`#${SHAPE_COLORS[shape.color]}`}
                  fillOpacity={FILL_OPACITY}
                  stroke={`#${SHAPE_COLORS[shape.color]}`}
                  strokeOpacity={STROKE_OPACITY}
                  strokeWidth={OUTLINE_WEIGHT}
                  className={isActive && !pickMode ? "pointer-events-auto cursor-move" : undefined}
                  onPointerDown={
                    isActive && !pickMode
                      ? (e) => {
                          const now = toLatLng(e);
                          if (now) begin(e, { kind: "shape", shapeId: shape.id, lastPoint: now });
                        }
                      : undefined
                  }
                />
              );
            })}
          </svg>

          {lots.map((lot) => {
            const px = latLngToPixel(projection, centroidOf(lot.ring));
            return (
              <span
                key={lot.id}
                style={{
                  left: `${(px.x / projection.imageSizePx) * 100}%`,
                  top: `${(px.y / projection.imageSizePx) * 100}%`,
                }}
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-full drop-shadow"
              >
                <svg width="26" height="34" viewBox="0 0 26 34" aria-hidden>
                  <path
                    d="M13 33C13 33 24.5 19 24.5 13A11.5 11.5 0 1 0 1.5 13C1.5 19 13 33 13 33Z"
                    fill={`#${SHAPE_COLORS.orange}`}
                    stroke="#ffffff"
                    strokeWidth="2"
                  />
                  <text
                    x="13"
                    y="13"
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize="12"
                    fontWeight="700"
                    fill="#ffffff"
                  >
                    {lot.label}
                  </text>
                </svg>
              </span>
            );
          })}

          {shapes.shapes.map((shape) =>
            shape.points.map((p, i) => {
              const px = latLngToPixel(projection, p);
              const isActive = shape.id === shapes.activeShapeId;
              return (
                <span
                  key={`${shape.id}-${i}`}
                  onPointerDown={
                    isActive && !pickMode ? (e) => begin(e, { kind: "point", shapeId: shape.id, index: i }) : undefined
                  }
                  style={{
                    left: `${(px.x / projection.imageSizePx) * 100}%`,
                    top: `${(px.y / projection.imageSizePx) * 100}%`,
                  }}
                  className={cn(
                    "absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-[10px] font-semibold text-white shadow",
                    isActive && !pickMode
                      ? "pointer-events-auto cursor-grab touch-none active:cursor-grabbing"
                      : "pointer-events-none opacity-50"
                  )}
                >
                  {i + 1}
                </span>
              );
            })
          )}
        </>
      )}
    </div>
  );
}
