"use client";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import {
  SHAPE_WIDTH_STEP_M,
  MAX_SHAPES,
  MAX_SHAPE_POINTS,
  MAX_SHAPE_WIDTH_M,
  MIN_SHAPE_WIDTH_M,
  MIN_POINTS,
  type ShapeDraft,
  type ShapeMode,
  type ShapeColor,
  type ShapesState,
  measureShape,
  formatArea,
  formatLength,
} from "./shapes";

const MODES: { key: ShapeMode; label: string; hint: string }[] = [
  { key: "line", label: "Line", hint: "A ribbon centred on the points, half the width either side — a frontage, kerb or footpath." },
  { key: "area", label: "Area", hint: "The points are the boundary itself; whatever they enclose is infilled — a nature strip, reserve or building footprint." },
];

/** Two options, not a colour picker: each maps the shape onto one of the exported
 *  legend's existing rows, so the legend stays three fixed lines. */
const COLORS: { key: ShapeColor; label: string; swatch: string; hint: string }[] = [
  { key: "orange", label: "Orange", swatch: "#e8642a", hint: "Legend: Council / External Assets" },
  { key: "blue", label: "Blue", swatch: "#1d4ed8", hint: "Legend: Neighbouring Assets" },
  { key: "red", label: "Red", swatch: "#ff0000", hint: "Legend: Project Site — use this to redraw the site boundary" },
];

const SWATCH: Record<ShapeColor, string> = { orange: "#e8642a", blue: "#1d4ed8", red: "#ff0000" };

/**
 * What the shape IS — colour and line-vs-area — drawn rather than spelled out.
 *
 * The map is colour-coded, so a row reading "Area · Blue" made you translate a word back
 * into the thing on screen. The glyph mirrors how each mode actually renders: a line is a
 * stroked band, an area is a filled polygon with a solid edge. That leaves the text to
 * carry only what a 20px icon can't — width, point count, and the measurement.
 */
