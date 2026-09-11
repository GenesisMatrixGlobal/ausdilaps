import type { Metadata } from "next";
import { FaqSection } from "@/components/marketing/faq-accordion";
import { SamplesLibrary } from "@/components/marketing/samples-library";
import {
  SamplesContactBand,
  SamplesHeader,
  SAMPLES_CRUMBS,
} from "@/components/marketing/samples-page-parts";
import { SamplesUnlock } from "@/components/marketing/samples-unlock";
import { JsonLd } from "@/components/seo/json-ld";
import { faqPageSchema, breadcrumbSchema } from "@/lib/seo";
import {
  getSampleCategories,
  isPublicCategory,
  SAMPLES_FAQ,
  SAMPLES_REVALIDATE,
} from "@/lib/samples-data";

export const metadata: Metadata = {
  title: "Sample Dilapidation Reports | Examples, Formats & What's Included",
  description:
    "View real AusDilaps sample dilapidation reports across every capture type — residential, commercial, GPS, council assets, roadway video, tunnels, drone, culvert, plus DOA, SIA and DCA engineering reports.",
  alternates: { canonical: "/dilapidation-reports/samples" },
};

// This is the LOCKED view and the only one Google sees. A visitor with the access cookie
// never renders it — proxy.ts rewrites them to ./library. It stays a static ISR page: it
// reads neither cookies nor searchParams (the unlock form's error message is read from the
// URL in the browser), so a Box outage still serves the last good render.
//
// What it shows: anything in Box's "Public" subfolder, fully open; every other category
// as a name and a count with no links; and the two ways in — the code from a quote, or an
// email. People opening samples usually already hold a quote, so there is no "Request a
// Quote" button on the page itself (the site header still carries one).
export const revalidate = SAMPLES_REVALIDATE;

export default async function SamplesPage() {
  const categories = await getSampleCategories();
  const open = categories.filter(isPublicCategory);
  const locked = categories.filter((c) => !isPublicCategory(c));
  const lockedCount = locked.reduce((n, c) => n + c.items.length, 0);

  return (
    <>
      <JsonLd data={[faqPageSchema(SAMPLES_FAQ), breadcrumbSchema(SAMPLES_CRUMBS)]} />

      <SamplesHeader>
        <SamplesUnlock />

        {open.length > 0 && (
          <div className="mt-10">
            <SamplesLibrary categories={open} />
          </div>
        )}

        {locked.length > 0 && (
          <section className="mt-10" aria-labelledby="locked-heading">
            <div className="flex items-baseline justify-between gap-4">
              <h2
                id="locked-heading"
                className="font-heading text-lg font-semibold tracking-tight text-ad-ink"
              >
                In the library
              </h2>
              <span className="text-sm text-ad-muted">
                {lockedCount} {lockedCount === 1 ? "file" : "files"}
              </span>
            </div>
            <ul className="mt-3 divide-y divide-ad-border rounded-xl border border-ad-border bg-white">
              {locked.map((c) => (
                <li key={c.name} className="flex items-center gap-3 px-4 py-2.5 sm:gap-4 sm:px-5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ad-surface text-ad-muted">
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                    >
                      <rect x="5" y="10.5" width="14" height="10" rx="1.5" />
                      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1 truncate font-heading text-[0.95rem] font-medium text-ad-ink">
                    {c.name}
                  </span>
                  <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-ad-muted">
                    {c.items.length} {c.items.length === 1 ? "file" : "files"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </SamplesHeader>

      <FaqSection items={SAMPLES_FAQ} heading="Sample reports, answered." seeAllHref="/faq" />
      <SamplesContactBand />
    </>
  );
}
