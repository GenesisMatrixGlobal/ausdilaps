"use client";

/** A `− [slider] +` triple. The slider covers the range in one gesture, the buttons nudge
 *  by exactly one step — reaching a specific value with a range input alone is fiddly.
 *
 *  Lives here rather than in a tool because the Residential Mark Up and Measure tabs both
 *  use it for shape width, and Residential uses a second one for zoom. Same reasoning as
 *  components/ui/tab-bar.tsx. */
export function StepperRow({
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
