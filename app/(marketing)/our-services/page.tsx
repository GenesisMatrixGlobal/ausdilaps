import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/marketing/container";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { PageHero } from "@/components/marketing/page-hero";
import { CtaBand } from "@/components/marketing/cta-band";
import { JsonLd } from "@/components/seo/json-ld";
import { SERVICES_CONTENT, SERVICE_BY_SLUG, type Service } from "@/data/services";
import { DILAPIDATION_SLUGS, SPECIALIST_SLUGS } from "@/lib/nav";
import { breadcrumbSchema, itemListSchema } from "@/lib/seo";

const CRUMBS = [
  { name: "Home", path: "/" },
  { name: "Services", path: "/our-services" },
];

const DILAPIDATION = DILAPIDATION_SLUGS.map((slug) => SERVICE_BY_SLUG[slug]);
const SPECIALIST = SPECIALIST_SLUGS.map((slug) => SERVICE_BY_SLUG[slug]);

export const metadata: Metadata = {
  title: "Our Services | Dilapidation, Structural & Specialist Building Inspections",
  description:
    "AusDilaps' specialist services — dilapidation reports (commercial, residential, industrial), structural engineering, aerial drone surveys, noise & vibration monitoring, defect assessments and road condition reports.",
  alternates: { canonical: "/our-services" },
};

function ServiceCard({ service, tone = "white" }: { service: Service; tone?: "white" | "surface" }) {
  return (
    <Link
      href={`/our-services/${service.slug}`}
      className={`group flex flex-col rounded-xl border border-ad-border p-7 transition-colors hover:border-ad-accent/40 ${
        tone === "surface" ? "bg-ad-surface" : "bg-white"
      }`}
    >
      <span
        className={`self-start rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wider text-ad-muted ${
          tone === "surface" ? "bg-white" : "bg-ad-surface"
        }`}
      >
        {service.eyebrow}
      </span>
      <h3 className="mt-5 font-heading text-lg font-semibold text-ad-ink group-hover:text-ad-accent">
        {service.h1}
      </h3>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-ad-muted">{service.summary}</p>
      <span className="mt-6 text-sm font-medium text-ad-accent">Learn more →</span>
    </Link>
  );
}

export default function ServicesIndexPage() {
  return (
    <>
      <JsonLd
        data={[
          itemListSchema([
            { name: "Dilapidation Reports", path: "/dilapidation-reports" },
            ...SERVICES_CONTENT.map((s) => ({ name: s.schemaName, path: `/our-services/${s.slug}` })),
          ]),
          breadcrumbSchema(CRUMBS),
        ]}
      />

      <PageHero
        crumbs={CRUMBS}
        eyebrow="Our Services"
        title="Specialist reports, backed by chartered engineering."
        intro="Every service is framed under one specialism — dilapidation. From a single residential build to billion-dollar infrastructure, we match the right method and the right engineer to the asset, so the record holds up when a claim is made."
      />

      {/* Flagship pillar + dilapidation by sector */}
      <section className="py-20 lg:py-24">
        <Container>
          <Link
            href="/dilapidation-reports"
            className="group block overflow-hidden rounded-2xl border border-ad-border bg-ad-navy text-ad-on-dark"
          >
            <div className="blueprint-grid">
              <div className="grid gap-6 p-8 sm:p-10 lg:grid-cols-[1.4fr_1fr] lg:items-center">
                <div>
                  <Eyebrow className="text-ad-accent-2">Flagship</Eyebrow>
                  <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight text-white">
                    Dilapidation Reports
                  </h2>
                  <p className="mt-3 max-w-xl text-ad-on-dark-muted">
                    Pre and post-construction building condition reports that document existing
                    conditions and provide a defensible baseline — residential, commercial and
                    infrastructure.
                  </p>
                </div>
                <div className="lg:text-right">
                  <span className="font-heading text-base font-semibold text-ad-accent-2 group-hover:brightness-110">
                    Explore dilapidation reports →
                  </span>
                </div>
              </div>
            </div>
          </Link>

          <div className="mt-12">
            <Eyebrow className="text-ad-accent">Dilapidation by sector</Eyebrow>
            <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {DILAPIDATION.map((s) => (
                <ServiceCard key={s.slug} service={s} tone="surface" />
              ))}
            </div>
          </div>
        </Container>
      </section>

      {/* Specialist services */}
      <section className="bg-ad-surface py-20 lg:py-24">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow className="text-ad-accent">Specialist services</Eyebrow>
            <h2 className="mt-5 font-heading text-3xl font-semibold tracking-tight text-ad-ink">
              Engineering depth beyond the baseline.
            </h2>
            <p className="mt-4 text-ad-muted">
              The assessments, surveys and engineering that surround a dilapidation programme — each
              delivered by the same chartered team.
            </p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {SPECIALIST.map((s) => (
              <ServiceCard key={s.slug} service={s} tone="white" />
            ))}
          </div>
        </Container>
      </section>

      <CtaBand eyebrow="Let's work together" />
    </>
  );
}
