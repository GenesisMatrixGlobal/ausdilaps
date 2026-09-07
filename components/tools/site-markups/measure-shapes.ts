"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { LatLng } from "@/lib/kml/types";
import {
  MIN_POINTS,
  measureShape,
  type Measurable,
  type ShapeMode,
} from "@/lib/kml/standard-markup/measure";

/** No legend to fit, unlike the Residential tab's five — this is just "more than anyone
 *  measures in one sitting", so the list stays scannable. */
export const MAX_MEASUREMENTS = 12;

/** Deliberately NOT the Residential tab's MAX_SHAPE_POINTS of 20. That cap exists because
 *  its shapes get percent-encoded into a Static Maps URL with a length limit. A Measure
 *  shape is never serialised into a URL, so a long road frontage isn't truncated at 20
 *  clicks. Do not unify the two — one of them would break. */
export const MAX_POINTS = 100;

export const MIN_WIDTH_M = 3;
export const MAX_WIDTH_M = 30;
export const DEFAULT_WIDTH_M = 10;
/** Half-metre steps: the buttons fine-tune a kerb or footpath, the slider covers the range. */
export const WIDTH_STEP_M = 0.5;

export interface Measurement extends Measurable {
  id: string;
}

export interface MeasureState {
  list: Measurement[];
  activeId: string | null;
  activeMeasurement: Measurement | null;
  atMax: boolean;
  /** The mode the next new measurement gets — the last one explicitly chosen, so drawing
   *  five areas in a row doesn't mean five trips to the mode toggle. */
  defaultMode: ShapeMode;
  totalAreaSqm: number;
  totalLengthMetres: number;
  select: (id: string | null) => void;
  /** Returns the id that a click should place a point into, creating and selecting a new
   *  measurement if none is active. Decides from refs and updates them synchronously —
   *  see the note on activeIdRef. Null means the cap is reached. */
  ensureActive: () => string | null;
  /** Appends a point via React state. Only for the window before the map has built this
   *  measurement's overlay; once it exists the overlay's own path is the write target. */
  appendPoint: (id: string, point: LatLng) => void;
  /** The overlay -> React mirror. The map is the only caller. */
  setPoints: (id: string, points: LatLng[]) => void;
  add: (mode?: ShapeMode) => string | null;
  remove: (id: string) => void;
  setMode: (id: string, mode: ShapeMode) => void;
  setWidth: (id: string, widthMetres: number) => void;
  reset: () => void;
  /** Swaps the whole list — the Open .json path. Ids are regenerated rather than trusted
   *  from the file: a duplicate id would collide React keys and the map's handle map. */
  replaceAll: (incoming: Measurable[]) => void;
  /** Live list for anything that has to decide synchronously inside a map event. */
  listRef: { readonly current: Measurement[] };
  activeIdRef: { readonly current: string | null };
}

/**
 * Owns the measurement list for the Measure tab.
 *
 * Forked from useShapes() in shapes.ts rather than shared with it, deliberately: that hook
 * carries a colour axis, a five-shape cap tied to the exported legend, and payload() (the
 * wire format for /api/kml/standard-markup/render) — and decisively, its geometry write
 * path is React state, whereas here Google's own MVCArray owns the geometry and React only
 * mirrors it. Parameterising one hook to cover both would mean a generic plus an injected
 * mutation strategy: more code, and a harder-to-read shapes.ts for the tab that already
 * ships. The measurement MATHS is shared (lib/kml/standard-markup/measure.ts), which is
 * the part where a divergence would actually quote a customer the wrong number.
 */
