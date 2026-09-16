"use client";

// Council / external assets — the ones the operator draws by hand, with the references to
// draw them from.
//
// Why a list and not a shape on the map: a council asset is a stretch of kerb, verge or
// roadway. It has no title boundary, and its address is only ever the nearest one — so looking
// up the parcel there returns a private lot, and colouring that lot would put someone's house
// on a client's drawing as council infrastructure.
//
// The shape itself exists only as pixels in a report image. Nothing in Salesforce or Box
// records where those pixels sit on Earth — no EXIF, no sidecar, no KML field — so it cannot
// be replicated automatically without guessing, and a guess that puts a kerb ribbon on the
// wrong side of the road is worse than no ribbon. Opening the reference and drawing it takes
// seconds and is exact.

import { INSPECTION_LEGEND, type CouncilAsset } from "@/lib/closeout-markup/types";
import { MARKUP_STYLES } from "@/lib/kml/standard-markup/style";

function ReferenceLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-md border border-ad-border px-2 py-0.5 text-xs text-ad-steel hover:border-ad-steel hover:text-ad-ink"
    >
      {children}
    </a>
  );
}

export function CouncilAssets({ assets }: { assets: CouncilAsset[] }) {
  if (assets.length === 0) return null;

  return (
    <div className="rounded-xl border border-ad-border bg-white p-4">
      <p className="text-sm font-medium text-ad-ink">
        Council assets{assets.length > 1 ? ` · ${assets.length}` : ""}
      </p>
      <p className="mt-1 text-xs text-ad-muted">
        No title boundary to look up — open a reference and draw the extent with the shape tools.
      </p>

      <ul className="mt-3 space-y-2.5">
        {assets.map((a) => (
          <li key={a.workOrderId} className="border-t border-ad-border pt-2.5 first:border-0 first:pt-0">
            <div className="flex items-start gap-2">
              <span
                aria-hidden
                title={INSPECTION_LEGEND[a.color]}
                className="mt-1 inline-block size-3 shrink-0 rounded-full border-2"
                style={{
                  backgroundColor: `#${MARKUP_STYLES[a.color].fill}`,
                  borderColor: `#${MARKUP_STYLES[a.color].stroke}`,
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ad-ink" title={a.street}>
                  {a.street}
                </p>
                <p className="text-xs text-ad-muted">
                  {[a.suburb, INSPECTION_LEGEND[a.color], a.number].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5 pl-5">
              {/*
                ⚠️ ONE link, and the cover photo wins it.
                Measured across five real jobs (160 council assets): 83% have a cover photo,
                which is per work order and opens straight to the image. `Site_Mark_Ups__c` is
                often job-level instead — 34 assets on the Hunter Street job share THREE markup
                URLs — so showing both would put the same link on 34 rows and bury the one that
                is actually about this asset. It stays as the fallback, which is the only
                reference for another 10%.
              */}
              {a.coverPhotoUrl ? (
                <ReferenceLink href={a.coverPhotoUrl}>Cover photo</ReferenceLink>
              ) : a.siteMarkupUrl ? (
                <ReferenceLink href={a.siteMarkupUrl}>Site markup</ReferenceLink>
              ) : (
                <span className="text-xs text-ad-muted">No reference image on this work order</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The colours a Closeout Markup's legend can explain, for the shape picker — so a hand-drawn
 *  council asset is coloured by whether it was inspected, not by the markup tabs' meanings
 *  (where orange is "Council / External Assets" and here it is "Pending"). */
export const CLOSEOUT_SHAPE_PALETTE = (["green", "red", "orange", "partial"] as const).map((key) => ({
  key,
  label: INSPECTION_LEGEND[key],
  hint: `Legend: ${INSPECTION_LEGEND[key]}`,
}));
