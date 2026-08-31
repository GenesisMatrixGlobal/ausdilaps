"use client";

import { useCallback, useRef, useState } from "react";
import type { LatLng } from "@/lib/kml/types";

export const MAX_SHAPE_POINTS = 20;
export const MAX_SHAPES = 5;
export const DEFAULT_SHAPE_WIDTH_M = 10;
export const MIN_SHAPE_WIDTH_M = 5;
export const MAX_SHAPE_WIDTH_M = 30;
export const SHAPE_WIDTH_STEP_M = 1;

/** A line needs two points to have a direction to buffer perpendicular to; an area needs
 *  three to enclose anything. Below that the shape renders as nothing, so it's dropped
 *  from the payload rather than sent for the server to discard. */
export const MIN_POINTS: Record<ShapeMode, number> = { line: 2, area: 3 };

export type ShapeMode = "line" | "area";

/** Not a free colour choice — each value maps the shape onto one of the exported legend's
 *  existing rows: orange = Council / External Assets, blue = Neighbouring Assets, red =
 *  Project Site. That keeps the legend at three fixed rows however many shapes are drawn,
 *  and red is what you redraw the project site with after unticking the detected one. */
export type ShapeColor = "orange" | "blue" | "red";

/** The wire shape — what /api/kml/standard-markup/render expects. */
export interface MarkupShape {
  points: LatLng[];
  widthMetres: number;
  mode: ShapeMode;
  color: ShapeColor;
}

export interface ShapeDraft extends MarkupShape {
  id: string;
}

export interface ShapesState {
  shapes: ShapeDraft[];
  activeShapeId: string | null;
  activeShape: ShapeDraft | null;
  /** True once the cap is hit — the panel disables "Add shape" and explains why. */
  atMax: boolean;
  select: (id: string | null) => void;
  /** Appends a point to the active shape, or starts a brand-new shape if none is active. */
  addPoint: (point: LatLng) => void;
  movePoint: (id: string, index: number, point: LatLng) => void;
  /** Shifts every point of a shape by a lat/lng delta — the whole-shape drag. */
  translateShape: (id: string, dLat: number, dLng: number) => void;
  addShape: () => void;
  removeShape: (id: string) => void;
  setMode: (id: string, mode: ShapeMode) => void;
  setColor: (id: string, color: ShapeColor) => void;
  setWidth: (id: string, widthMetres: number) => void;
  undoPoint: (id: string) => void;
  clearPoints: (id: string) => void;
  reset: () => void;
  /** Only shapes with enough points to render — what goes over the wire. */
  payload: () => MarkupShape[];
}

function newShape(points: LatLng[] = []): ShapeDraft {
  return {
    id: crypto.randomUUID(),
    points,
    widthMetres: DEFAULT_SHAPE_WIDTH_M,
    mode: "line",
    color: "orange",
  };
}

/** Owns the shape list for the Residential tab. Kept out of the tab component because
 *  both the canvas (which places and drags points) and the panel (which edits mode,
 *  width, colour and selection) mutate the same list, and the tab itself only needs
 *  `payload()` when it renders. */
export function useShapes(): ShapesState {
  const [shapes, setShapes] = useState<ShapeDraft[]>([]);
  const [activeShapeId, setActiveShapeIdState] = useState<string | null>(null);

  // Synchronous mirrors of the two state values. Every event handler DECIDES from these,
  // never from the state variables above: React batches state updates, so two clicks
  // landing in the same tick both still observe the pre-click values. That made three
  // fast clicks on the image start three separate one-point shapes instead of one
  // three-point shape — and a plain double-click hit it too.
  const shapesRef = useRef<ShapeDraft[]>([]);
  const activeIdRef = useRef<string | null>(null);

  const select = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveShapeIdState(id);
  }, []);

  /** The single write path — keeps `shapesRef` in step with the state in the same tick. */
  const write = useCallback((fn: (prev: ShapeDraft[]) => ShapeDraft[]) => {
    const next = fn(shapesRef.current);
    shapesRef.current = next;
    setShapes(next);
  }, []);

  const update = useCallback(
    (id: string, fn: (a: ShapeDraft) => ShapeDraft) =>
      write((prev) => prev.map((a) => (a.id === id ? fn(a) : a))),
    [write]
  );

  const create = useCallback(
    (points: LatLng[]) => {
      if (shapesRef.current.length >= MAX_SHAPES) return;
      const created = newShape(points);
      write((prev) => [...prev, created]);
      select(created.id);
    },
    [write, select]
  );

  // Clicking the image always does something sensible — no separate "start placing"
  // toggle. Nothing selected -> this click starts a brand-new shape. One selected -> the
  // click extends it. Deselecting (clicking the selected row's header) is what lets a
  // property carry several unrelated shapes, e.g. a road frontage + an adjacent building.
  const addPoint = useCallback(
    (point: LatLng) => {
      const activeId = activeIdRef.current;
      if (!activeId) {
        create([point]);
        return;
      }
      write((prev) =>
        prev.map((a) =>
          a.id === activeId && a.points.length < MAX_SHAPE_POINTS
            ? { ...a, points: [...a.points, point] }
            : a
        )
      );
    },
    [create, write]
  );

  const removeShape = useCallback(
    (id: string) => {
      write((prev) => prev.filter((a) => a.id !== id));
      if (activeIdRef.current === id) select(null);
    },
    [write, select]
  );

  const reset = useCallback(() => {
    write(() => []);
    select(null);
  }, [write, select]);

  const activeShape = shapes.find((a) => a.id === activeShapeId) ?? null;

  return {
    shapes,
    activeShapeId,
    activeShape,
    atMax: shapes.length >= MAX_SHAPES,
    select,
    addPoint,
    movePoint: useCallback(
      (id, index, point) =>
        update(id, (a) => ({ ...a, points: a.points.map((p, i) => (i === index ? point : p)) })),
      [update]
    ),
    translateShape: useCallback(
      (id, dLat, dLng) =>
        update(id, (a) => ({
          ...a,
          points: a.points.map((p) => ({ lat: p.lat + dLat, lng: p.lng + dLng })),
        })),
      [update]
    ),
    addShape: useCallback(() => create([]), [create]),
    removeShape,
    setMode: useCallback((id, mode) => update(id, (a) => ({ ...a, mode })), [update]),
    setColor: useCallback((id, color) => update(id, (a) => ({ ...a, color })), [update]),
    setWidth: useCallback((id, widthMetres) => update(id, (a) => ({ ...a, widthMetres })), [update]),
    undoPoint: useCallback((id) => update(id, (a) => ({ ...a, points: a.points.slice(0, -1) })), [update]),
    clearPoints: useCallback((id) => update(id, (a) => ({ ...a, points: [] })), [update]),
    reset,
    // Reads the ref, not the state, so a render triggered by the click that opened this
    // request can never make it send the previous tick's geometry.
    payload: useCallback(
      () =>
        shapesRef.current
          .filter((a) => a.points.length >= MIN_POINTS[a.mode])
          .map(({ points, widthMetres, mode, color }) => ({ points, widthMetres, mode, color })),
      []
    ),
  };
}
