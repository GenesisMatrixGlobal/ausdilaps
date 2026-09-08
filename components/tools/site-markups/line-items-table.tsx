"use client";

// The Quote Line Item sheet, beneath the markup image.
//
// A sheet rather than controls in the right-hand column: the estimator's job here is reading
// numbers DOWN a column across every layer, and the sidebar is a max-w-xs stack that makes
// that comparison impossible. Full width, one row per layer, spreadsheet keyboard behaviour —
// tab across, type, tab on.
//
// Nothing here writes anywhere yet. It is the input surface for "Sync To Salesforce creates
// one line item per ticked layer"; the sync itself is not built (lib/salesforce.ts still has
// no create, and a line item needs a PricebookEntryId the repo has never read).

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { SHAPE_COLORS } from "@/lib/kml/standard-markup/style";
import { AssetTypeSelect } from "./asset-type-select";
import { PRODUCTS } from "@/lib/markup-layers/salesforce-picklists";
import {
  assetTypeFor,
  rowsFrom,
  type LineItemDraft,
  type LineItemDrafts,
} from "@/lib/markup-layers/line-items";
import type { MarkupLayer } from "@/lib/markup-layers/types";

const HEAD =
  "border-b border-ad-border bg-ad-surface px-2 py-2 align-bottom text-[0.7rem] font-semibold uppercase tracking-wide text-ad-muted";
/** The measurement and rate columns, sized explicitly.
 *
 *  Left to size themselves they took 183-196px EACH — 758px of an 1855px table — because a
 *  `<th>` in an auto-layout table opens to fit its longest line, and "INTERNAL $/M²" set
 *  uppercase with tracking is far wider than the "0.80" underneath it. Pinning the width lets
 *  the header wrap to two lines instead, and hands ~370px back to Street, Product and Asset
 *  type, which have real content to show. */
const NUM_COL = "w-[6.5rem]";
const RATE_COL = "w-[7rem]";
const CELL = "border-b border-r border-ad-border/60 last:border-r-0";
/** Borderless inputs, tinted on focus: what makes a grid of boxes read as a spreadsheet
 *  instead of a form. */
const INPUT = "w-full bg-transparent px-2 py-2 text-sm text-ad-ink outline-none focus:bg-ad-steel/10";

/** A currency cell — the $ sits outside the input so it can't be deleted or typed over, and
 *  every column of money lines up on the symbol. */
function Money({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <span className="flex items-center pl-2 focus-within:bg-ad-steel/10">
      <span className="text-sm text-ad-muted">$</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        aria-label={label}
        className={cn(INPUT, "pl-1 text-right tabular-nums")}
      />
    </span>
  );
}

function Num({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      inputMode="decimal"
      aria-label={label}
      placeholder={placeholder}
      className={cn(INPUT, "text-right tabular-nums")}
    />
  );
}

function Text({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      placeholder={placeholder}
      className={INPUT}
    />
  );
}

/** Select-all. `indeterminate` is a DOM property with no JSX attribute, so it has to be set
 *  through a ref — the one place in this file that touches the element directly. */
