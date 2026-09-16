"use client";

// The status sheet: every property the opportunity's work orders name, and how each one went.
//
// Deliberately NOT the shared quote-lines table. That one exists to keep the QUOTE sheet
// identical in two tools — products, rates, m², levels, Salesforce line items — and a closeout
// has none of those. Forcing it through would mean hiding half its columns or adding a mode to
// a shared component for one caller.

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { SHEET_CELL, SHEET_HEAD } from "@/components/tools/shared/quote-lines/styles";
import { MARKUP_STYLES } from "@/lib/kml/standard-markup/style";
import { INSPECTION_LEGEND } from "@/lib/closeout-markup/types";
import type { CloseoutRow } from "@/lib/closeout-markup/rows";

export function StatusTable({
  rows,
  onToggle,
  onToggleAll,
  onExport,
  capped,
  max,
}: {
  rows: CloseoutRow[];
  onToggle: (key: string) => void;
  onToggleAll: (selected: boolean) => void;
  onExport: () => void;
  /** More properties are ticked than one drawing can hold. */
  capped: boolean;
  max: number;
}) {
  const selected = rows.filter((r) => r.selected).length;
  const allSelected = selected === rows.length && rows.length > 0;

  return (
    <div className="mt-8 rounded-xl border border-ad-border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ad-border px-4 py-3">
        <div>
          <p className="text-sm font-medium text-ad-ink">Properties</p>
          <p className="mt-0.5 text-xs text-ad-muted">
            {rows.length} propert{rows.length === 1 ? "y" : "ies"} · {selected} on the drawing
            {capped && (
              <span className="text-ad-orange">
                {" "}
                — a drawing holds {max}, so untick {selected - max} before generating
              </span>
            )}
          </p>
        </div>
        <button type="button" onClick={onExport} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Export CSV
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr>
              <th className={cn(SHEET_HEAD, "w-10 text-center")}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => onToggleAll(!allSelected)}
                  aria-label={allSelected ? "Untick every property" : "Tick every property"}
                />
              </th>
              <th className={cn(SHEET_HEAD, "w-12 text-right")}>#</th>
              <th className={SHEET_HEAD}>Street</th>
              <th className={SHEET_HEAD}>Suburb</th>
              <th className={SHEET_HEAD}>Status</th>
              <th className={cn(SHEET_HEAD, "text-right")}>Work orders</th>
              <th className={SHEET_HEAD}>On the map</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const p = row.property;
              return (
                <tr key={p.key} className={row.selected ? undefined : "opacity-55"}>
                  <td className={cn(SHEET_CELL, "text-center")}>
                    <input
                      type="checkbox"
                      checked={row.selected}
                      onChange={() => onToggle(p.key)}
                      aria-label={`Include ${p.street}`}
                    />
                  </td>
                  <td className={cn(SHEET_CELL, "text-right tabular-nums text-ad-muted")}>{row.number ?? ""}</td>
                  <td className={SHEET_CELL}>
                    <span className="flex items-center gap-2">
                      {/* The same two-tone as the drawing: a part-inspected property is a green
                          ring round an orange centre, not a colour of its own. */}
                      <span
                        aria-hidden
                        className="inline-block size-3 shrink-0 rounded-full border-2"
                        style={{
                          backgroundColor: `#${MARKUP_STYLES[p.color].fill}`,
                          borderColor: `#${MARKUP_STYLES[p.color].stroke}`,
                        }}
                      />
                      <span className="text-ad-ink">{p.street}</span>
                    </span>
                  </td>
                  <td className={cn(SHEET_CELL, "text-ad-muted")}>{p.suburb ?? "—"}</td>
                  <td className={SHEET_CELL}>
                    <span className="text-ad-ink">{INSPECTION_LEGEND[p.color]}</span>
                    {/* The counts are what make PURPLE readable: "8 done, 19 not" is the thing
                        an operator acts on, and a colour alone cannot say it. */}
                    {p.color === "partial" && (
                      <span className="block text-xs text-ad-muted">
                        {[
                          p.counts.green ? `${p.counts.green} inspected` : null,
                          p.counts.red ? `${p.counts.red} not` : null,
                          p.counts.orange ? `${p.counts.orange} pending` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </td>
                  <td className={cn(SHEET_CELL, "text-right tabular-nums text-ad-muted")}>{p.workOrders}</td>
                  <td className={cn(SHEET_CELL, "text-xs text-ad-muted")}>
                    {row.ring ? (
                      <span className="text-ad-ink">Title boundary{row.lotPlan ? ` · ${row.lotPlan}` : ""}</span>
                    ) : (
                      (row.note ?? "Not generated yet")
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