export function useMeasurements(): MeasureState {
  const [list, setList] = useState<Measurement[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [defaultMode, setDefaultMode] = useState<ShapeMode>("line");

  // Synchronous mirrors of the two state values. Every map handler DECIDES from these,
  // never from the state variables above: React batches state updates, so two clicks
  // landing in the same tick both still observe the pre-click values. On the Residential
  // tab that made three fast clicks start three separate one-point shapes instead of one
  // three-point shape — and a plain double-click hit it too. Google owning the path
  // doesn't help, because the decision of WHICH shape to write into is still made here.
  const listRef = useRef<Measurement[]>([]);
  const activeIdRef = useRef<string | null>(null);

  const select = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveIdState(id);
  }, []);

  /** The single write path — keeps listRef in step with the state in the same tick. */
  const write = useCallback((fn: (prev: Measurement[]) => Measurement[]) => {
    const next = fn(listRef.current);
    listRef.current = next;
    setList(next);
  }, []);

  const update = useCallback(
    (id: string, fn: (m: Measurement) => Measurement) =>
      write((prev) => prev.map((m) => (m.id === id ? fn(m) : m))),
    [write]
  );

  const add = useCallback(
    (mode?: ShapeMode): string | null => {
      if (listRef.current.length >= MAX_MEASUREMENTS) return null;
      const created: Measurement = {
        id: crypto.randomUUID(),
        points: [],
        widthMetres: DEFAULT_WIDTH_M,
        mode: mode ?? defaultMode,
      };
      write((prev) => [...prev, created]);
      select(created.id);
      return created.id;
    },
    [defaultMode, select, write]
  );

  const ensureActive = useCallback((): string | null => {
    return activeIdRef.current ?? add();
  }, [add]);

  const appendPoint = useCallback(
    (id: string, point: LatLng) =>
      update(id, (m) =>
        m.points.length >= MAX_POINTS ? m : { ...m, points: [...m.points, point] }
      ),
    [update]
  );

  const setPoints = useCallback(
    (id: string, points: LatLng[]) => update(id, (m) => ({ ...m, points })),
    [update]
  );

  const remove = useCallback(
    (id: string) => {
      write((prev) => prev.filter((m) => m.id !== id));
      if (activeIdRef.current === id) select(null);
    },
    [select, write]
  );

  const reset = useCallback(() => {
    write(() => []);
    select(null);
  }, [select, write]);

  const replaceAll = useCallback(
    (incoming: Measurable[]) => {
      write(() =>
        incoming.slice(0, MAX_MEASUREMENTS).map((m) => ({
          id: crypto.randomUUID(),
          mode: m.mode,
          widthMetres: m.widthMetres,
          points: m.points.slice(0, MAX_POINTS),
        }))
      );
      // Nothing selected, so the first map click starts a NEW measurement rather than
      // silently extending whichever one happened to be first in the file.
      select(null);
    },
    [select, write]
  );

  const setMode = useCallback(
    (id: string, mode: ShapeMode) => {
      setDefaultMode(mode);
      update(id, (m) => ({ ...m, mode }));
    },
    [update]
  );

  const activeMeasurement = list.find((m) => m.id === activeId) ?? null;

  // Only measurements with enough points to mean anything. Overlapping ones are summed
  // twice — the panel says so, because two separate scopes is the common case and
  // silently de-duplicating would be the surprising behaviour.
  const totals = useMemo(() => {
    let areaSqm = 0;
    let lengthMetres = 0;
    for (const m of list) {
      if (m.points.length < MIN_POINTS[m.mode]) continue;
      const measured = measureShape(m);
      areaSqm += measured.areaSqm;
      lengthMetres += measured.lengthMetres ?? 0;
    }
    return { areaSqm, lengthMetres };
  }, [list]);

  return {
    list,
    activeId,
    activeMeasurement,
    atMax: list.length >= MAX_MEASUREMENTS,
    defaultMode,
    totalAreaSqm: totals.areaSqm,
    totalLengthMetres: totals.lengthMetres,
    select,
    ensureActive,
    appendPoint,
    setPoints,
    add,
    remove,
    setMode,
    setWidth: useCallback(
      (id, widthMetres) => update(id, (m) => ({ ...m, widthMetres })),
      [update]
    ),
    reset,
    replaceAll,
    listRef,
    activeIdRef,
  };
}
