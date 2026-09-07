"use client";

import { cn } from "@/lib/utils";
import { StepperRow } from "@/components/ui/stepper-row";
import {
  MIN_POINTS,
  formatArea,
  formatLength,
  measureShape,
  ringSelfIntersects,
  type ShapeMode,
} from "@/lib/kml/standard-markup/measure";
import type { MapCommands } from "./measure-map";
import {
  MAX_MEASUREMENTS,
  MAX_POINTS,
  MAX_WIDTH_M,
  MIN_WIDTH_M,
  WIDTH_STEP_M,
  type MeasureState,
  type Measurement,
} from "./measure-shapes";

const MODES: { key: ShapeMode; label: string; hint: string }[] = [
  { key: "line", label: "Line", hint: "A ribbon centred on the points, half the width either side — a frontage, kerb or footpath." },
  { key: "area", label: "Area", hint: "The points are the boundary itself; whatever they enclose is the area — a yard, reserve or building footprint." },
];

/** The same silhouettes the mode toggle uses, so a row shows you the shape it is rather
 *  than only naming it. */
function ModeGlyph({ mode, className }: { mode: ShapeMode; className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 22 22" className={className} aria-hidden>
      {mode === "area" ? (
        <polygon
          points="3,5 19,3 19.5,17 5,19.5"
          fill="currentColor"
          fillOpacity={0.45}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M3 17 L9.5 8 L19 5"
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

/** Trailing zeroes look like false precision on a width you set with a slider. */
function widthLabel(m: number): string {
  return Number.isInteger(m) ? `${m}m` : `${m.toFixed(1)}m`;
}

function Row({
  m,
  index,
  state,
  commands,
}: {
  m: Measurement;
  index: number;
  state: MeasureState;
  commands: React.RefObject<MapCommands | null>;
}) {
  const isActive = m.id === state.activeId;
  const short = m.points.length < MIN_POINTS[m.mode];
  const bowtie = m.mode === "area" && !short && ringSelfIntersects(m.points);
  // Recomputed on every render, so it tracks a vertex drag live rather than waiting for
  // anything to regenerate.
  const measured = measureShape(m);

  return (
    <li className={cn("rounded-lg border", isActive ? "border-ad-steel bg-ad-steel/5" : "border-ad-border bg-white")}>
      <div className="flex items-center gap-2 p-2">
        {/* Selecting is what routes map clicks to this measurement. Clicking the selected
            row deselects, so the next click starts a new one. */}
        <button
          type="button"
          onClick={() => state.select(isActive ? null : m.id)}
          aria-pressed={isActive}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-semibold tabular-nums",
              isActive ? "bg-ad-orange text-white" : "bg-ad-surface text-ad-muted"
            )}
          >
            {index}
          </span>
          <ModeGlyph mode={m.mode} className={isActive ? "text-ad-orange" : "text-ad-muted"} />
          <span className="min-w-0 flex-1">
            {bowtie ? (
              <span className="block text-xs font-medium text-ad-orange">Crosses itself</span>
            ) : (
              <span className="block truncate text-sm font-semibold text-ad-ink tabular-nums">
                {short ? "—" : formatArea(measured.areaSqm)}
              </span>
            )}
            <span className="block truncate text-[0.7rem] text-ad-muted">
              {m.mode === "line" && measured.lengthMetres !== null
                ? `${formatLength(measured.lengthMetres)} × ${widthLabel(m.widthMetres)}`
                : `${m.points.length} ${m.points.length === 1 ? "point" : "points"}`}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => state.remove(m.id)}
          aria-label={`Remove measurement ${index}`}
          className="shrink-0 rounded p-1 text-ad-muted hover:bg-ad-border/30 hover:text-ad-orange"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {isActive && (
        <div className="border-t border-ad-steel/20 p-2">
          <div className="flex rounded-lg border border-ad-border bg-white p-0.5">
            {MODES.map((mode) => (
              <button
                key={mode.key}
                type="button"
                onClick={() => state.setMode(m.id, mode.key)}
                title={mode.hint}
                aria-pressed={m.mode === mode.key}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs",
                  m.mode === mode.key ? "bg-ad-steel text-white" : "text-ad-muted hover:text-ad-ink"
                )}
              >
                <ModeGlyph mode={mode.key} />
                {mode.label}
              </button>
            ))}
          </div>

          {m.mode === "line" && (
            <>
              <p className="mt-2 text-xs font-medium text-ad-ink">Width ({widthLabel(m.widthMetres)})</p>
              <StepperRow
                value={m.widthMetres}
                onChange={(n) => state.setWidth(m.id, n)}
                min={MIN_WIDTH_M}
                max={MAX_WIDTH_M}
                step={WIDTH_STEP_M}
                label="width"
              />
            </>
          )}

          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[0.7rem] text-ad-muted tabular-nums">
              {m.points.length}/{MAX_POINTS}
            </span>
            <span className="flex gap-1.5">
              <button
                type="button"
                onClick={() => commands.current?.undoPoint(m.id)}
                disabled={m.points.length === 0}
                className="rounded-md border border-ad-border px-2 py-1 text-xs text-ad-ink hover:bg-ad-border/20 disabled:opacity-40"
              >
                Undo
              </button>
              <button
                type="button"
                onClick={() => commands.current?.clearPoints(m.id)}
                disabled={m.points.length === 0}
                className="rounded-md border border-ad-border px-2 py-1 text-xs text-ad-ink hover:bg-ad-border/20 disabled:opacity-40"
              >
                Clear
              </button>
            </span>
          </div>

          {bowtie && (
            <p className="mt-2 text-[0.7rem] text-ad-orange">
              This outline crosses itself, so the area isn&apos;t meaningful — drag the vertex back.
            </p>
          )}
          {short && (
            <p className="mt-2 text-[0.7rem] text-ad-muted">
              Click the map to add points — {MIN_POINTS[m.mode]} needed.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** Floats over the map rather than sitting beside it, so the imagery keeps the full width
 *  of the page — on a measuring tool the map IS the interface, and a fixed sidebar was
 *  taking a third of it to show numbers that are also drawn on each shape. */
export function MeasurePanel({
  state,
  commands,
}: {
  state: MeasureState;
  commands: React.RefObject<MapCommands | null>;
}) {
  const drawn = state.list.filter((m) => m.points.length >= MIN_POINTS[m.mode]).length;

  return (
    <div className="pointer-events-auto flex max-h-full w-64 flex-col overflow-hidden rounded-xl border border-ad-border bg-white/95 shadow-lg backdrop-blur-sm">
      <div className="border-b border-ad-border px-3 py-2.5">
        <p className="text-[0.7rem] font-medium uppercase tracking-wide text-ad-muted">Total area</p>
        <p className="text-xl font-semibold text-ad-ink tabular-nums">
          {formatArea(state.totalAreaSqm)}
        </p>
        {state.totalLengthMetres > 0 && (
          <p className="text-xs text-ad-muted tabular-nums">
            {formatLength(state.totalLengthMetres)} of line
          </p>
        )}
        {drawn > 1 && (
          // Cheaper than the bug report: two separate scopes is the common case, so the
          // total is a plain sum and does not try to be clever about overlap.
          <p className="mt-1 text-[0.65rem] leading-snug text-ad-muted">
            {drawn} measurements, summed — anything overlapping is counted twice.
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {state.list.length === 0 ? (
          <p className="rounded-lg bg-ad-surface p-3 text-xs leading-relaxed text-ad-muted">
            Click the map to drop points. Drag a point to adjust, drag the faint midpoint to
            insert one, right-click a point to delete it.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {state.list.map((m, i) => (
              <Row key={m.id} m={m} index={i + 1} state={state} commands={commands} />
            ))}
          </ul>
        )}
      </div>

      <div className="flex gap-1.5 border-t border-ad-border p-2">
        <button
          type="button"
          onClick={() => state.add()}
          disabled={state.atMax}
          title={state.atMax ? `Maximum ${MAX_MEASUREMENTS} measurements` : undefined}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-ad-steel px-2 py-1.5 text-xs font-medium text-white hover:bg-ad-steel/90 disabled:bg-ad-border disabled:text-ad-muted"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden>
            <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          New
        </button>
        <button
          type="button"
          onClick={state.reset}
          disabled={state.list.length === 0}
          className="rounded-lg border border-ad-border px-2 py-1.5 text-xs text-ad-ink hover:bg-ad-border/20 disabled:opacity-40"
        >
          Clear all
        </button>
      </div>
    </div>
  );
}
