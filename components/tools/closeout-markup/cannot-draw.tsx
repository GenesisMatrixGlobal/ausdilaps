"use client";

// Why this opportunity produced no drawing.
//
// ⚠️ This whole panel exists because the tool used to show NOTHING: the toolbar, sheet and map are
// behind `properties.length > 0`, so a job with no drawable property rendered its name and then a
// blank page. Every reason it can happen is a normal thing for a real job to be, and every fix is
// on a Salesforce record — so each work order is named by number and LINKED, because "00038597
// has no address" is only useful if you can get to 00038597.

import { cn } from "@/lib/utils";
import type { CloseoutBlocker } from "@/lib/closeout-markup/diagnose";

/**
 * A work order's Lightning URL, built off the opportunity's own.
 *
 * The host comes from `SF_LOGIN_URL`, which only the server can read — and the opportunity's URL
 * was already built there. Swapping the object and id out of it beats adding a URL field to every
 * work order in three payloads.
 */
function workOrderUrl(opportunityUrl: string | null, id: string): string | null {
  const base = opportunityUrl?.match(/^(https:\/\/[^/]+)\/lightning\/r\//)?.[1];
  return base && id ? `${base}/lightning/r/WorkOrder/${id}/view` : null;
}

export function CannotDraw({
  blocker,
  opportunityUrl,
}: {
  blocker: CloseoutBlocker;
  opportunityUrl: string | null;
}) {
  const hidden = blocker.total - blocker.items.length;

  return (
    <div className="mt-6 rounded-xl border border-ad-orange/40 bg-ad-orange/5 p-4">
      <p className="text-sm font-medium text-ad-ink">{blocker.headline}</p>
      <p className="mt-1.5 text-sm text-ad-muted">{blocker.next}</p>

      {blocker.items.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-ad-orange/20 pt-3">
          {blocker.items.map((item) => {
            const url = workOrderUrl(opportunityUrl, item.id);
            return (
              <li key={item.id} className="text-xs text-ad-muted">
                {url && item.number ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className={cn("font-medium text-ad-steel underline decoration-ad-steel/30 hover:decoration-ad-steel")}
                  >
                    {item.number}
                  </a>
                ) : (
                  <span className="font-medium text-ad-ink">{item.number ?? "No number"}</span>
                )}
                {item.street ? ` · ${item.street}` : ""}
                {` — ${item.reason}`}
              </li>
            );
          })}
          {hidden > 0 && (
            <li className="text-xs text-ad-muted">
              {`…and ${hidden} more of the same.`}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
