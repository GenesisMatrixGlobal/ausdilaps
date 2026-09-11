import { Container } from "./container";
import { Breadcrumbs } from "./breadcrumbs";
import { SITE } from "@/lib/site";

export const SAMPLES_CRUMBS = [
  { name: "Home", path: "/" },
  { name: "Dilapidation Reports", path: "/dilapidation-reports" },
  { name: "Samples", path: "/dilapidation-reports/samples" },
];

const phoneHref = `tel:${SITE.phone.replace(/\s/g, "")}`;

/** Slim header on purpose (Rhys, 2026-09-11): breadcrumbs, a heading, one contact line,
 *  then the content. No PageHero, no eyebrow, no intro paragraph — people are here to open
 *  a file, not to read about it. Shared by the locked and unlocked routes so they look like
 *  one page, which to the visitor they are. */
export function SamplesHeader({ children }: { children: React.ReactNode }) {
  return (
    <section className="pt-10 lg:pt-14">
      <Container className="max-w-4xl">
        <Breadcrumbs crumbs={SAMPLES_CRUMBS} />
        <div className="mt-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-ad-ink sm:text-4xl">
            Sample reports
          </h1>
          <p className="text-sm text-ad-muted">
            Questions about your quote?{" "}
            <a href={phoneHref} className="font-medium text-ad-ink underline-offset-4 hover:underline">
              {SITE.phone}
            </a>{" "}
            ·{" "}
            <a
              href={`mailto:${SITE.email}`}
              className="font-medium text-ad-ink underline-offset-4 hover:underline"
            >
              {SITE.email}
            </a>
          </p>
        </div>
        <div className="mt-8 pb-16 lg:pb-20">{children}</div>
      </Container>
    </section>
  );
}

/** Quiet contact band — no orange quote button. Sample readers usually hold a quote. */
export function SamplesContactBand() {
  return (
    <section className="bg-ad-navy-deep py-16 text-ad-on-dark lg:py-20">
      <Container className="text-center">
        <h2 className="mx-auto max-w-2xl text-balance font-heading text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Can&rsquo;t find the sample you need?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-ad-on-dark-muted">
          Tell us your project type and we&rsquo;ll send the closest examples.
        </p>
        <p className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-base font-medium">
          <a href={phoneHref} className="text-white hover:text-ad-accent-2">
            {SITE.phone}
          </a>
          <a href={`mailto:${SITE.email}`} className="text-white hover:text-ad-accent-2">
            {SITE.email}
          </a>
        </p>
      </Container>
    </section>
  );
}
