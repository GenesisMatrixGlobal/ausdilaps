import type { Metadata } from "next";
import { Container } from "@/components/marketing/container";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Breadcrumbs } from "@/components/marketing/breadcrumbs";
import { LegalClauses } from "@/components/marketing/legal-clauses";
import { renderInline } from "@/components/marketing/markdown";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbSchema } from "@/lib/seo";
import { TERMS_PREAMBLE, TERMS_SECTIONS } from "@/data/terms";
import { TERMS_EFFECTIVE, TERMS_V1, TERMS_VERSION } from "@/data/legal";

const CRUMBS = [
  { name: "Home", path: "/" },
  { name: "Terms and Conditions", path: "/terms-and-conditions" },
];

export const metadata: Metadata = {
  title: "General Terms and Conditions",
  description:
    "The general terms and conditions that apply to AusDilaps dilapidation surveys, condition reports and engineering services.",
  alternates: { canonical: "/terms-and-conditions" },
};

export default function TermsPage() {
  return (
    <>
      <JsonLd data={[breadcrumbSchema(CRUMBS)]} />

      <section className="border-b border-ad-border py-16 lg:py-20">
        <Container className="max-w-3xl">
          <Breadcrumbs crumbs={CRUMBS} />
          <Eyebrow className="mt-6 text-ad-accent">Legal</Eyebrow>
          <h1 className="mt-5 font-heading text-4xl font-semibold tracking-tight text-ad-ink sm:text-5xl">
            General Terms and Conditions
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-ad-muted">
            Version {TERMS_VERSION} · Effective {TERMS_EFFECTIVE}
          </p>
          <p className="mt-4 leading-relaxed text-ad-muted">
            These terms apply to quotes accepted on or after {TERMS_EFFECTIVE}. Work accepted
            before then stays on the terms that applied at the time:{" "}
            <a
              href={TERMS_V1.href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-ad-accent underline hover:brightness-90"
            >
              {TERMS_V1.label} (PDF)
            </a>
            .
          </p>
        </Container>
      </section>

      <section className="py-16 lg:py-20">
        <Container className="max-w-3xl">
          <p className="leading-relaxed text-ad-muted">{renderInline(TERMS_PREAMBLE)}</p>
          <LegalClauses sections={TERMS_SECTIONS} />
        </Container>
      </section>
    </>
  );
}
