"use client";

// Everything the automatic pass could not draw, in one place, each with a link to look at.
//
// Two kinds, and they are different, so they are labelled separately rather than merged into
// one count:
//
//   Council assets — a stretch of kerb, verge or roadway. Not a failure: it has no title
//     boundary to look up, and its address is only ever the nearest one, so the parcel there
//     belongs to a private property it merely runs past.
//   Couldn't be placed — a real property inspection whose work order has no usable location,
//     or whose address is not an address at all.
//
// Both end the same way: the operator opens the reference and draws it with the shape tools.
// The cover photo is that reference — it is the report's front page for that work order, with
// the asset already drawn on it — and the geometry behind it is not recorded anywhere (no
// EXIF, no sidecar, no coordinate field), which is why this is a link to look at rather than
// something the tool replicates.

import { INSPECTION_LEGEND, type CouncilAsset, type UnmappedWorkOrder } from "@/lib/closeout-markup/types";
import { MARKUP_STYLES } from "@/lib/kml/standard-markup/style";

function ViewLink({ cover, markup }: { cover: string | null; markup: string | null }) {
  // ⚠️ ONE link, cover photo first. Measured over five real jobs (160 council assets): 83% have
  // a cover photo, which is per work order and opens straight to the image. Site_Mark_Ups__c is
  // often job-level — 34 assets on the Hunter Street job share THREE markup URLs — so offering
  // both would put the same link on 34 rows and bury the one about this asset. It is the
  // fallback, and covers another 10%.
  const href = cover ?? markup;
  if (!href) return <span className="text-xs text-ad-muted">No reference image</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="shrink-0 rounded-md border border-ad-border px-2 py-0.5 text-xs font-medium text-ad-steel hover:border-ad-steel hover:text-ad-ink"
    >
      {cover ? "View cover photo" : "View site markup"}
    </a>
  );
}

function Row({
  title,
  detail,
  swatch,
  cover,
  markup,
}: {
  title: string;
  detail: string;
  swatch?: { fill: string; stroke: string };
  cover: string | null;
  markup: string | null;
}) {
  return (
    <li className="flex items-start gap-2 border-t border-ad-border py-2 first:border-0">
      {swatch && (
        <span
          aria-hidden
          className="mt-1 inline-block size-3 shrink-0 rounded-full border-2"
          style={{ backgroundColor: `#${swatch.fill}`, borderColor: `#${swatch.stroke}` }}
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ad-ink" title={title}>
          {title}
        </p>
        <p className="text-xs text-ad-muted">{detail}</p>
      </div>
      <ViewLink cover={cover} markup={markup} />
    </li>
  );
}

export function DrawByHand({
  councilAssets,
  unmapped,
}: {
  councilAssets: CouncilAsset[];
  unmapped: UnmappedWorkOrder[];
}) {
  if (councilAssets.length === 0 && unmapped.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-ad-border bg-white">
      <div className="border-b border-ad-border px-4 py-3">
        <p className="text-sm font-medium text-ad-ink">Draw these by hand</p>
        <p className="mt-0.5 text-xs text-ad-muted">
          Open the reference, then draw the extent on the map with the shape tools.
        </p>
      </div>

      <div className="px-4 py-2">
        {councilAssets.length > 0 && (
          <>
            <p className="pt-1 text-xs font-medium uppercase tracking-wide text-ad-muted">
              Council assets · {councilAssets.length}
            </p>
            <ul>
              {councilAssets.map((a) => (
                <Row
                  key={a.workOrderId}
                  title={a.street}
                  detail={[a.suburb, INSPECTION_LEGEND[a.color], a.workType, a.number].filter(Boolean).join(" · ")}
                  swatch={MARKUP_STYLES[a.color]}
                  cover={a.coverPhotoUrl}
                  markup={a.siteMarkupUrl}
                />
              ))}
            </ul>
          </>
        )}

        {unmapped.length > 0 && (
          <>
            <p className={`${councilAssets.length > 0 ? "mt-4 " : ""}pt-1 text-xs font-medium uppercase tracking-wide text-ad-muted`}>
              Couldn&apos;t be placed · {unmapped.length}
            </p>
            <ul>
              {unmapped.map((u) => (
                <Row
                  key={u.id}
                  title={u.street ?? u.number ?? u.id}
                  detail={[u.reason, u.number].filter(Boolean).join(" · ")}
                  cover={u.coverPhotoUrl}
                  markup={u.siteMarkupUrl}
                />
              ))}
            </ul>
          </>
        )}
      </div>
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
