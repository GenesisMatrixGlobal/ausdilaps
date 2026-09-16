// Building Markup → LineItemSource. The colour → product / measurement-column / "Council
// assets" rules used to live inside defaultDraft(); they are markup-specific, so they belong
// in the markup adapter. Output is identical to what the sheet showed before the split.

import { formatArea } from "@/lib/kml/standard-markup/measure";
import { markupColor } from "@/lib/kml/standard-markup/style";
import { PRODUCT_BY_COLOR } from "../salesforce-picklists";
import type { LineItemSource } from "../source";
import type { MarkupLayer } from "../types";

function measuredLabel(layer: MarkupLayer): string {
  const parts: string[] = [];
  if (layer.lotPlan) parts.push(layer.lotPlan);
  if (layer.mode === "line" && layer.lengthMetres) {
    parts.push(`${layer.lengthMetres.toLocaleString()} m long`);
    if (layer.widthMetres) parts.push(`${layer.widthMetres} m wide`);
  }
  if (layer.areaSqm && layer.areaSqm > 0) parts.push(formatArea(layer.areaSqm));
  return parts.join(" · ") || "not measured";
}

/**
 * Both the PRODUCT and which measurement column the area lands in come from the layer's
 * colour — see PRODUCT_BY_COLOR. Blue is internal, orange is external.
 *
 * Red — the project site — takes the product but seeds NEITHER measurement. It is the job's
 * own boundary rather than something being inspected, and pre-filling several thousand square
 * metres against a rate would put a plausible, wrong number on the quote's most visible line.
 */
export function sourceFromLayer(layer: MarkupLayer): LineItemSource {
  const area = layer.areaSqm && layer.areaSqm > 0 ? String(Math.round(layer.areaSqm)) : "";
  return {
    key: layer.key,
    label: layer.label,
    street: layer.street,
    suburb: layer.suburb,
    lotPlan: layer.lotPlan,
    measured: measuredLabel(layer),
    swatch: markupColor(layer.color),
    seed: {
      // A colour outside the quote palette (green/purple — a Closeout Markup's inspection
      // statuses) seeds NO product. That tool does not quote and never builds sources through
      // this adapter, but if one ever arrives here the row should come up blank and be refused
      // by rowReason() with a reason on screen, rather than be handed a plausible wrong product.
      product: PRODUCT_BY_COLOR[layer.color as keyof typeof PRODUCT_BY_COLOR] ?? "",
      // An orange shape is council / external infrastructure by definition — that is what the
      // colour MEANS on these markups, and it is what the operator was typing into this cell
      // by hand every time. A lot or the subject has a real address instead, and a red or blue
      // shape is part of the property, so neither gets a guess.
      street: layer.street ?? (layer.color === "orange" ? "Council assets" : ""),
      internalMetres: layer.color === "blue" ? area : "",
      externalMetres: layer.color === "orange" ? area : "",
      // The Street View count when a lot has one, else one storey until someone says otherwise —
      // the sheet highlights the cell until they do (or until the check was confident enough to
      // write the count into the draft itself). An orange shape is council / external assets:
      // no storeys, left blank and not sent.
      levels: layer.color === "orange" ? "" : layer.storeys && layer.storeys > 0 ? String(layer.storeys) : "1",
    },
    included: layer.included,
    // Red is the project site — the address the operator put in. It is drawn to show the client
    // where the job is, and is usually not itself a line item, so it starts UNTICKED; ticking it
    // is a deliberate act. Blue lots and orange assets are what gets quoted, so they start ticked.
    startSelected: layer.color !== "red",
    detail: { kind: "markup", layer },
  };
}

export function sourcesFromLayers(layers: MarkupLayer[]): LineItemSource[] {
  return layers.map(sourceFromLayer);
}
