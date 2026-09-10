"use client";

// The Quote Line Item sheet — ONE component, hosted by Building Markup (under the image) and by
// Bulk Property Sizing (as its results table).
//
// A sheet rather than controls in a sidebar: the estimator's job here is reading numbers DOWN
// a column across every row. Full width, one row per source, spreadsheet keyboard behaviour —
// tab across, type, tab on.
//
// What differs between tools is only the LEADING columns — what each tool knows about the
// thing being priced (a markup layer's swatch and measurement; a property's lot size, levels
// and dwelling area). Those come in as `leading`; everything from Street to Qty, the tick
// column, the item number and the Sync to Salesforce footer are shared, so a change here
// reaches both tools at once.

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { PRODUCT_NAMES } from "@/lib/markup-layers/salesforce-picklists";
import { assetTypeFor, type LineItemDraft, type LineItemRow } from "@/lib/markup-layers/line-items";
import { AssetTypeSelect } from "./asset-type-select";
import { RateSelect } from "./rate-select";
import { SyncQuoteLines, type SyncQuoteLinesProps } from "./sync-quote-lines";
import { SHEET_CELL, SHEET_HEAD, SHEET_INPUT } from "./styles";

/** The measurement columns, sized explicitly.
 *
 *  Left to size themselves they took 183-196px EACH — 758px of an 1855px table — because a
 *  `<th>` in an auto-layout table opens to fit its longest line, and "INTERNAL $/M²" set
 *  uppercase with tracking is far wider than the "0.80" underneath it. Pinning the width lets
 *  the header wrap to two lines instead, and hands the space back to Street, Product and Asset
 *  type, which have real content to show. */
const NUM_COL = "w-[6.5rem]";
const RATE_COL = "w-[7rem]";

