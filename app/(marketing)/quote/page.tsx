import type { Metadata } from "next";
import { Container } from "@/components/marketing/container";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Breadcrumbs } from "@/components/marketing/breadcrumbs";
import { QuoteForm } from "@/components/marketing/quote-form";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbSchema } from "@/lib/seo";
import { SITE, STATS } from "@/lib/site";

const CRUMBS = [
  { name: "Home", path: "/" },
  { name: "Request a Quote", path: "/quote" },
];

export const metadata: Metadata = {
  title: "Request a Quote | Dilapidation Report Scoping — AusDilaps",
  description:
    "Get your dilapidation report scoped. Tell us the project, location and adjoining properties and we'll return an itemised quote. Reports compliant with AS 4349.0.",
  alternates: { canonical: "/quote" },
};

const STEPS = [
  { n: "01", title: "Tell us what you need", body: "Pick the option that fits — a new quote, an access letter query, a report question or something else." },
  { n: "02", title: "We route it", body: "Your enquiry goes straight to the right person on our team." },
  { n: "03", title: "We follow through", body: "For new projects, that means an itemised quote and, on acceptance, access arranged and the survey scheduled." },
];

export default function QuotePage() {
  return (
    <>
      <JsonLd data={[breadcrumbSchema(CRUMBS)]} />

      <section className="border-b border-ad-border py-12 lg:py-16">
        <Container className="max-w-3xl">
          <Breadcrumbs crumbs={CRUMBS} />
          <Eyebrow className="mt-6 text-ad-accent">Request a Quote</Eyebrow>
          <h1 className="mt-5 text-balance font-heading text-4xl font-semibold leading-[1.08] tracking-tight text-ad-ink sm:text-5xl">
            Get in touch.
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-ad-muted">
            Tell us what you need — a new project quote, a question about an access letter, an
            existing report, or something else — and we&apos;ll route it straight to the right person.
          </p>
        </Container>
      </section>

      <section className="py-16 lg:py-20">
        <Container className="grid gap-12 lg:grid-cols-[1.4fr_1fr] lg:items-start">
          <QuoteForm />

          <aside className="lg:sticky lg:top-24">
            <div className="rounded-xl border border-ad-border bg-ad-surface p-7">
              <Eyebrow className="text-ad-accent">What happens next</Eyebrow>
              <ol className="mt-6 space-y-6">
                {STEPS.map((s) => (
                  <li key={s.n} className="flex gap-4">
                    <span className="font-heading text-sm font-bold text-ad-accent">{s.n}</span>
                    <div>
                      <h3 className="font-heading text-base font-semibold text-ad-ink">{s.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-ad-muted">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="rule-hairline my-7" />

              <p className="text-sm text-ad-muted">Prefer to talk?</p>
              <a
                href={`tel:${SITE.phone.replace(/\s/g, "")}`}
                className="mt-1 block font-heading text-xl font-semibold text-ad-ink hover:text-ad-accent"
              >
                {SITE.phone}
              </a>
              <a
                href={`mailto:${SITE.email}`}
                className="mt-2 block text-sm font-medium text-ad-accent hover:brightness-90"
              >
                {SITE.email}
              </a>

              <div className="rule-hairline my-7" />

              <dl className="grid grid-cols-2 gap-5">
                {STATS.slice(0, 4).map((s) => (
                  <div key={s.label}>
                    <dt className="font-heading text-xl font-bold text-ad-ink">{s.value}</dt>
                    <dd className="mt-1 text-xs text-ad-muted">{s.label}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-6 text-xs text-ad-muted">
                Reports compliant with Australian Standard {SITE.standard}.
              </p>
            </div>
          </aside>
        </Container>
      </section>
    </>
  );
}
