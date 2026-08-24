import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/marketing/container";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { PageHero } from "@/components/marketing/page-hero";
import { ContentSection } from "@/components/marketing/content-section";
import { FaqSection } from "@/components/marketing/faq-accordion";
import { PortfolioCard } from "@/components/marketing/portfolio-card";
import { RelatedLinks, type RelatedLink } from "@/components/marketing/related-links";
import { CtaBand } from "@/components/marketing/cta-band";
import { Button } from "@/components/ui/button";
import { JsonLd } from "@/components/seo/json-ld";
import { LOCATION_BY_SLUG, LOCATION_SLUGS, LOCATIONS } from "@/data/locations";
import { PORTFOLIO_BY_SLUG } from "@/data/portfolio";
import { SITE, PROCESS, CAPTURE_METHODS } from "@/lib/site";
import {
  localBusinessForCity,
  serviceSchema,
  howToSchema,
  faqPageSchema,
  breadcrumbSchema,
} from "@/lib/seo";

export function generateStaticParams() {
  return LOCATION_SLUGS.map((location) => ({ location }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ location: string }>;
}): Promise<Metadata> {
  const { location } = await params;
  const loc = LOCATION_BY_SLUG[location];
  if (!loc) return {};
  return {
    title: loc.title,
    description: loc.metaDescription,
    alternates: { canonical: `/dilapidation-reports/${loc.slug}` },
  };
}

export default async function LocationPage({
  params,
}: {
  params: Promise<{ location: string }>;
}) {
  const { location } = await params;
  const loc = LOCATION_BY_SLUG[location];
  if (!loc) notFound();

  const path = `/dilapidation-reports/${loc.slug}`;
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Dilapidation Reports", path: "/dilapidation-reports" },
    { name: loc.city, path },
  ];
  const localProjects = loc.localProjects.map((s) => PORTFOLIO_BY_SLUG[s]).filter(Boolean);

  const related: RelatedLink[] = [
    {
      label: "Dilapidation Reports",
      href: "/dilapidation-reports",
      description: "The full guide — what a dilapidation report is, what's included and when you need one.",
    },
    ...LOCATIONS.filter((l) => l.slug !== loc.slug).map((l) => ({
      label: `Dilapidation Reports ${l.city}`,
      href: `/dilapidation-reports/${l.slug}`,
      description: l.region,
    })),
  ];

  return (
    <>
      <JsonLd
        data={[
          localBusinessForCity({ city: loc.city, region: loc.region, path }),
          serviceSchema(`Dilapidation Reports ${loc.city}`, loc.metaDescription, path),
          howToSchema("How a dilapidation report is delivered", PROCESS),
          faqPageSchema(loc.faq),
          breadcrumbSchema(crumbs),
        ]}
      />

      <PageHero
        crumbs={crumbs}
        eyebrow={`Dilapidation Reports · ${loc.state}`}
        title={loc.h1}
        intro={loc.intro}
      />

      {/* Why — local context + drivers */}
      <ContentSection
        eyebrow={`Why ${loc.city}`}
        heading={loc.why.heading}
        body={loc.why.body}
        bullets={loc.drivers}
        layout="split"
        variant="light"
      />

      {/* Local proof */}
      {localProjects.length >= 2 ? (
        <section className="bg-ad-surface py-20 lg:py-24">
          <Container>
            <div className="max-w-2xl">
              <Eyebrow className="text-ad-accent">Proven in {loc.region}</Eyebrow>
              <h2 className="mt-5 font-heading text-3xl font-semibold tracking-tight text-ad-ink">
                {loc.city} projects we&rsquo;ve documented.
              </h2>
              <p className="mt-4 text-ad-muted">{loc.serviceNote}</p>
            </div>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {localProjects.map((p) => (
                <PortfolioCard key={p.slug} project={p} />
              ))}
            </div>
          </Container>
        </section>
      ) : (
        <section className="bg-ad-surface py-20 lg:py-24">
          <Container className="max-w-3xl">
            <Eyebrow className="text-ad-accent">Our reach</Eyebrow>
            <h2 className="mt-5 font-heading text-3xl font-semibold tracking-tight text-ad-ink">
              A national specialist on your {loc.city} project.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-ad-muted">{loc.serviceNote}</p>
            {localProjects.length === 1 && (
              <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                <PortfolioCard project={localProjects[0]} />
              </div>
            )}
            <div className="mt-8">
              <Button href="/portfolio" variant="outline">
                View our national portfolio
              </Button>
            </div>
          </Container>
        </section>
      )}

      {/* Methodology (HowTo) */}
      <ContentSection
        eyebrow="How it's delivered"
        heading="Our 6-step methodology."
        body={`Every report is compliant with Australian Standard ${SITE.standard}.`}
        cards={PROCESS.map((s) => ({ n: s.n, title: s.title, body: s.body }))}
        variant="dark"
      />

      {/* Capture methods */}
      <ContentSection
        eyebrow="Evidentiary-grade capture"
        heading="The right technique for every asset."
        body="From a single residential build to major infrastructure, we match the capture method to the asset so the record is defensible."
        chips={CAPTURE_METHODS}
        layout="split"
        variant="surface"
      />

      {/* Local FAQ */}
      <FaqSection items={loc.faq} heading={`Dilapidation reports in ${loc.city}, answered.`} />

      <RelatedLinks heading="Dilapidation reports near you" links={related} variant="light" />

      <CtaBand
        heading={`Need a dilapidation report in ${loc.city}?`}
        subhead="Tell us the project, location and adjoining properties — we'll scope it."
        secondary={false}
        size="md"
      />
    </>
  );
}
