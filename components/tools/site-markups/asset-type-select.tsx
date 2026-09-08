"use client";

// The per-row Asset Type control on the Quote Line Item sheet.
//
// Pre-filled from the chosen product and overridable. It is NOT derived from the drawing: an
// earlier version guessed a physical asset type (kerb / verge / footpath) from colour and
// line-vs-area, complete with a confidence badge to hedge the guess. The org's real picklist
// is a set of INSPECTION types tied to the product, so there is nothing left to guess — and a
// badge on a value that came from the product would be telling the operator to doubt their own
// choice.

import { cn } from "@/lib/utils";
import { ASSET_TYPES } from "@/lib/markup-layers/salesforce-picklists";

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
      className={cn(
        "w-full min-w-0 bg-transparent px-2 py-2 text-sm text-ad-ink outline-none focus:bg-ad-steel/10",
        value === "" && "text-ad-muted",
        className
      )}
    >
      {/* Salesforce's own --None--, and what a row shows until a product is chosen. */}
      <option value="">—</option>
      {ASSET_TYPES.map((a) => (
        <option key={a} value={a}>
          {a}
        </option>
      ))}
    </select>
  );
}
