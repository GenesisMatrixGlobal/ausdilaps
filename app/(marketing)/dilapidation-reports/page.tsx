import type { Metadata } from "next";
import { Container } from "@/components/marketing/container";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Breadcrumbs } from "@/components/marketing/breadcrumbs";
import { FaqSection } from "@/components/marketing/faq-accordion";
import { RelatedLinks, type RelatedLink } from "@/components/marketing/related-links";
import { CtaBand } from "@/components/marketing/cta-band";
import { LOCATIONS } from "@/data/locations";
import { Button } from "@/components/ui/button";
import { JsonLd } from "@/components/seo/json-ld";
import { SITE, PROCESS, CAPTURE_METHODS, QUOTE_HREF, CAPABILITY_HREF } from "@/lib/site";
import { FAQ } from "@/data/faq";
import { serviceSchema, howToSchema, faqPageSchema, breadcrumbSchema } from "@/lib/seo";

const PATH = "/dilapidation-reports";
const dilapFaq = FAQ.find((c) => c.id === "dilapidation-reports")!;
const CRUMBS = [
  { name: "Home", path: "/" },
  { name: "Dilapidation Reports", path: PATH },
];

export const metadata: Metadata = {
  title: "Dilapidation Reports | Pre- & Post-Construction Building Condition Reports",
  description:
    "Australia's specialist dilapidation reporting firm. Pre- and post-construction building condition reports that document existing conditions and hold up when a damage claim is made. Compliant with AS 4349.0.",
  alternates: { canonical: PATH },
};

