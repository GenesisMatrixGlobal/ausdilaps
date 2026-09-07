import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/marketing/container";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { PageHero } from "@/components/marketing/page-hero";
import { FaqSection } from "@/components/marketing/faq-accordion";
import { CtaBand } from "@/components/marketing/cta-band";
import { JsonLd } from "@/components/seo/json-ld";
import { faqPageSchema, breadcrumbSchema } from "@/lib/seo";
import type { FaqItem } from "@/data/faq";
import { listBoxFolderCategories, type BoxCategory } from "@/lib/box";

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
const BOX_SAMPLES_FOLDER_ID = process.env.BOX_SAMPLES_FOLDER_ID ?? "405950982690";
export const revalidate = 1800;

function titleFromFilename(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

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
  const categories = await getCategories();

  return (
    <>
      <JsonLd data={[faqPageSchema(SAMPLES_FAQ), breadcrumbSchema(CRUMBS)]} />

      <PageHero
        crumbs={CRUMBS}
        eyebrow="Dilapidation Reports · Samples"
        title="Sample dilapidation reports."
        intro="See the standard for yourself. We publish real sample reports across every capture type — from residential and commercial surveys to drone, tunnel, roadway and engineering reports. Every one is AS 4349.0-compliant, with location-referenced imagery and engineer sign-off."
      />

      {/* Jump nav — lets you skip straight to a category instead of scrolling past everything */}
      <section className="border-b border-ad-border py-5">
        <Container>
          <nav aria-label="Sample categories" className="flex flex-wrap gap-x-6 gap-y-2">
            {categories.map((category) => (
              <a
                key={category.name}
                href={`#${slugify(category.name)}`}
                className="text-sm font-medium text-ad-muted transition-colors hover:text-ad-accent"
              >
                {category.name}
              </a>
            ))}
          </nav>
        </Container>
      </section>

      <section className="py-16 lg:py-20">
        <Container className="max-w-3xl space-y-14">
          {categories.map((category) => (
            <div key={category.name} id={slugify(category.name)} className="scroll-mt-24">
              <Eyebrow className="text-ad-accent">{category.name}</Eyebrow>
              <div className="mt-6 divide-y divide-ad-border rounded-xl border border-ad-border bg-white">
                {category.samples.map((s) => (
                  <a
                    key={s.url}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-ad-surface sm:px-6"
                  >
                    <h3 className="font-heading text-[0.95rem] font-semibold text-ad-ink group-hover:text-ad-accent">
                      {titleFromFilename(s.name)}
                    </h3>
                    <span className="shrink-0 text-sm font-medium text-ad-accent">View →</span>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </Container>
      </section>

      {/* LiDAR / 3D interactive note */}
      <section className="bg-ad-navy py-16 text-ad-on-dark lg:py-20">
        <Container className="max-w-3xl">
          <Eyebrow className="text-ad-accent-2">Point cloud, LiDAR & 3D</Eyebrow>
          <h2 className="mt-5 font-heading text-3xl font-semibold tracking-tight text-white">
            Interactive LiDAR and digital-twin samples.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-ad-on-dark-muted">
            For large or complex assets we capture LiDAR point clouds and build navigable 3D models and
            digital twins — letting you inspect a highway, road corridor or building from any angle.
            Request access and we&rsquo;ll share live interactive examples relevant to your project.
          </p>
        </Container>
      </section>

      <FaqSection items={SAMPLES_FAQ} heading="Sample reports, answered." seeAllHref="/faq" />

      <CtaBand
        eyebrow="See more"
        heading="Want the full sample pack for your project type?"
        subhead="Tell us your project type and we'll send the most relevant samples with our capability statement."
      />
    </>
  );
}
