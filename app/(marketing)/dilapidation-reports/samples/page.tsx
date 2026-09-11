import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/marketing/container";
import { PageHero } from "@/components/marketing/page-hero";
import { FaqSection } from "@/components/marketing/faq-accordion";
import { SamplesLibrary } from "@/components/marketing/samples-library";
import { JsonLd } from "@/components/seo/json-ld";
import { faqPageSchema, breadcrumbSchema } from "@/lib/seo";
import { SITE } from "@/lib/site";
import type { FaqItem } from "@/data/faq";
import { listBoxFolderCategories, type BoxCategory } from "@/lib/box";
import { orderCategories } from "@/lib/samples";

const CRUMBS = [
  { name: "Home", path: "/" },
  { name: "Dilapidation Reports", path: "/dilapidation-reports" },
  { name: "Samples", path: "/dilapidation-reports/samples" },
];

export const metadata: Metadata = {
  title: "Sample Dilapidation Reports | Examples, Formats & What's Included",
  description:
    "View real AusDilaps sample dilapidation reports across every capture type — residential, commercial, GPS, council assets, roadway video, tunnels, drone, culvert, plus DOA, SIA and DCA engineering reports.",
  alternates: { canonical: "/dilapidation-reports/samples" },
};

// Live-synced from a Box folder every 30 min (see lib/box.ts + docs/box-samples-sync.md).
// Drop a file into a category subfolder in Box and it shows up here on the next
// revalidation — no redeploy needed. Box is the ONLY source: there is deliberately
// no static fallback, because the old one linked PDFs on the WordPress origin and
// those 404 the moment ausdilaps.com.au points at Vercel. If Box can't be read the
// page 404s instead of showing dead links, and ISR keeps serving the last good
// render, so a transient Box outage never reaches a visitor.
//
// This page is a LIBRARY, not a landing page. Whoever is here most likely already has a
// quote and wants to see what the deliverable looks like — so there is no "Request a
// Quote" button on the page itself (the site header still carries one), just phone and
// email for anyone who can't find the sample they need.
const BOX_SAMPLES_FOLDER_ID = process.env.BOX_SAMPLES_FOLDER_ID ?? "405950982690";
export const revalidate = 1800;

async function getCategories(): Promise<BoxCategory[]> {
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
  return live;
}

const SAMPLES_FAQ: FaqItem[] = [
  {
    q: "Can I see a sample dilapidation report?",
    a: "Yes. We publish real sample reports across every capture type — residential and commercial pre/post-construction surveys, GPS and council-asset surveys, roadway video, tunnels, drone, culvert, and engineering reports (DOA, SIA, DCA). Browse them above.",
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

export default async function SamplesPage() {
  const categories = orderCategories(await getCategories());
  const phoneHref = `tel:${SITE.phone.replace(/\s/g, "")}`;

  return (
    <>
      <JsonLd data={[faqPageSchema(SAMPLES_FAQ), breadcrumbSchema(CRUMBS)]} />

      <PageHero
        crumbs={CRUMBS}
        eyebrow="Dilapidation Reports · Samples"
        title="Sample reports."
        intro="Real AusDilaps reports across every capture type — pick a category, then open a sample in Box's viewer."
        actions={
          <p className="text-sm text-ad-muted">
            Questions about your quote?{" "}
            <a href={phoneHref} className="font-medium text-ad-ink underline-offset-4 hover:underline">
              {SITE.phone}
            </a>{" "}
            or{" "}
            <a
              href={`mailto:${SITE.email}`}
              className="font-medium text-ad-ink underline-offset-4 hover:underline"
            >
              {SITE.email}
            </a>
          </p>
        }
      />

      <section className="py-12 lg:py-16">
        <Container className="max-w-4xl">
          <SamplesLibrary categories={categories} />
        </Container>
      </section>

      <FaqSection items={SAMPLES_FAQ} heading="Sample reports, answered." seeAllHref="/faq" />

      {/* Quiet contact band — no orange quote button. Sample readers usually have a quote. */}
      <section className="bg-ad-navy-deep py-16 text-ad-on-dark lg:py-20">
        <Container className="text-center">
          <h2 className="mx-auto max-w-2xl text-balance font-heading text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Can&rsquo;t find the sample you need?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-ad-on-dark-muted">
            Tell us your project type and we&rsquo;ll send the closest examples.
          </p>
          <p className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-base font-medium">
            <a href={phoneHref} className="text-white hover:text-ad-accent-2">
              {SITE.phone}
            </a>
            <a href={`mailto:${SITE.email}`} className="text-white hover:text-ad-accent-2">
              {SITE.email}
            </a>
          </p>
        </Container>
      </section>
    </>
  );
}