function ShapeGlyph({ shape }: { shape: ShapeDraft }) {
  const color = SWATCH[shape.color];
  const label = `${shape.color} ${shape.mode}`;
  return (
    <span className="shrink-0" title={label} aria-label={label} role="img">
      <svg width="22" height="22" viewBox="0 0 22 22">
        <rect x="0.5" y="0.5" width="21" height="21" rx="4" fill="#fff" stroke="#e4e6e8" />
        {shape.mode === "area" ? (
          <polygon
            points="4.5,6 17.5,4.5 18,16 6,17.5"
            fill={color}
            fillOpacity={0.5}
            stroke={color}
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
        ) : (
          <path
            d="M4 15.5 L9.5 8 L18 6"
            fill="none"
            stroke={color}
            strokeOpacity={0.9}
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </span>
  );
}

/** Colour and mode now live in the glyph, so they're deliberately absent here. */
function summarise(shape: ShapeDraft): string {
  const m = measureShape(shape);
  const parts = [
    shape.mode === "line" ? `${shape.widthMetres}m wide` : null,
    `${shape.points.length} ${shape.points.length === 1 ? "point" : "points"}`,
  ].filter(Boolean) as string[];
  return `${parts.join(" · ")}${m.areaSqm > 0 ? ` · ${formatArea(m.areaSqm)}` : ""}`;
}

/** The measurement strip on an expanded row. Recomputed on every render, so it tracks a
 *  drag live rather than waiting for a re-render of the map. */
function Measurement({ shape }: { shape: ShapeDraft }) {
  const m = measureShape(shape);
  if (m.areaSqm <= 0) return null;
  return (
    <div className="mt-3 flex items-baseline gap-3 rounded-lg bg-ad-surface px-3 py-2">
      <span className="text-sm font-semibold text-ad-ink">{formatArea(m.areaSqm)}</span>
      {m.lengthMetres !== null && (
        <span className="text-xs text-ad-muted">{formatLength(m.lengthMetres)} long</span>
      )}
    </div>
  );
}

function StepperRow({
  value,
  onChange,
  min,
  max,
  step,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step: number;
  label: string;
}) {
  return (
    <div className="mt-1 flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - step))}
        disabled={value <= min}
        aria-label={`Decrease ${label}`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-ad-border text-ad-ink hover:bg-ad-border/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        −
      </button>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="w-full"
      />
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + step))}
        disabled={value >= max}
        aria-label={`Increase ${label}`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-ad-border text-ad-ink hover:bg-ad-border/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}

export function ShapePanel({ shapes }: { shapes: ShapesState }) {
  const { shapes: list, activeShapeId, atMax } = shapes;

  return (
    <div className="rounded-xl border border-ad-border bg-white p-4">
      <p className="text-sm font-medium text-ad-ink">Custom shapes</p>
      {list.length === 0 && (
        <p className="mt-3 rounded-lg bg-ad-surface p-3 text-xs text-ad-muted">
          None yet — click the image to start one.
        </p>
      )}

      {list.length > 0 && (
        <ul className="mt-3 space-y-2">
          {list.map((shape, i) => {
            const isActive = shape.id === activeShapeId;
            const short = shape.points.length < MIN_POINTS[shape.mode];
            return (
              <li
                key={shape.id}
                className={cn(
                  "rounded-lg border",
                  isActive ? "border-ad-steel bg-ad-steel/5" : "border-ad-border"
                )}
              >
                <div className="flex items-center justify-between gap-2 p-3">
                  {/* Selecting is what routes map clicks to this shape. Clicking the
                      already-selected row deselects, so clicks stop landing on it — that
                      replaces the old "Finish this shape" button. */}
                  <button
                    type="button"
                    onClick={() => shapes.select(isActive ? null : shape.id)}
                    aria-pressed={isActive}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span
                      className={cn(
                        "h-2.5 w-2.5 shrink-0 rounded-full",
                        isActive ? "bg-ad-steel" : "border border-ad-border bg-white"
                      )}
                    />
                    <ShapeGlyph shape={shape} />
                    {/* Stacked, not inline: the panel is max-w-xs and an inline summary
                        truncates to "Line, 10m · 3 poi…" at that width. */}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-ad-ink">Shape {i + 1}</span>
                      {!isActive && (
                        <span className="block text-xs text-ad-muted">{summarise(shape)}</span>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => shapes.removeShape(shape.id)}
                    className="shrink-0 text-xs text-ad-orange underline underline-offset-2 hover:text-ad-ink"
                  >
                    Remove
                  </button>
                </div>

                {isActive && (
                  <div className="border-t border-ad-steel/20 p-3">
                    <div className="flex rounded-lg border border-ad-border p-0.5">
                      {MODES.map((m) => (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => shapes.setMode(shape.id, m.key)}
                          title={m.hint}
                          aria-pressed={shape.mode === m.key}
                          className={cn(
                            "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
                            shape.mode === m.key
                              ? "bg-ad-steel text-white"
                              : "text-ad-muted hover:text-ad-ink"
                          )}
                        >
                          {/* Same silhouettes the row glyph uses, so picking a mode shows
                              you the shape you'll get rather than only naming it. */}
                          <svg width="14" height="14" viewBox="0 0 22 22" aria-hidden>
                            {m.key === "area" ? (
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
                          {m.label}
                        </button>
                      ))}
                    </div>

                    <div className="mt-2 flex gap-2">
                      {COLORS.map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => shapes.setColor(shape.id, c.key)}
                          title={c.hint}
                          aria-pressed={shape.color === c.key}
                          className={cn(
                            "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-sm",
                            shape.color === c.key
                              ? "border-ad-steel bg-ad-steel/10 text-ad-ink"
                              : "border-ad-border text-ad-muted hover:text-ad-ink"
                          )}
                        >
                          <span
                            className="h-3 w-3 rounded-full border border-black/10"
                            style={{ backgroundColor: c.swatch }}
                          />
                          {c.label}
                        </button>
                      ))}
                    </div>

                    {shape.mode === "line" && (
                      <>
                        <p className="mt-3 text-sm font-medium text-ad-ink">Width ({shape.widthMetres}m)</p>
                        <StepperRow
                          value={shape.widthMetres}
                          onChange={(n) => shapes.setWidth(shape.id, n)}
                          min={MIN_SHAPE_WIDTH_M}
                          max={MAX_SHAPE_WIDTH_M}
                          step={SHAPE_WIDTH_STEP_M}
                          label="width"
                        />
                      </>
                    )}

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="text-xs text-ad-muted">
                        {shape.points.length}/{MAX_SHAPE_POINTS} points
                      </span>
                      <span className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => shapes.undoPoint(shape.id)}
                          disabled={shape.points.length === 0}
                          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                        >
                          Undo point
                        </button>
                        <button
                          type="button"
                          onClick={() => shapes.clearPoints(shape.id)}
                          disabled={shape.points.length === 0}
                          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                        >
                          Clear
                        </button>
                      </span>
                    </div>

                    <Measurement shape={shape} />

                    {short && (
                      <p className="mt-2 text-xs text-ad-orange">
                        Needs {MIN_POINTS[shape.mode]}+ points to render — it won&apos;t appear on the map yet.
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Steel, not outline. Drawing is the main thing done in this panel, and as a grey
          outline it carried less weight than the Remove links beside it. Steel also keeps
          a readable three-tier hierarchy in the column: charcoal Regenerate commits,
          steel creates, outline is secondary. */}
      <button
        type="button"
        onClick={shapes.addShape}
        disabled={atMax}
        className={cn(
          "mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-ad-steel px-3 py-2 text-sm font-medium text-white transition-colors",
          "hover:bg-ad-steel/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ad-steel",
          "disabled:cursor-not-allowed disabled:bg-ad-border disabled:text-ad-muted"
        )}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Add shape
      </button>

      {atMax && (
        <p className="mt-2 text-xs text-ad-orange">
          Max {MAX_SHAPES} shapes — remove one to add another.
        </p>
      )}
    </div>
  );
}
