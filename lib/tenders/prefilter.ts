/**
 * A keyword gate that runs BEFORE we spend money on the classifier.
 *
 * Two rules govern how this is tuned, and they pull in opposite directions on purpose:
 *
 *   1. Keep it LOOSE. A false negative here is an opportunity that never reaches a human;
 *      a false positive costs about two cents. Err toward paying.
 *   2. Record every rejection as a row. `items_prefiltered` on the dashboard is what makes
 *      an over-aggressive filter visible — a filter that silently eats real work while
 *      every counter stays green is the same failure mode as a dead source.
 *
 * Roughly 75% of a day's intake is stationery, cleaning, labour hire and IT contracts, so
 * this is where most of the cost saving comes from.
 */

const KEYWORDS = [
  // core services
  "dilapidation",
  "dilapidations",
  "condition survey",
  "condition surveys",
  "condition assessment",
  "condition report",
  "structural integrity",
  "structural assessment",
  "structural inspection",
  "structural engineer",
  "defect",
  "defects",
  "make good",
  "make-good",
  "pre-construction survey",
  "preconstruction survey",
  "pre and post",
  "pre-and-post",
  "baseline survey",
  "property condition",
  "building inspection",
  "building condition",
  "asset condition",
  "settlement monitoring",
  "vibration monitoring",
  "crack monitoring",
  // capture methods — not a match alone, but often the only wording in a short digest line
  "drone survey",
  "aerial survey",
  "uav survey",
  "lidar",
  "point cloud",
  "roadway video",
  "culvert inspection",
  "pipe inspection",
  "cctv inspection",
  // adjacent phrasing that regularly wraps real work
  "adjoining propert",
  "adjacent propert",
  "neighbouring propert",
  "as 4349",
  "as4349",
];

/**
 * True when the item is worth a classifier call.
 *
 * Matches on a normalised title + excerpt. Cheap substring matching is deliberate: a
 * cleverer scorer would need tuning of its own, and the classifier is already the thing
 * that makes the nuanced call.
 */
export function prefilter(item: { title: string; excerpt?: string | null }): boolean {
  const haystack = `${item.title} ${item.excerpt ?? ""}`
    .toLowerCase()
    .replace(/\s+/g, " ");

  return KEYWORDS.some((keyword) => haystack.includes(keyword));
}

/** Exposed for the fixture tests, so a keyword change is reviewable. */
export const PREFILTER_KEYWORDS = KEYWORDS;
