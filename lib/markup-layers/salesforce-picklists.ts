// The real Salesforce vocabulary behind the Quote Line Item sheet: the products an estimator
// prices a PROPERTY on, the QuoteLineItem Asset Type picklist, and the asset type each
// product forces. Confirmed by Rhys 2026-09-10 from the org (Product2 Ids from the product
// list; Property_Type__c labels and API names from the picklist definition).
//
// This REPLACED a names-only, "provisional" mapping guessed from the names. The names were
// never safe to match programmatically — the product is "Standard Internal - Dense" while the
// asset type is "Standard Internal - High Density"; "Video Roadway**s**" vs "Video Roadway";
// and "Warehouse" is the API NAME of the asset type labelled "Standard Internal - Low Density".
//
// Drafts (and the Building Markup save file) store the product NAME and the asset type LABEL,
// exactly as before, so every saved markup still opens. The Ids and API values are looked up
// at sync time only.

/** QuoteLineItem.Property_Type__c — the picklist, in the order the org lists it. */
export const ASSET_TYPES = [
  { label: "Standard Internal", apiValue: "Commercial" },
  { label: "Standard Internal - High Density", apiValue: "Commercial_Dense" },
  { label: "Standard Internal - Low Density", apiValue: "Warehouse" },
  { label: "Common Areas", apiValue: "Common Areas" },
  { label: "External GPS", apiValue: "External_GPS" },
  { label: "External non-GPS", apiValue: "External_Non_GPS" },
  { label: "External Low Density", apiValue: "External Low Density" },
  { label: "Video Roadway", apiValue: "Video_Roadway" },
  { label: "Other", apiValue: "Other" },
] as const;

export type AssetType = (typeof ASSET_TYPES)[number]["label"];

/** The labels, for the row's select. `""` is Salesforce's own --None--. */
export const ASSET_TYPE_LABELS: readonly AssetType[] = ASSET_TYPES.map((a) => a.label);

/** The picklist API value the sync writes for a label, or undefined for a label the org
 *  doesn't have (a renamed value in an old save file). */
export function assetTypeApiValue(label: string): string | undefined {
  return ASSET_TYPES.find((a) => a.label === label)?.apiValue;
}

export interface SheetProduct {
  name: string;
  /** Product2 record Id. The line item itself is created against the Quote's price book's
   *  entry for this product — see lib/quote-lines/resolve.ts. */
  product2Id: string;
  /** The asset type this product FORCES. The operator can still override the row. */
  assetType: AssetType;
}

/**
 * The products that price a property. The org has ten more (Access Letters, DOA, Drone,
 * Mobilisation, Office Time, Other, Project Induction, SIA, Video CCTV, Video Culverts) — all
 * per-job charges with nothing to measure, so they are not offered on a per-property sheet.
 * A saved draft naming one still loads and shows its name; the sync refuses that row with the
 * reason rather than guessing a product.
 */
export const SHEET_PRODUCTS: readonly SheetProduct[] = [
  { name: "Residential House", product2Id: "01t96000000GNqD", assetType: "Standard Internal" },
  { name: "Residential Unit", product2Id: "01t96000000GQOp", assetType: "Standard Internal" },
  { name: "Standard Internal", product2Id: "01tOl0000000LHN", assetType: "Standard Internal" },
  { name: "Standard Internal - Dense", product2Id: "01t96000000GQP4", assetType: "Standard Internal - High Density" },
  { name: "Rail Infrastructure", product2Id: "01tOl000009iFnl", assetType: "Standard Internal - High Density" },
  // ⚠ Inferred: the asset type labelled "Standard Internal - Low Density" has the API name
  // `Warehouse`, which is the only reading that gives this product an asset type at all.
  // Rhys did not state it explicitly — confirm on the first real sync.
  { name: "Warehouse", product2Id: "01t96000000GQOz", assetType: "Standard Internal - Low Density" },
  { name: "Common Areas (30%)", product2Id: "01t96000000GQOu", assetType: "Common Areas" },
  { name: "External GPS", product2Id: "01t96000000GQP9", assetType: "External GPS" },
  { name: "External non-GPS", product2Id: "01t96000000GQPE", assetType: "External non-GPS" },
  { name: "Video Roadways", product2Id: "01t96000000GQPJ", assetType: "Video Roadway" },
];

export const PRODUCT_NAMES: readonly string[] = SHEET_PRODUCTS.map((p) => p.name);

export function productByName(name: string): SheetProduct | undefined {
  return SHEET_PRODUCTS.find((p) => p.name === name);
}

/** The asset type a product implies, or "" for --None--. Unknown product (a per-job charge
 *  from an old save file, or a name the org has since renamed) falls through to "" rather
 *  than a guess. */
export function assetTypeForProduct(product: string): AssetType | "" {
  return productByName(product)?.assetType ?? "";
}

/**
 * The product a markup layer starts on, by the colour it is drawn in.
 *
 * This is the one thing colour genuinely settles. It is an ownership/scope axis on the markup —
 * red is the project site, blue is a neighbouring asset, orange is council/external — and the
 * product catalogue splits the same way: an internal inspection of a building versus an
 * external GPS survey of the street. So the two most common products can be seeded rather than
 * chosen 20 times a day, and both carry their asset type with them.
 *
 * Lives here, beside SHEET_PRODUCTS, so every product NAME in the codebase is in one file —
 * when the org renames one, there is a single place to correct.
 */
export const PRODUCT_BY_COLOR: Record<"red" | "blue" | "orange", string> = {
  red: "Standard Internal",
  blue: "Standard Internal",
  orange: "External GPS",
};

// ─── Rates ──────────────────────────────────────────────────────────────────────────────
//
// The org prices per m² off PICKLISTS, not free numbers (Rhys, 2026-09-10): external rates
// step in 5 cents; internal rates step in 5 cents below $0.50 and 10 cents above. The sheet's
// rate cells are therefore selects over these steps, so an operator cannot type a rate the
// picklist has no value for. Stored as "0.80"-style strings like every other cell.
//
// ⚠ The upper bounds and the picklist VALUE FORMAT ("0.80" vs "$0.80" vs "80c") are not yet
// confirmed against the org — the Salesforce credentials are Vercel-only (marked sensitive,
// so `vercel env pull` returns placeholders) and the describe could not be run. Verify with
// `scripts/sf-describe` once SF_CLIENT_ID/SECRET are in .env.local, and correct
// rateToPicklistValue() if the format differs. Nothing else needs to change.

function cents(from: number, to: number, step: number): string[] {
  const out: string[] = [];
  for (let c = from; c <= to; c += step) out.push((c / 100).toFixed(2));
  return out;
}

export const RATE_STEPS = {
  internal: [...cents(5, 45, 5), ...cents(50, 300, 10)],
  external: cents(5, 200, 5),
} as const;

/**
 * Which QuoteLineItem fields a rate is written to. A picklist of null means "not sent" —
 * the internal picklist's API name is not yet known (see the ⚠ above), so only the currency
 * field is written for internal until the describe names it.
 */
export const RATE_FIELDS = {
  internal: { currency: "Internal_M2_Rate__c", picklist: null as string | null },
  external: { currency: "External_Rate__c", picklist: "External_Rate_PL__c" as string | null },
} as const;

/** The picklist string for a sheet rate. One function, so a format surprise is a one-line fix. */
export function rateToPicklistValue(rate: string): string {
  return Number(rate).toFixed(2);
}
