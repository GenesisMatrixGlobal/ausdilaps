"use client";

// A per-m² rate cell. A SELECT over the org's picklist steps rather than a free number: the
// QuoteLineItem rate fields are picklists (see RATE_STEPS), so a typed "0.83" would be a value
// Salesforce has no option for, and the sync would fail on a row that looked fine on screen.
//
// The `$` sits outside the control so every column of money lines up on the symbol.

import { cn } from "@/lib/utils";
import { RATE_STEPS } from "@/lib/markup-layers/salesforce-picklists";
import { SHEET_INPUT } from "./styles";

export function RateSelect({
  value,
  onChange,
  label,
  kind,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  kind: keyof typeof RATE_STEPS;
}) {
  const steps: readonly string[] = RATE_STEPS[kind];
  // A saved draft can carry a rate that isn't on the steps (an old free-text cell). Shown as
  // its own option so reopening a markup never silently moves a price.
  const offStep = value !== "" && !steps.includes(value);
  return (
    <span className="flex items-center pl-2 focus-within:bg-ad-steel/10">
      <span className="text-sm text-ad-muted">$</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        title={offStep ? "Not one of the rate picklist's values — pick one before syncing" : undefined}
        className={cn(SHEET_INPUT, "pl-1 text-right tabular-nums", offStep && "text-ad-orange")}
      >
        {offStep && <option value={value}>{value}</option>}
        {steps.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </span>
  );
}
