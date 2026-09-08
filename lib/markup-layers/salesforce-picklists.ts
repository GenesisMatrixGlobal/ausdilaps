// The real Salesforce vocabulary: the Standard Price Book's products and QuoteLineItem's
// Asset Type picklist, plus the default asset type each product implies.
//
// Transcribed from the org (Add Products modal + the QuoteLineItem "Formula Pricing" section).
// This REPLACED an invented table of physical asset types — kerb & channel, nature strip,
// footpath, culvert — which do not exist in the org. Asset Type is an INSPECTION type, and its
// real axis is internal vs external, which is also why a shape's colour is enough to decide
// which measurement column a layer's area lands in.

/** QuoteLineItem.Asset Type — the picklist, in the order the org lists it.
 *
 *  `""` is Salesforce's own --None--, and is what a row shows until a product is chosen. */
export const ASSET_TYPES = [
  "Standard Internal",
  "Standard Internal - High Density",
  "Standard Internal - Low Density",
  "Common Areas",
  "External GPS",
  "External non-GPS",
  "External Low Density",
  "Video Roadway",
  "Other",
] as const;

export type AssetType = (typeof ASSET_TYPES)[number];

/** Products on the Standard Price Book, alphabetical as the org lists them.
 *
 *  Names only — no list prices. Two were truncated in the screenshot they came from, the
 *  sheet carries its own rates, and price is finalised in Salesforce either way. Recording a
 *  half-read figure would be worse than recording none.
 *
 *  ⚠ The eventual line-item create needs a PricebookEntryId, not a name. Resolving name →
 *  PricebookEntry is a Salesforce read that hasn't been built (see Part 3 of the plan). */
export const PRODUCTS = [
  "Access Letters",
  "Common Areas (30%)",
  "DOA",
  "Drone",
  "External GPS",
  "External non-GPS",
  "Mobilisation",
  "Office Time",
  "Other",
  "Project Induction",
  "Rail Infrastructure",
  "Residential House",
  "Residential Unit",
  "SIA",
  "Standard Internal",
  "Standard Internal - Dense",
  "Video CCTV",
  "Video Culverts",
  "Video Roadways",
  "Warehouse",
] as const;

export type Product = (typeof PRODUCTS)[number];

/**
 * The asset type each product defaults to. Choosing a product fills this in; the operator can
 * still override the asset type on the row.
 *
 * ⚠ PROVISIONAL — a best guess from the names, pending Rhys's real mapping. The names are
 * deliberately NOT matched programmatically, because they don't line up: the product is
 * "Standard Internal - Dense" while the asset type is "Standard Internal - High Density";
 * the product is "Video Roadway**s**" and the asset type "Video Roadway"; and the asset type
 * "External Low Density" has no product at all. A string-similarity rule would look like it
 * worked and be wrong in exactly the cases that matter.
 *
 * `""` (--None--) is a legitimate value here: a per-job charge like Mobilisation or Office
 * Time has no asset to type. Guessing "Other" for those would put a meaningless value on a
 * line rather than leaving it honestly blank.
 */
export const PRODUCT_ASSET_DEFAULT: Record<Product, AssetType | ""> = {
  // Per-job charges — nothing being inspected, so no asset type.
  "Access Letters": "",
  Mobilisation: "",
  "Office Time": "",
  "Project Induction": "",

  // Internal inspections.
  "Standard Internal": "Standard Internal",
  "Standard Internal - Dense": "Standard Internal - High Density",
  "Residential House": "Standard Internal",
  "Residential Unit": "Standard Internal",
  Warehouse: "Standard Internal",
  "Common Areas (30%)": "Common Areas",

  // External inspections.
  "External GPS": "External GPS",
  "External non-GPS": "External non-GPS",
  "Video Roadways": "Video Roadway",

  // Engineering and specialist capture — no internal/external asset class of their own.
  DOA: "Other",
  SIA: "Other",
  Drone: "Other",
  "Rail Infrastructure": "Other",
  "Video CCTV": "Other",
  "Video Culverts": "Other",
  Other: "Other",
};

/** The asset type a product implies, or "" for --None--. Unknown product (a name the org has
 *  since renamed) falls through to "" rather than a guess. */
export function assetTypeForProduct(product: string): AssetType | "" {
  return PRODUCT_ASSET_DEFAULT[product as Product] ?? "";
}

/**
 * The product a layer starts on, by the colour it is drawn in.
 *
 * This is the one thing colour genuinely settles. It is an ownership/scope axis on the markup —
 * red is the project site, blue is a neighbouring asset, orange is council/external — and the
 * product catalogue splits the same way: an internal inspection of a building versus an
 * external GPS survey of the street. So the two most common products can be seeded rather than
 * chosen 20 times a day, and both carry their asset type with them through
 * PRODUCT_ASSET_DEFAULT.
 *
 * Lives here, beside PRODUCTS, so every product NAME in the codebase is in one file — when the
 * org renames one, there is a single place to correct.
 */
export const PRODUCT_BY_COLOR: Record<"red" | "blue" | "orange", Product> = {
  red: "Standard Internal",
  blue: "Standard Internal",
  orange: "External GPS",
};
