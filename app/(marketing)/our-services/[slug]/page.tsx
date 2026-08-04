import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/seo/json-ld";
import { PageHero } from "@/components/marketing/page-hero";
import { ContentSection } from "@/components/marketing/content-section";
import { FaqSection } from "@/components/marketing/faq-accordion";
import { RelatedLinks, type RelatedLink } from "@/components/marketing/related-links";
import { CtaBand } from "@/components/marketing/cta-band";
import { SERVICE_BY_SLUG, SERVICE_SLUGS, type Service } from "@/data/services";
import { FAQ, type FaqItem } from "@/data/faq";
import { serviceSchema, faqPageSchema, breadcrumbSchema } from "@/lib/seo";

export function generateStaticParams() {
  return SERVICE_SLUGS.map((slug) => ({ slug }));
}

function faqItemsFor(service: Service): FaqItem[] {
  if (service.faqInline) return service.faqInline;
  if (service.faqId) return FAQ.find((c) => c.id === service.faqId)?.items ?? [];
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const service = SERVICE_BY_SLUG[slug];
  if (!service) return {};
  return {
    title: service.title,
    description: service.metaDescription,
    alternates: { canonical: `/our-services/${service.slug}` },
  };
}

export default async function ServicePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const service = SERVICE_BY_SLUG[slug];
  if (!service) notFound();

  const path = `/our-services/${service.slug}`;
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Services", path: "/our-services" },
    { name: service.h1, path },
  ];
  const faqItems = faqItemsFor(service);

  const related: RelatedLink[] = service.related.map((rel) => {
    if (rel === "dilapidation-reports") {
      return {
        label: "Dilapidation Reports",
        href: "/dilapidation-reports",
        description: "Pre- and post-construction building condition reports — the flagship service.",
      };
    }
    const s = SERVICE_BY_SLUG[rel];
    return { label: s.h1, href: `/our-services/${s.slug}`, description: s.summary };
  });

  return (
    <>
      <JsonLd
        data={[
          serviceSchema(service.schemaName, service.metaDescription, path),
          ...(faqItems.length ? [faqPageSchema(faqItems)] : []),
          breadcrumbSchema(crumbs),
        ]}
      />

      <PageHero crumbs={crumbs} eyebrow={service.eyebrow} title={service.h1} intro={service.intro} />

      {service.sections.map((section, i) => (
        <ContentSection key={section.id ?? `${service.slug}-${i}`} {...section} />
      ))}

      {faqItems.length > 0 && (
        <FaqSection
          items={faqItems}
          heading={`${service.h1}, answered.`}
          seeAllHref={service.faqId ? "/faq" : null}
        />
      )}

      <RelatedLinks
        heading="Related services"
        links={related}
        variant={faqItems.length ? "light" : "surface"}
      />

      <CtaBand
        heading={`Need ${service.h1.toLowerCase()} scoped?`}
        subhead="Tell us about your project and we'll scope it."
        secondary={false}
        size="md"
      />
    </>
  );
}