export default function DilapidationReportsPage() {
  return (
    <>
      <JsonLd
        data={[
          serviceSchema(
            "Dilapidation Reports",
            "Pre- and post-construction property condition reports documenting the existing condition of adjoining structures, providing a defensible baseline that prevents and resolves damage disputes.",
            PATH
          ),
          howToSchema("How a dilapidation report is delivered", PROCESS),
          faqPageSchema(dilapFaq.items),
          breadcrumbSchema(CRUMBS),
        ]}
      />

      {/* Hero */}
      <section className="border-b border-ad-border py-16 lg:py-20">
        <Container className="max-w-3xl">
          <Breadcrumbs crumbs={CRUMBS} />
          <Eyebrow className="mt-6 text-ad-accent">Dilapidation Reports</Eyebrow>
          <h1 className="mt-5 text-balance font-heading text-4xl font-semibold leading-[1.08] tracking-tight text-ad-ink sm:text-5xl">
            Dilapidation reports built to survive a damage claim.
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-ad-muted">
            A dilapidation report is a photographic and written record of the
            condition of a construction site&apos;s adjoining structures and surrounding
            areas — undertaken before and after works to identify any changes. When a
            claim is made, it&apos;s the evidence that defends the project.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button href={QUOTE_HREF} size="lg" variant="accent">Request a Quote</Button>
            <Button href={CAPABILITY_HREF} size="lg" variant="outline" newTab>Download Capability Statement</Button>
          </div>
        </Container>
      </section>

      {/* What's included */}
      <section className="py-20 lg:py-24">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow className="text-ad-accent">What&apos;s included</Eyebrow>
            <h2 className="mt-5 font-heading text-3xl font-semibold tracking-tight text-ad-ink">
              A complete record of the property, inside and out.
            </h2>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {INCLUSIONS.map((i) => (
              <div key={i.title} className="rounded-xl border border-ad-border bg-white p-6">
                <div className="rule-accent mb-4 w-10" />
                <h3 className="font-heading text-lg font-semibold text-ad-ink">{i.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ad-muted">{i.body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* When you need one */}
      <section className="bg-ad-surface py-20 lg:py-24">
        <Container className="grid gap-12 lg:grid-cols-2">
          <div>
            <Eyebrow className="text-ad-accent">When you need one</Eyebrow>
            <h2 className="mt-5 font-heading text-3xl font-semibold tracking-tight text-ad-ink">
              Before works begin on adjacent properties.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-ad-muted">
              Reports are typically required before construction, renovation or
              demolition on neighbouring properties — and are often a condition of a
              development application (DA) consent.
            </p>
          </div>
          <ul className="space-y-4">
            {TRIGGERS.map((t) => (
              <li key={t} className="flex gap-3 rounded-lg border border-ad-border bg-white p-4">
                <span className="mt-0.5 font-heading text-sm font-bold text-ad-accent">→</span>
                <span className="text-[0.95rem] text-ad-ink">{t}</span>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* Pre vs post */}
      <section className="py-20 lg:py-24">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow className="text-ad-accent">Pre & post</Eyebrow>
            <h2 className="mt-5 font-heading text-3xl font-semibold tracking-tight text-ad-ink">
              The pair is what makes a claim defensible.
            </h2>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-ad-border bg-white p-7">
              <div className="font-heading text-sm font-bold text-ad-accent">01 — Pre-construction</div>
              <h3 className="mt-3 font-heading text-xl font-semibold text-ad-ink">The baseline</h3>
              <p className="mt-3 text-sm leading-relaxed text-ad-muted">
                The documented condition of every adjoining property before works begin —
                the reference point against which any later claim is measured.
              </p>
            </div>
            <div className="rounded-xl border border-ad-border bg-white p-7">
              <div className="font-heading text-sm font-bold text-ad-accent">02 — Post-construction</div>
              <h3 className="mt-3 font-heading text-xl font-semibold text-ad-ink">The comparison</h3>
              <p className="mt-3 text-sm leading-relaxed text-ad-muted">
                A matching record after works complete, identifying any change so damage
                is proven or disproven on the evidence — not on argument.
              </p>
            </div>
          </div>
        </Container>
      </section>

      {/* Process (HowTo) */}
      <section className="bg-ad-navy py-20 text-ad-on-dark lg:py-24">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow className="text-ad-accent-2">How it&apos;s delivered</Eyebrow>
            <h2 className="mt-5 font-heading text-3xl font-semibold tracking-tight text-white">
              Our 6-step methodology.
            </h2>
            <p className="mt-4 text-ad-on-dark-muted">
              Every report compliant with Australian Standard {SITE.standard}.
            </p>
          </div>
          <div className="mt-10 grid gap-px overflow-hidden rounded-xl bg-white/10 md:grid-cols-2 lg:grid-cols-3">
            {PROCESS.map((s) => (
              <div key={s.n} className="bg-ad-navy p-7">
                <div className="font-heading text-sm font-bold text-ad-accent-2">{s.n}</div>
                <h3 className="mt-3 font-heading text-lg font-semibold text-white">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ad-on-dark-muted">{s.body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* Capture methods */}
      <section className="py-20 lg:py-24">
        <Container className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <Eyebrow className="text-ad-accent">Evidentiary-grade capture</Eyebrow>
            <h2 className="mt-5 font-heading text-3xl font-semibold tracking-tight text-ad-ink">
              The right technique for every asset.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-ad-muted">
              From a single residential build to major infrastructure — we match the
              capture method to the asset so the record is defensible, not just a folder
              of photos.
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {CAPTURE_METHODS.map((m) => (
              <span key={m} className="rounded-full border border-ad-border bg-ad-surface px-4 py-2 text-sm font-medium text-ad-ink">
                {m}
              </span>
            ))}
          </div>
        </Container>
      </section>

      {/* FAQ */}
      <FaqSection items={dilapFaq.items} heading="Dilapidation reports, answered." />

      {/* Locations + samples */}
      <RelatedLinks
        eyebrow="Explore"
        heading="Dilapidation reports near you."
        links={
          [
            {
              label: "Sample reports",
              href: "/dilapidation-reports/samples",
              description: "See real example reports across every capture type.",
            },
            ...LOCATIONS.map((l) => ({
              label: `Dilapidation Reports ${l.city}`,
              href: `/dilapidation-reports/${l.slug}`,
              description: l.region,
            })),
          ] satisfies RelatedLink[]
        }
      />

      {/* CTA */}
      <CtaBand
        heading="Need a dilapidation report scoped?"
        subhead="Tell us the project, location and adjoining properties — we'll scope it."
        secondary={false}
        size="md"
      />
    </>
  );
}

const INCLUSIONS = [
  { title: "Detailed description", body: "Property age, construction type and notable features of every inspected structure." },
  { title: "Existing damage & defects", body: "Cracks, settling, movement, leaks and wear — recorded with severity and location." },
  { title: "Photographic & video record", body: "High-resolution, location-referenced imagery — ultra-high-quality and defensible." },
  { title: "Geo-referenced imagery", body: "GPS-logged capture so pre- and post-works images compare to the exact spot." },
  { title: "Recommendations", body: "Repair or maintenance recommendations where existing issues are identified." },
  { title: "Summary of findings", body: "Clear conclusions and a defensible record, signed off by our engineers." },
];

const TRIGGERS = [
  "A DA consent condition requiring condition reports on adjoining properties",
  "Vibration-sensitive works beginning near third-party property",
  "Neighbour-complaint risk or an insurance / legal exposure clause",
  "Major nearby works — roadworks, excavation, tunnelling or high-rise development",
];