function SelectAll({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (next: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      aria-label="Select all rows for sync"
      title={checked ? "Deselect all" : "Select all"}
      className="h-4 w-4 accent-ad-steel"
    />
  );
}

export function LineItemsTable({
  layers,
  drafts,
  deselected,
  onChange,
  onToggle,
  onToggleAll,
}: {
  layers: MarkupLayer[];
  drafts: LineItemDrafts;
  deselected: ReadonlySet<string>;
  onChange: (layerKey: string, field: keyof LineItemDraft, value: string) => void;
  onToggle: (layerKey: string) => void;
  onToggleAll: (select: boolean) => void;
}) {
  const rows = rowsFrom(layers, drafts, deselected);
  const selectedCount = rows.filter((r) => r.selected).length;

  return (
    // Breaks out of the page's 1240px Container so eleven columns can be read without
    // scrolling on a wide monitor, while the map and its sidebar above keep the layout they
    // were designed for. `left-1/2` + `-translate-x-1/2` re-centres on the VIEWPORT rather
    // than the parent, which is what lets a child exceed its container's width.
    //
    // `min()` is what makes it safe: it never grows past the viewport less its gutters, so
    // there is no horizontal page scroll, and below xl it resolves to the container width and
    // the breakout effectively switches itself off. Capped at 100rem because rows much wider
    // than that are hard to track across — past a point the fix becomes the problem.
    <div
      className={cn(
        "mt-6 rounded-xl border border-ad-border bg-white",
        "xl:relative xl:left-1/2 xl:w-[min(100rem,calc(100vw-4rem))] xl:-translate-x-1/2"
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
        <p className="text-sm font-medium text-ad-ink">Quote line items</p>
        <p className="text-sm text-ad-muted">
          {selectedCount} of {rows.length} selected
        </p>
      </div>

      <div className="overflow-x-auto">
        {/* 1200px, which is what the columns need once the rate columns are pinned above — and
            low enough to fit inside the broken-out card on a 1280px screen. */}
        <table className="w-full min-w-[1200px] border-t border-ad-border text-sm">
          <thead>
            <tr>
              <th className={cn(HEAD, "w-10 text-center")}>
                <SelectAll
                  checked={rows.length > 0 && selectedCount === rows.length}
                  indeterminate={selectedCount > 0 && selectedCount < rows.length}
                  onChange={onToggleAll}
                />
              </th>
              <th className={cn(HEAD, "text-left")}>Layer</th>
              <th className={cn(HEAD, "text-left")}>Street</th>
              <th className={cn(HEAD, "text-left")}>Suburb</th>
              <th className={cn(HEAD, "text-left")}>Product</th>
              <th className={cn(HEAD, "text-left")}>Asset type</th>
              <th className={cn(HEAD, NUM_COL, "text-right")}>Internal m²</th>
              <th className={cn(HEAD, NUM_COL, "text-right")}>External m²</th>
              <th className={cn(HEAD, RATE_COL, "text-right")}>Internal $/m²</th>
              <th className={cn(HEAD, RATE_COL, "text-right")}>External $/m²</th>
              <th className={cn(HEAD, "w-[4.5rem] text-right")}>Qty</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                // Dimmed rather than hidden: an unticked row still holds the operator's
                // numbers, and losing sight of it is how a layer gets left off a quote twice.
                className={cn("align-middle", !row.selected && "opacity-45")}
              >
                <td className={cn(CELL, "text-center")}>
                  <input
                    type="checkbox"
                    checked={row.selected}
                    onChange={() => onToggle(row.key)}
                    aria-label={`Include ${row.values.street || row.layer.label} in the sync`}
                    className="h-4 w-4 accent-ad-steel"
                  />
                </td>

                <td className={cn(CELL, "px-2 py-2")}>
                  <span className="flex items-center gap-2">
                    <span
                      className="h-3.5 w-3.5 shrink-0 rounded-sm border border-black/10"
                      style={{ backgroundColor: `#${SHAPE_COLORS[row.layer.color]}` }}
                    />
                    <span className="min-w-0">
                      {/* The quote item number, then what kind of thing it is. The number is what
                          ties this row to its bubble on the map and its line in the exported
                          legend; an em dash means "not a line item", which is what an unticked
                          row is. The street has its own column. */}
                      <span className="block whitespace-nowrap font-medium text-ad-ink">
                        <span className="tabular-nums">{row.number ?? "—"}</span>
                        <span className="text-ad-muted"> · {row.layer.label}</span>
                      </span>
                      <span className="block whitespace-nowrap text-xs text-ad-muted">{row.measured}</span>
                    </span>
                  </span>
                </td>

                <td className={CELL}>
                  <Text
                    value={row.values.street}
                    onChange={(v) => onChange(row.key, "street", v)}
                    label="Street"
                    placeholder="—"
                  />
                </td>
                <td className={CELL}>
                  <Text
                    value={row.values.suburb}
                    onChange={(v) => onChange(row.key, "suburb", v)}
                    label="Suburb"
                    placeholder="—"
                  />
                </td>

                <td className={CELL}>
                  <select
                    value={row.values.product}
                    onChange={(e) => onChange(row.key, "product", e.target.value)}
                    aria-label="Product"
                    className={cn(INPUT, "min-w-0 cursor-pointer", row.values.product === "" && "text-ad-muted")}
                  >
                    <option value="">— Select product —</option>
                    {PRODUCTS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </td>

                <td className={CELL}>
                  <AssetTypeSelect
                    value={assetTypeFor(row.values)}
                    isDefault={row.values.assetType === ""}
                    onChange={(a) => onChange(row.key, "assetType", a)}
                  />
                </td>

                <td className={CELL}>
                  <Num
                    value={row.values.internalMetres}
                    onChange={(v) => onChange(row.key, "internalMetres", v)}
                    label="Internal m²"
                    placeholder="—"
                  />
                </td>
                <td className={CELL}>
                  <Num
                    value={row.values.externalMetres}
                    onChange={(v) => onChange(row.key, "externalMetres", v)}
                    label="External m²"
                    placeholder="—"
                  />
                </td>
                <td className={CELL}>
                  <Money
                    value={row.values.internalRate}
                    onChange={(v) => onChange(row.key, "internalRate", v)}
                    label="Internal rate per m²"
                  />
                </td>
                <td className={CELL}>
                  <Money
                    value={row.values.externalRate}
                    onChange={(v) => onChange(row.key, "externalRate", v)}
                    label="External rate per m²"
                  />
                </td>
                <td className={CELL}>
                  <Num
                    value={row.values.quantity}
                    onChange={(v) => onChange(row.key, "quantity", v)}
                    label="Quantity"
                  />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-center text-sm text-ad-muted">
                  Nothing included on the markup yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
