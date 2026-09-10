// Building Markup's one tool-specific sheet column: the layer's colour swatch, what kind of
// thing it is, and what the markup measured — so the estimator can see where the m² came from
// and that changing it is an override.

import type { LeadingColumn } from "@/components/tools/shared/quote-lines/line-items-table";

export const MARKUP_LEADING_COLUMNS: LeadingColumn[] = [
  {
    header: "Layer",
    cell: (row) => (
      <span className="flex items-center gap-2">
        {row.source.swatch && (
          <span
            className="h-3.5 w-3.5 shrink-0 rounded-sm border border-black/10"
            style={{ backgroundColor: `#${row.source.swatch}` }}
          />
        )}
        <span className="min-w-0">
          <span className="block whitespace-nowrap font-medium text-ad-ink">{row.source.label}</span>
          <span className="block whitespace-nowrap text-xs text-ad-muted">{row.source.measured}</span>
        </span>
      </span>
    ),
  },
];
