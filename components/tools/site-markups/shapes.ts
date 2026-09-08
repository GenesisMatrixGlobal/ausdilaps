"use client";

import { useCallback, useRef, useState } from "react";
import type { LatLng } from "@/lib/kml/types";
import type { Measurable, ShapeMode } from "@/lib/kml/standard-markup/measure";
// Imported as well as re-exported: `export ... from` re-exports without binding the name
// locally, and payload() below reads MIN_POINTS.
import { MIN_POINTS } from "@/lib/kml/standard-markup/measure";

// The measurement maths moved to lib/kml/standard-markup/measure.ts so the Measure tab can
// share it — two tools must never quote different square metres for the same outline.
// Re-exported from here so every existing importer (shape-panel, markup-canvas,
// residential-tab) is untouched.
export {
  MIN_POINTS,
  measureShape,
  ringFor,
  formatArea,
  formatLength,
} from "@/lib/kml/standard-markup/measure";
export type { ShapeMode, ShapeMeasurement, Measurable } from "@/lib/kml/standard-markup/measure";

export const MAX_SHAPE_POINTS = 20;
export const MAX_SHAPES = 5;
export const DEFAULT_SHAPE_WIDTH_M = 10;
export const MIN_SHAPE_WIDTH_M = 5;
export const MAX_SHAPE_WIDTH_M = 30;
export const SHAPE_WIDTH_STEP_M = 1;

/** Not a free colour choice — each value maps the shape onto one of the exported legend's
 *  existing rows: orange = Council / External Assets, blue = Neighbouring Assets, red =
 *  Project Site. That keeps the legend at three fixed rows however many shapes are drawn,
 *  and red is what you redraw the project site with after unticking the detected one. */
export type ShapeColor = "orange" | "blue" | "red";

/** The wire shape — what /api/kml/standard-markup/render expects. */
export interface MarkupShape extends Measurable {
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
  /** Replaces a shape's whole path. THE mirror write for the live map: every geometry
   *  mutation happens in Google's own MVCArray and is copied here afterwards, so React never
   *  pushes geometry back at the overlay. See markup-map.tsx for why the reverse direction
   *  cannot work.
   *
   *  This replaced movePoint (one vertex, by index) and translateShape (a whole-shape drag).
   *  Neither survives a pannable map: Google owns vertex dragging now, and on a map that pans,
   *  "drag the fill" and "pan" are the same gesture on adjacent pixels — while translating a
   *  shape changes neither its area nor its length. */
  setPoints: (id: string, points: LatLng[]) => void;
  addShape: () => void;
  removeShape: (id: string) => void;
  setMode: (id: string, mode: ShapeMode) => void;
  setColor: (id: string, color: ShapeColor) => void;
  setWidth: (id: string, widthMetres: number) => void;
  // No undoPoint/clearPoints here on purpose. They used to write React state directly, which
  // is a trap now that the overlay owns the geometry: the panel's point count would change and
  // the outline on the map would not. Both live on MarkupMapCommands instead.
  reset: () => void;
  /** Swaps the whole list — the Open .json path. A saved id is KEPT when present and
   *  unique, because it is the join key that stops a re-sync duplicating that shape's Quote
   *  Line Item; a missing or duplicate one is regenerated, since a collision would make two
   *  shapes share a React key and toggle as one. */
  replaceAll: (incoming: (MarkupShape & { id?: string })[]) => void;
  /** Only shapes with enough points to render — what goes over the wire. */
  payload: () => MarkupShape[];
  /** Synchronous mirrors, for decisions made inside Google's event handlers. A listener can
   *  fire between renders, so it must not read the state variables — same reasoning as the
   *  comment on shapesRef below. */
  listRef: React.RefObject<ShapeDraft[]>;
  activeIdRef: React.RefObject<string | null>;
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

  const replaceAll = useCallback(
    (incoming: (MarkupShape & { id?: string })[]) => {
      const seen = new Set<string>();
      write(() =>
        incoming.slice(0, MAX_SHAPES).map((a) => {
          const id = a.id && !seen.has(a.id) ? a.id : crypto.randomUUID();
          seen.add(id);
          return {
            id,
            points: a.points.slice(0, MAX_SHAPE_POINTS),
            widthMetres: a.widthMetres,
            mode: a.mode,
            color: a.color,
          };
        })
      );
      select(null);
    },
    [write, select]
  );

  const activeShape = shapes.find((a) => a.id === activeShapeId) ?? null;

  return {
    shapes,
    activeShapeId,
    activeShape,
    atMax: shapes.length >= MAX_SHAPES,
    select,
    addPoint,
    setPoints: useCallback(
      (id, points) => update(id, (a) => ({ ...a, points: points.slice(0, MAX_SHAPE_POINTS) })),
      [update]
    ),
    addShape: useCallback(() => create([]), [create]),
    removeShape,
    setMode: useCallback((id, mode) => update(id, (a) => ({ ...a, mode })), [update]),
    setColor: useCallback((id, color) => update(id, (a) => ({ ...a, color })), [update]),
    setWidth: useCallback((id, widthMetres) => update(id, (a) => ({ ...a, widthMetres })), [update]),
    reset,
    replaceAll,
    // Reads the ref, not the state, so a render triggered by the click that opened this
    // request can never make it send the previous tick's geometry.
    //
    // Geometry only, plus the id — the caller attaches the quote item number, because that comes
    // from the sheet's tick state (rowsFrom) which this hook knows nothing about. The id is what
    // shapeKey() needs to look the number up, and it is also the re-sync join key.
    payload: useCallback(
      () =>
        shapesRef.current
          .filter((a) => a.points.length >= MIN_POINTS[a.mode])
          .map(({ id, points, widthMetres, mode, color }) => ({ id, points, widthMetres, mode, color })),
      []
    ),
    listRef: shapesRef,
    activeIdRef,
  };
}
