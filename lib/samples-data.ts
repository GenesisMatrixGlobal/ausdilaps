// Server-side data for the samples pages (locked teaser + unlocked library). Both routes
// render from the same Box read, so the ISR cache is shared and a Box outage is handled in
// one place.

import { notFound } from "next/navigation";
import { listBoxFolderCategories, type BoxCategory } from "@/lib/box";
import { orderCategories, type SampleCategory } from "@/lib/samples";
import type { FaqItem } from "@/data/faq";

// Live-synced from a Box folder every 30 min (see lib/box.ts + docs/box-samples-sync.md).
// Box is the ONLY source: there is deliberately no static fallback, because the old one
// linked PDFs on the WordPress origin and those 404 now that ausdilaps.com.au points at
// Vercel. If Box can't be read the page 404s instead of showing dead links, and ISR keeps
// serving the last good render, so a transient Box outage never reaches a visitor.
const BOX_SAMPLES_FOLDER_ID = process.env.BOX_SAMPLES_FOLDER_ID ?? "405950982690";

/** Keep in sync with `export const revalidate` on both samples routes. */
export const SAMPLES_REVALIDATE = 1800;

/** A Box subfolder with this name is shown to EVERYONE, gate or not. Rhys decides the
 *  teasers by dropping files in it — nothing to change in code. Case-insensitive. */
export const PUBLIC_CATEGORY = "Public";

export async function getSampleCategories(): Promise<SampleCategory[]> {
  let live: BoxCategory[];
  try {
    live = await listBoxFolderCategories(BOX_SAMPLES_FOLDER_ID);
  } catch (e) {
    // Next signals its own control flow by throwing (dynamic-rendering bailouts,
    // notFound(), redirect()) and tags those errors with `digest`. Swallowing one
    // would silently turn a framework signal into a hard 404, so re-throw it and
    // only treat a genuine Box failure as "no samples".
    if (e && typeof e === "object" && "digest" in e) throw e;
    console.error("[samples] Box fetch failed:", e);
    notFound();
  }
  // Reachable but empty — folder cleared, or every file failed to resolve a link.
  if (live.length === 0) {
    console.error("[samples] Box returned no categories");
    notFound();
  }
  return orderCategories(live);
}

export function isPublicCategory(c: SampleCategory): boolean {
  return c.name.trim().toLowerCase() === PUBLIC_CATEGORY.toLowerCase();
}

export const SAMPLES_FAQ: FaqItem[] = [
  {
    q: "Can I see a sample dilapidation report?",
    a: "Yes. We publish real sample reports across every capture type — residential and commercial pre/post-construction surveys, GPS and council-asset surveys, roadway video, tunnels, drone, culvert, and engineering reports (DOA, SIA, DCA). Use the access code from your quote, or enter your email, to open the full library above.",
  },
  {
    q: "Is there a dilapidation report template or checklist?",
    a: "Every AusDilaps report follows a consistent, AS 4349.0-compliant structure — a description of each property, existing damage and defects recorded with severity and location, location-referenced photography, and a summary of findings with engineer sign-off. Rather than a blank template, our samples show the finished standard.",
  },
  {
    q: "What's included in a dilapidation report?",
    a: "A detailed description of each inspected structure, all existing damage and defects (cracks, settling, movement, leaks, wear), high-resolution geo-referenced photographic and video records, repair or maintenance recommendations where issues are found, and a clear summary signed off by our engineers.",
  },
  {
    q: "Can I get a sample for my specific project type?",
    a: "Yes — request the full sample pack and tell us your project type, and we'll send the most relevant examples along with our capability statement.",
  },
];