/** A tool-specific column between the item number and Street. */
export interface LeadingColumn {
  header: string;
  className?: string;
  cell: (row: LineItemRow) => ReactNode;
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
      className={cn(SHEET_INPUT, "text-right tabular-nums")}
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
      className={SHEET_INPUT}
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

export interface LineItemsTableProps {
  /** Already derived by the tool with rowsFrom() — ONE derivation per tool, so the sheet, any
   *  badges on a map and the export payload read the same numbers. */
  rows: LineItemRow[];
  leading: LeadingColumn[];
  onChange: (key: string, field: keyof LineItemDraft, value: string) => void;
  onToggle: (key: string) => void;
  onToggleAll: (select: boolean) => void;
  /** Break out of the page's 1240px Container on xl screens. Building Markup wants it — the
   *  map above keeps its layout while the sheet spreads. */
  breakout?: boolean;
  emptyText: string;
  /** Renders the Sync to Salesforce footer. Omit to host a read-only sheet. */
  sync?: SyncQuoteLinesProps;
  /** Extra controls for the header row (copy buttons and the like). */
  headerRight?: ReactNode;
  title?: string;
}

export function LineItemsTable({
  rows,
  leading,
  onChange,
  onToggle,
  onToggleAll,
  breakout,
  emptyText,
  sync,
  headerRight,
  title = "Quote line items",
}: LineItemsTableProps) {
  const selectedCount = rows.filter((r) => r.selected).length;
  const columnCount = 2 + leading.length + 9;

  return (
    // `left-1/2` + `-translate-x-1/2` re-centres on the VIEWPORT rather than the parent, which
    // is what lets a child exceed its container's width. `min()` makes it safe: it never grows
    // past the viewport less its gutters, so there is no horizontal page scroll, and below xl it
    // resolves to the container width and the breakout switches itself off. Capped at 100rem
    // because rows much wider than that are hard to track across.
    <div
      className={cn(
        "mt-6 rounded-xl border border-ad-border bg-white",
        breakout && "xl:relative xl:left-1/2 xl:w-[min(100rem,calc(100vw-4rem))] xl:-translate-x-1/2"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="text-sm font-medium text-ad-ink">
          {title}
          <span className="ml-2 font-normal text-ad-muted">
            {selectedCount} of {rows.length} selected
          </span>
        </p>
        {headerRight}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1200px] border-t border-ad-border text-sm">
          <thead>
            <tr>
              <th className={cn(SHEET_HEAD, "w-10 text-center")}>
                <SelectAll
                  checked={rows.length > 0 && selectedCount === rows.length}
                  indeterminate={selectedCount > 0 && selectedCount < rows.length}
                  onChange={onToggleAll}
                />
              </th>
              <th className={cn(SHEET_HEAD, "w-10 text-right")}>#</th>
              {leading.map((col) => (
                <th key={col.header} className={cn(SHEET_HEAD, "text-left", col.className)}>
                  {col.header}
                </th>
              ))}
              <th className={cn(SHEET_HEAD, "text-left")}>Street</th>
              <th className={cn(SHEET_HEAD, "text-left")}>Suburb</th>
              <th className={cn(SHEET_HEAD, "text-left")}>Product</th>
              <th className={cn(SHEET_HEAD, "text-left")}>Asset type</th>
              <th className={cn(SHEET_HEAD, NUM_COL, "text-right")}>Internal m²</th>
              <th className={cn(SHEET_HEAD, NUM_COL, "text-right")}>External m²</th>
              <th className={cn(SHEET_HEAD, RATE_COL, "text-right")}>Internal $/m²</th>
              <th className={cn(SHEET_HEAD, RATE_COL, "text-right")}>External $/m²</th>
              <th className={cn(SHEET_HEAD, "w-[4.5rem] text-right")}>Qty</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const productKnown = (PRODUCT_NAMES as readonly string[]).includes(row.values.product);
              return (
                <tr
                  key={row.key}
                  // Dimmed rather than hidden: an unticked row still holds the operator's
                  // numbers, and losing sight of it is how a property gets left off a quote twice.
                  className={cn("align-middle", !row.selected && "opacity-45")}
                >
                  <td className={cn(SHEET_CELL, "text-center")}>
                    <input
                      type="checkbox"
                      checked={row.selected}
                      onChange={() => onToggle(row.key)}
                      aria-label={`Include ${row.values.street || row.source.label} in the sync`}
                      className="h-4 w-4 accent-ad-steel"
                    />
                  </td>
                  {/* The quote item number. It ties this row to its bubble on a markup and its
                      line on the Quote; an em dash means "not a line item", which is what an
                      unticked row is. */}
                  <td className={cn(SHEET_CELL, "px-2 py-2 text-right font-medium tabular-nums text-ad-ink")}>
                    {row.number ?? "—"}
                  </td>
                  {leading.map((col) => (
                    <td key={col.header} className={cn(SHEET_CELL, "px-2 py-2", col.className)}>
                      {col.cell(row)}
                    </td>
                  ))}

                  <td className={SHEET_CELL}>
                    <Text value={row.values.street} onChange={(v) => onChange(row.key, "street", v)} label="Street" placeholder="—" />
                  </td>
                  <td className={SHEET_CELL}>
                    <Text value={row.values.suburb} onChange={(v) => onChange(row.key, "suburb", v)} label="Suburb" placeholder="—" />
                  </td>

                  <td className={SHEET_CELL}>
                    <select
                      value={row.values.product}
                      onChange={(e) => onChange(row.key, "product", e.target.value)}
                      aria-label="Product"
                      className={cn(SHEET_INPUT, "min-w-0 cursor-pointer", row.values.product === "" && "text-ad-muted")}
                    >
                      <option value="">— Select product —</option>
                      {/* A product from an old save file that the sheet no longer offers (a
                          per-job charge): shown so it isn't silently changed; the sync refuses it. */}
                      {!productKnown && row.values.product !== "" && (
                        <option value={row.values.product}>{row.values.product}</option>
                      )}
                      {PRODUCT_NAMES.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className={SHEET_CELL}>
                    <AssetTypeSelect
                      value={assetTypeFor(row.values)}
                      isDefault={row.values.assetType === ""}
                      onChange={(a) => onChange(row.key, "assetType", a)}
                    />
                  </td>

                  <td className={SHEET_CELL}>
                    <Num value={row.values.internalMetres} onChange={(v) => onChange(row.key, "internalMetres", v)} label="Internal m²" placeholder="—" />
                  </td>
                  <td className={SHEET_CELL}>
                    <Num value={row.values.externalMetres} onChange={(v) => onChange(row.key, "externalMetres", v)} label="External m²" placeholder="—" />
                  </td>
                  <td className={SHEET_CELL}>
                    <RateSelect kind="internal" value={row.values.internalRate} onChange={(v) => onChange(row.key, "internalRate", v)} label="Internal rate per m²" />
                  </td>
                  <td className={SHEET_CELL}>
                    <RateSelect kind="external" value={row.values.externalRate} onChange={(v) => onChange(row.key, "externalRate", v)} label="External rate per m²" />
                  </td>
                  <td className={SHEET_CELL}>
                    <Num value={row.values.quantity} onChange={(v) => onChange(row.key, "quantity", v)} label="Quantity" />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columnCount} className="px-4 py-6 text-center text-sm text-ad-muted">
                  {emptyText}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {sync && rows.length > 0 && <SyncQuoteLines rows={rows} {...sync} />}
    </div>
  );
}
