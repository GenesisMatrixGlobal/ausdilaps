import type { Metadata } from "next";
import { Container } from "@/components/marketing/container";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { PageHero } from "@/components/marketing/page-hero";
import { FaqSection } from "@/components/marketing/faq-accordion";
import { CtaBand } from "@/components/marketing/cta-band";
import { JsonLd } from "@/components/seo/json-ld";
import { faqPageSchema, breadcrumbSchema } from "@/lib/seo";
import type { FaqItem } from "@/data/faq";
import { listBoxFolderSamples, type BoxSample } from "@/lib/box";

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
// Add/remove a file in that folder and it shows up here on the next revalidation —
// no redeploy needed. Falls back to this static list if Box is unreachable or not
// yet configured, so the page never breaks or goes empty.
const BOX_SAMPLES_FOLDER_ID = process.env.BOX_SAMPLES_FOLDER_ID ?? "302747543374";
export const revalidate = 1800;

const LIVE = "https://ausdilaps.com.au/wp-content/uploads";
const FALLBACK_SAMPLES: BoxSample[] = [
  { name: "Capability Statement", url: `${LIVE}/2026/04/AusDilaps-Capability-Statement-FY25-26.pdf` },
  { name: "Methodology Statement", url: `${LIVE}/2025/09/AusDilaps-Methodology-FY25-26.pdf` },
  { name: "Access Letter sample", url: `${LIVE}/2025/07/AusDilaps-Sample-Access-Letter-2025.pdf` },
  { name: "Commercial — Pre-construction", url: `${LIVE}/2025/04/AusDilaps-Sample-Commercial-Pre-Report.pdf` },
  { name: "Commercial — Post-construction", url: `${LIVE}/2025/04/AusDilaps-Sample-Commercial-Post.pdf` },
  { name: "Residential — Pre-construction", url: `${LIVE}/2025/04/AusDilaps-Sample-Residential-Pre.pdf` },
  { name: "Residential — Post-construction", url: `${LIVE}/2023/10/AD-Residential-Sample-Report-POST-2020.pdf` },
  { name: "Defect-marked Floor Plan", url: `${LIVE}/2025/04/AusDilaps-Sample-Defect-Floor-Plan.pdf` },
  { name: "GPS — Commercial External", url: `${LIVE}/2025/04/AusDilaps-Sample-GPS-External.pdf` },
  { name: "GPS — Council Assets", url: `${LIVE}/2024/11/Sample-Council-Assets.pdf` },
  { name: "Roadways — Video Report", url: `${LIVE}/2026/04/AusDilaps-Sample-2026-Video-Report.pdf` },
  { name: "Rail Corridor", url: `${LIVE}/2023/04/AD-Rail-Corridor-Sample-Report-2020.pdf` },
  { name: "Tunnels", url: `${LIVE}/2025/04/AusDilaps-Sample-Tunnel.pdf` },
  { name: "Train Station (GPS)", url: `${LIVE}/2026/04/AusDilaps-Sample-2026-Train-Station-GPS.pdf` },
  { name: "Drone — Rural (with GPS)", url: `${LIVE}/2025/04/AusDilaps-Sample-Drone-Rural.pdf` },
  { name: "Culvert & Pipe", url: `${LIVE}/2025/07/AusDilaps-Sample-Culvert-2025.pdf` },
  { name: "DOA — Defect Origin Assessment", url: `${LIVE}/2025/09/AusDilaps-Sample-DOA-2025.pdf` },
  { name: "SIA — Structural Integrity Assessment", url: `${LIVE}/2026/04/AusDilaps-Sample-2026-SIA.pdf` },
  { name: "DCA — Defect Comparison Assessment", url: `${LIVE}/2025/04/AusDilaps-Sample-Defect-Comparison-Assessment-DCA.pdf` },
];

function titleFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
}

async function getSamples(): Promise<BoxSample[]> {
  try {
    const live = await listBoxFolderSamples(BOX_SAMPLES_FOLDER_ID);
    return live.length > 0 ? live : FALLBACK_SAMPLES;
  } catch (e) {
    console.error("[samples] Box fetch failed, using fallback list:", e);
    return FALLBACK_SAMPLES;
  }
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
  const samples = await getSamples();

  return (
    <>
      <JsonLd data={[faqPageSchema(SAMPLES_FAQ), breadcrumbSchema(CRUMBS)]} />

      <PageHero
        crumbs={CRUMBS}
        eyebrow="Dilapidation Reports · Samples"
        title="Sample dilapidation reports."
        intro="See the standard for yourself. We publish real sample reports across every capture type — from residential and commercial surveys to drone, tunnel, roadway and engineering reports. Every one is AS 4349.0-compliant, with location-referenced imagery and engineer sign-off."
      />

      <section className="py-16 lg:py-20">
        <Container className="max-w-3xl">
          <Eyebrow className="text-ad-accent">Sample reports</Eyebrow>
          <div className="mt-6 divide-y divide-ad-border rounded-xl border border-ad-border bg-white">
            {samples.map((s) => (
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
            Request access and we'll share live interactive examples relevant to your project.
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
