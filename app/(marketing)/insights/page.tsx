import type { Metadata } from "next";
import { Container } from "@/components/marketing/container";
import { PageHero } from "@/components/marketing/page-hero";
import { InsightsGrid } from "@/components/marketing/insights-grid";
import { CtaBand } from "@/components/marketing/cta-band";
import { JsonLd } from "@/components/seo/json-ld";
import { getAllInsights, INSIGHT_CATEGORIES } from "@/lib/insights";
import { breadcrumbSchema, itemListSchema } from "@/lib/seo";

const CRUMBS = [
  { name: "Home", path: "/" },
  { name: "Insights", path: "/insights" },
];

export const metadata: Metadata = {
  title: "Insights | Dilapidation Knowledge & Advocacy",
  description:
    "Insights from Australia's dilapidation specialists — what a dilapidation report is, the standards that make it defensible, and the case for compulsory condition reporting.",
  alternates: { canonical: "/insights" },
};

export default function InsightsIndexPage() {
  const insights = getAllInsights();

  return (
    <>
      <JsonLd
        data={[
          itemListSchema(insights.map((i) => ({ name: i.title, path: `/insights/${i.slug}` }))),
          breadcrumbSchema(CRUMBS),
        ]}
      />

      <PageHero
        crumbs={CRUMBS}
        eyebrow="Insights"
        title="The voice of Australian dilapidation."
        intro="Dilapidation knowledge, the standards that make a report defensible, the major projects reshaping our cities, and the case for compulsory condition reporting — from the specialists who do this work every day."
      />

      <section className="py-16 lg:py-20">
        <Container>
          {insights.length > 0 ? (
            <InsightsGrid insights={insights} categories={INSIGHT_CATEGORIES} />
          ) : (
            <p className="text-ad-muted">New insights are on the way.</p>
          )}
        </Container>
      </section>

      <CtaBand eyebrow="Talk to the specialists" />
    </>
  );
}
