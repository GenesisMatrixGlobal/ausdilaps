import type { Metadata } from "next";
import { Container } from "@/components/marketing/container";
import { PageHero } from "@/components/marketing/page-hero";
import { PortfolioGrid } from "@/components/marketing/portfolio-grid";
import { CtaBand } from "@/components/marketing/cta-band";
import { JsonLd } from "@/components/seo/json-ld";
import { PORTFOLIO, SECTORS } from "@/data/portfolio";
import { breadcrumbSchema, itemListSchema } from "@/lib/seo";

const CRUMBS = [
  { name: "Home", path: "/" },
  { name: "Portfolio", path: "/portfolio" },
];

export const metadata: Metadata = {
  title: "Portfolio | Tier 1 Dilapidation Projects Across Australia",
  description:
    "AusDilaps' project portfolio — dilapidation reporting on Australia's most scrutinised infrastructure: NorthConnex, WestConnex, North West Rail Link, Barangaroo, Queen's Wharf, major hospitals, defence and government works.",
  alternates: { canonical: "/portfolio" },
};

export default function PortfolioIndexPage() {
  return (
    <>
      <JsonLd
        data={[
          itemListSchema(PORTFOLIO.map((p) => ({ name: p.name, path: `/portfolio/${p.slug}` }))),
          breadcrumbSchema(CRUMBS),
        ]}
      />

      <PageHero
        crumbs={CRUMBS}
        eyebrow="Portfolio"
        title="The projects that built our reputation."
        intro="Dilapidation reporting on Australia's most scrutinised projects — road, rail, hospitals, defence, government, commercial and energy. From a few heritage-listed buildings to 6,000+ properties along a motorway, every record is built to survive a claim."
      />

      <section className="py-20 lg:py-24">
        <Container>
          <PortfolioGrid projects={PORTFOLIO} sectors={SECTORS} />
        </Container>
      </section>

      <CtaBand eyebrow="Put us on your next project" />
    </>
  );
}
