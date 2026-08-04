import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/marketing/container";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { PageHero } from "@/components/marketing/page-hero";
import { ContentSection } from "@/components/marketing/content-section";
import { PortfolioCard } from "@/components/marketing/portfolio-card";
import { CtaBand } from "@/components/marketing/cta-band";
import { JsonLd } from "@/components/seo/json-ld";
import { PORTFOLIO, PORTFOLIO_BY_SLUG, PORTFOLIO_SLUGS } from "@/data/portfolio";
import { projectSchema, breadcrumbSchema } from "@/lib/seo";

export function generateStaticParams() {
  return PORTFOLIO_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const p = PORTFOLIO_BY_SLUG[slug];
  if (!p) return {};
  return {
    title: `${p.name} | AusDilaps Project`,
    description: p.blurb,
    alternates: { canonical: `/portfolio/${p.slug}` },
  };
}

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = PORTFOLIO_BY_SLUG[slug];
  if (!p) notFound();

  const path = `/portfolio/${p.slug}`;
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Portfolio", path: "/portfolio" },
    { name: p.name, path },
  ];
  const facts = [
    p.client && { label: "Client", value: p.client },
    { label: "Location", value: p.location },
    p.year && { label: "Year", value: p.year },
    p.value && { label: "Project value", value: p.value },
  ].filter(Boolean) as { label: string; value: string }[];

  const related = PORTFOLIO.filter((x) => x.sector === p.sector && x.slug !== p.slug).slice(0, 3);

  return (
    <>
      <JsonLd
        data={[
          projectSchema({
            name: p.name,
            description: p.blurb,
            path,
            image: p.image,
            client: p.client,
            location: p.location,
          }),
          breadcrumbSchema(crumbs),
        ]}
      />

      <PageHero
        crumbs={crumbs}
        eyebrow={p.sector}
        title={p.name}
        intro={p.description ?? p.blurb}
      />

      {/* Fast facts */}
      <section className="border-b border-ad-border bg-ad-surface py-8">
        <Container>
          <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {facts.map((f) => (
              <div key={f.label}>
                <dt className="text-xs font-medium uppercase tracking-wider text-ad-muted">{f.label}</dt>
                <dd className="mt-1 font-heading text-base font-semibold text-ad-ink">{f.value}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </section>

      {/* Scope / solution */}
      {p.scope && (
        <ContentSection
          eyebrow={p.isCaseStudy ? "Our solution" : "Our scope"}
          heading={p.isCaseStudy ? "How we delivered it." : "What AusDilaps delivered."}
          body={p.scope}
          variant="light"
        />
      )}

      {/* Stats band */}
      {p.stats && p.stats.length > 0 && (
        <section className="bg-ad-navy py-16 text-ad-on-dark lg:py-20">
          <Container>
            <Eyebrow className="text-ad-accent-2">By the numbers</Eyebrow>
            <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {p.stats.map((s) => (
                <div key={s.label}>
                  <div className="font-heading text-4xl font-bold tracking-tight text-white">{s.value}</div>
                  <div className="rule-accent mt-3 w-10" />
                  <div className="mt-3 text-sm text-ad-on-dark-muted">{s.label}</div>
                </div>
              ))}
            </div>
          </Container>
        </section>
      )}

      {/* Related projects */}
      {related.length > 0 && (
        <section className="bg-ad-surface py-20 lg:py-24">
          <Container>
            <div className="max-w-2xl">
              <Eyebrow className="text-ad-accent">More {p.sector.toLowerCase()}</Eyebrow>
              <h2 className="mt-5 font-heading text-3xl font-semibold tracking-tight text-ad-ink">
                Related projects.
              </h2>
            </div>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((r) => (
                <PortfolioCard key={r.slug} project={r} />
              ))}
            </div>
          </Container>
        </section>
      )}

      <CtaBand
        heading="Have a project like this?"
        subhead="Tell us the project, location and adjoining properties — we'll scope it."
        secondary={false}
        size="md"
      />
    </>
  );
}
