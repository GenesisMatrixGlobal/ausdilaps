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

function summarise(shape: ShapeDraft): string {
  const form = shape.mode === "area" ? "Area" : `Line, ${shape.widthMetres}m`;
  const colour = shape.color[0].toUpperCase() + shape.color.slice(1);
  return `${form} · ${colour} · ${shape.points.length} ${shape.points.length === 1 ? "point" : "points"}`;
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
                          className={cn(
                            "flex-1 rounded-md px-3 py-1.5 text-sm",
                            shape.mode === m.key
                              ? "bg-ad-steel text-white"
                              : "text-ad-muted hover:text-ad-ink"
                          )}
                        >
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

      <button
        type="button"
        onClick={shapes.addShape}
        disabled={atMax}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3 w-full")}
      >
        + Add shape
      </button>

      {atMax && (
        <p className="mt-2 text-xs text-ad-orange">
          Max {MAX_SHAPES} shapes — remove one to add another.
        </p>
      )}
    </div>
  );
}
