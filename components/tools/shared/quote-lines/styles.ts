// Class strings shared by the sheet's cells. Borderless inputs, tinted on focus: what makes
// a grid of boxes read as a spreadsheet instead of a form.

// A faint dashed underline says "you can type here" without turning the grid into a stack of
// form boxes; hover tints the cell, focus turns the underline solid and steel. Bare transparent
// inputs read as static text — nobody realised the sheet was editable.
export const SHEET_INPUT =
  "w-full cursor-text bg-transparent px-2 py-2 text-sm text-ad-ink outline-none " +
  "border-b border-dashed border-ad-border hover:bg-ad-steel/5 focus:border-solid focus:border-ad-steel focus:bg-ad-steel/10";

export const SHEET_HEAD =
  "border-b border-ad-border bg-ad-surface px-2 py-2 align-bottom text-[0.7rem] font-semibold uppercase tracking-wide text-ad-muted";

export const SHEET_CELL = "border-b border-r border-ad-border/60 last:border-r-0";

/** Break a block out of the page's 1240px Container on xl screens.
 *
 *  `left-1/2` + `-translate-x-1/2` re-centres on the VIEWPORT rather than the parent, which is
 *  what lets a child exceed its container's width. `min()` makes it safe: never past the
 *  viewport less its gutters, so no horizontal page scroll, and below xl it resolves to the
 *  container width and the breakout switches itself off. Capped at 100rem because rows much
 *  wider than that are hard to track across. Shared by the sheet and the markup's map row. */
export const BREAKOUT_XL = "xl:relative xl:left-1/2 xl:w-[min(100rem,calc(100vw-4rem))] xl:-translate-x-1/2";
