import type { Metadata } from "next";
import { Container } from "@/components/marketing/container";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Breadcrumbs } from "@/components/marketing/breadcrumbs";
import { Markdown } from "@/components/marketing/markdown";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbSchema } from "@/lib/seo";
import { PRIVACY_POLICY } from "@/data/privacy-policy";
import { PRIVACY_UPDATED } from "@/data/legal";

const CRUMBS = [
  { name: "Home", path: "/" },
  { name: "Privacy Policy", path: "/privacy-policy" },
];

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How AusDilaps collects, uses and protects personal information, including photographs and records from property inspections.",
  alternates: { canonical: "/privacy-policy" },
};

export default function PrivacyPolicyPage() {
  return (
    <>
      <JsonLd data={[breadcrumbSchema(CRUMBS)]} />

      <section className="border-b border-ad-border py-16 lg:py-20">
        <Container className="max-w-3xl">
          <Breadcrumbs crumbs={CRUMBS} />
          <Eyebrow className="mt-6 text-ad-accent">Legal</Eyebrow>
          <h1 className="mt-5 font-heading text-4xl font-semibold tracking-tight text-ad-ink sm:text-5xl">
            Privacy Policy
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-ad-muted">Last updated {PRIVACY_UPDATED}</p>
        </Container>
      </section>

      <section className="py-16 lg:py-20">
        <Container className="max-w-3xl">
          <Markdown source={PRIVACY_POLICY} />
        </Container>
      </section>
    </>
  );
}
