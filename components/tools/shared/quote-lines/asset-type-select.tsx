"use client";

// The per-row Asset Type control on the Quote Line Item sheet.
//
// Pre-filled from the chosen product and overridable. It is NOT derived from any drawing: an
// earlier version guessed a physical asset type (kerb / verge / footpath) from colour and
// line-vs-area, complete with a confidence badge to hedge the guess. The org's real picklist
// is a set of INSPECTION types tied to the product, so there is nothing left to guess — and a
// badge on a value that came from the product would be telling the operator to doubt their own
// choice.

import { cn } from "@/lib/utils";
import { ASSET_TYPE_LABELS } from "@/lib/markup-layers/salesforce-picklists";
import { SHEET_INPUT } from "./styles";

export function AssetTypeSelect({
  value,
  onChange,
  className,
  /** True when the value is the product's default rather than an override. Renders the same,
   *  but tells the operator (via the title) that changing the product will move it. */
  isDefault,
}: {
  value: string;
  onChange: (assetType: string) => void;
  className?: string;
  isDefault?: boolean;
}) {
  const known = (ASSET_TYPE_LABELS as readonly string[]).includes(value);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Asset type"
      title={
        value === ""
          ? "Choose a product and this fills in"
          : isDefault
            ? "From the product — override it here if you need to"
            : "Set by hand"
      }
      className={cn(SHEET_INPUT, "min-w-0 cursor-pointer", value === "" && "text-ad-muted", className)}
    >
      {/* Salesforce's own --None--, and what a row shows until a product is chosen. */}
      <option value="">—</option>
      {/* A value from an old save file the org no longer has: shown so it isn't silently
          changed, and the sync refuses the row with the reason. */}
      {!known && value !== "" && <option value={value}>{value}</option>}
      {ASSET_TYPE_LABELS.map((a) => (
        <option key={a} value={a}>
          {a}
        </option>
      ))}
    </select>
  );
}
