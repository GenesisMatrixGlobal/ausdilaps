import type { Metadata } from "next";
import { Container } from "@/components/marketing/container";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Breadcrumbs } from "@/components/marketing/breadcrumbs";
import { FaqList } from "@/components/marketing/faq-accordion";
import { CtaBand } from "@/components/marketing/cta-band";
import { JsonLd } from "@/components/seo/json-ld";
import { FAQ, FAQ_FLAT } from "@/data/faq";
import { faqPageSchema, breadcrumbSchema } from "@/lib/seo";

const CRUMBS = [
  { name: "Home", path: "/" },
  { name: "FAQ", path: "/faq" },
];

export const metadata: Metadata = {
  title: "Dilapidation Reports FAQ — Your Questions Answered",
  description:
    "Answers to common questions about dilapidation reports, structural engineering, BASIX and NatHERS assessments — from AusDilaps, Australia's specialist building inspection firm.",
  alternates: { canonical: "/faq" },
};

export default function FaqPage() {
  return (
    <>
      <JsonLd data={[faqPageSchema(FAQ_FLAT), breadcrumbSchema(CRUMBS)]} />

      <section className="border-b border-ad-border py-16 lg:py-20">
        <Container className="max-w-3xl">
          <Breadcrumbs crumbs={CRUMBS} />
          <Eyebrow className="mt-6 text-ad-accent">Frequently Asked Questions</Eyebrow>
          <h1 className="mt-5 font-heading text-4xl font-semibold tracking-tight text-ad-ink sm:text-5xl">
            Dilapidation reports, answered.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-ad-muted">
            Clear answers on dilapidation and building condition reports, structural
            engineering, BASIX and NatHERS. Have a question that isn&apos;t here?{" "}
            <a href="/quote" className="font-medium text-ad-accent hover:brightness-90">
              Talk to our team.
            </a>
          </p>
        </Container>
      </section>

      <section className="py-16 lg:py-20">
        <Container className="max-w-3xl space-y-14">
          {FAQ.map((category) => (
            <div key={category.id} id={category.id} className="scroll-mt-24">
              <h2 className="font-heading text-2xl font-semibold tracking-tight text-ad-ink">
                {category.title}
              </h2>
              <div className="rule-accent mt-3 w-12" />
              <div className="mt-6">
                <FaqList items={category.items} />
              </div>
            </div>
          ))}
        </Container>
      </section>

      <CtaBand
        heading="Still have a question about your project?"
        subhead="Tell us about it and we'll scope your dilapidation report."
        size="md"
      />
    </>
  );
}
