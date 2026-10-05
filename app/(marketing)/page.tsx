import Image from "next/image";
import Link from "next/link";
import { Check, FileDown } from "lucide-react";
import { Container } from "@/components/marketing/container";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { CtaBand } from "@/components/marketing/cta-band";
import { ClientLogoBar } from "@/components/marketing/client-logo-bar";
import { QuoteForm } from "@/components/marketing/quote-form";
import { FaqSection } from "@/components/marketing/faq-accordion";
import { JsonLd } from "@/components/seo/json-ld";
import { faqPageSchema } from "@/lib/seo";
import { SITE, STATS, SERVICES, PROCESS, TEAM, TIER1_PROJECTS, CAPABILITY_HREF } from "@/lib/site";
import { CASE_STUDIES } from "@/data/case-studies";
import { FAQ } from "@/data/faq";

/* The four dilapidation questions a first-time visitor asks, lifted from the real
   FAQ (data/faq.ts) so the homepage and /faq can never disagree. Same items feed the
   FAQPage schema below — answer-first copy is what the AI overviews quote. */
const DILAP_FAQ = FAQ.find((c) => c.id === "dilapidation-reports")?.items ?? [];
const HOME_FAQ = [0, 2, 1, 4].map((i) => DILAP_FAQ[i]).filter(Boolean);

export default function HomePage() {
  return (
    <>
      <JsonLd data={[faqPageSchema(HOME_FAQ)]} />
      <Hero />
      <ClientLogoBar />
      <StatsBand />
      <Problem />
      <Process />
      <Services />
      <Projects />
      <Experience />
      <About />
      <FaqSection items={HOME_FAQ} heading="Dilapidation reports, answered." tone="brand" />
      <CtaBand eyebrow="Let's work together" tone="light" />
    </>
  );
}

/* ─── Hero (project photo with an even pale-blue tint) ──────────────────
   The form used to live one click away on /quote, and ~1 in 13 homepage
   visitors made that click. Putting a short version of it here is the
   Grout Guy pattern: the thing most visitors came to do is on the first
   screen. The photo is a real AusDilaps project (Queens Wharf), not stock. */
function Hero() {
  const proof = [
    `Reports compliant with ${SITE.standard}`,
    "15 years, family-owned",
    "1,000+ surveys every quarter",
    "Australia-wide",
  ];
  return (
    <section className="relative isolate overflow-hidden bg-ad-sky text-ad-ink">
      <Image
        src="/projects/queens-wharf.jpg"
        alt=""
        aria-hidden="true"
        fill
        priority
        fetchPriority="high"
        quality={40}
        sizes="100vw"
        className="-z-10 object-cover object-center"
      />
      <div className="absolute inset-0 -z-10 bg-ad-sky/[0.84]" />

      {/* Keep the form immediately after the introduction on phones. On desktop
          the copy and proof sit together beside the form. */}
      <Container className="grid grid-cols-1 gap-10 py-14 lg:grid-cols-[minmax(0,1.2fr)_minmax(440px,1fr)] lg:grid-rows-[auto_auto] lg:items-center lg:gap-x-12 lg:gap-y-8">
        <div className="lg:self-end">
          <Eyebrow className="text-[0.8125rem] font-bold tracking-[0.12em] text-ad-ink-deep">Specialist Building Inspections</Eyebrow>
          <h1 className="mt-5 text-balance font-heading text-4xl font-bold leading-[1.1] tracking-tight text-[#1b2025] sm:text-5xl">
            The dilapidation specialists Tier&nbsp;1 contractors trust to hold up
            in court.
          </h1>
          <p className="mt-6 max-w-xl text-lg font-medium leading-relaxed text-ad-ink-deep sm:text-xl">
            Pre and post-construction building condition reports for Australia&apos;s
            most scrutinised projects. When a damage claim is made — not if — your
            report has to defend it.
          </p>
        </div>

        <div id="quote" className="scroll-mt-24 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <QuoteForm variant="compact" />
        </div>

        <div className="lg:col-start-1 lg:row-start-2 lg:self-start">
          <ul className="flex max-w-xl flex-wrap gap-2.5">
            {proof.map((p) => (
              <li key={p} className="inline-flex max-w-full items-center gap-2 rounded-full border border-[#d4dee7] bg-[#f8fafc] px-4 py-2 text-sm font-normal leading-snug text-ad-ink">
                <Check className="h-3.5 w-3.5 shrink-0 text-ad-steel" aria-hidden="true" />
                <span className="min-w-0">{p}</span>
              </li>
            ))}
          </ul>
          <div className="mt-7">
            <Link
              href={CAPABILITY_HREF}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Download Capability Statement (PDF, opens in a new tab)"
              className="inline-flex min-h-11 max-w-full items-center gap-2.5 rounded-md py-2 text-[0.95rem] font-medium text-ad-steel-dark transition-colors hover:text-ad-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ad-steel focus-visible:ring-offset-4"
            >
              <FileDown className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 underline decoration-ad-steel/50 underline-offset-4">Download Capability Statement</span>
              <span className="shrink-0 text-xs font-normal text-ad-ink">PDF</span>
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}

/* ─── Stats band (steel blue) ────────────────────────────────────── */
function StatsBand() {
  return (
    <section className="bg-ad-steel text-ad-on-dark">
      <Container className="py-12">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label}>
              <div className="font-heading text-3xl font-bold tracking-tight text-white sm:text-4xl">
                {s.value}
              </div>
              <div className="mt-3 h-0.5 w-10 rounded-full bg-ad-sky/60" />
              <div className="mt-3 text-sm text-white/85">{s.label}</div>
            </div>
          ))}
        </div>
        <p className="mt-10 text-center text-sm text-white/85">
          15 years · Family-owned · Reports compliant with Australian Standard {SITE.standard}
        </p>
      </Container>
    </section>
  );
}

/* ─── Problem (light) ────────────────────────────────────────────── */
function Problem() {
  const costs = [
    {
      title: "Litigation exposure",
      body: "A neighbour claims construction damage. If the report is thin, the contractor wears six-figure legal costs and a contested liability.",
    },
    {
      title: "Programme delay",
      body: "Disputed condition holds up site possession. Every day the evidence is questioned is a day the programme slips.",
    },
    {
      title: "Reputation on the line",
      body: "The project manager who signed off a generalist report is the one explaining why it didn't hold when it mattered.",
    },
  ];
  return (
    <section className="py-20 lg:py-28">
      <Container>
        <div className="max-w-2xl">
          <Eyebrow className="text-ad-accent">The Risk</Eyebrow>
          <h2 className="mt-5 font-heading text-3xl font-semibold tracking-tight text-ad-ink sm:text-4xl">
            When a damage claim lands, a generalist report won&apos;t defend it.
          </h2>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {costs.map((c) => (
            <div key={c.title} className="rounded-xl border border-ad-steel/15 bg-ad-sky/40 p-6">
              <div className="mb-5 h-1 w-10 rounded-full bg-ad-sky-deep" />
              <h3 className="font-heading text-lg font-semibold text-ad-ink">{c.title}</h3>
              <p className="mt-2 text-[0.95rem] leading-relaxed text-ad-muted">{c.body}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

/* ─── Process (surface) — customer-facing 3, links to full 6-step ── */
function Process() {
  const steps = PROCESS.slice(0, 3);
  return (
    <section id="process" className="scroll-mt-20 bg-ad-sky py-20 lg:py-28">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <Eyebrow className="text-ad-accent">How it works</Eyebrow>
            <h2 className="mt-5 font-heading text-3xl font-semibold tracking-tight text-ad-ink sm:text-4xl">
              A defensible report, the right way.
            </h2>
          </div>
          <Link
            href="/dilapidation-reports#methodology"
            className="text-sm font-semibold text-ad-steel-dark transition-colors hover:text-ad-ink"
          >
            See the full 6-step methodology →
          </Link>
        </div>
        <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-ad-steel/15 bg-ad-steel/15 md:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n} className="bg-white p-8">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ad-sky font-heading text-sm font-bold text-ad-steel-dark">{s.n}</div>
              <h3 className="mt-4 font-heading text-xl font-semibold text-ad-ink">{s.title}</h3>
              <p className="mt-3 text-[0.95rem] leading-relaxed text-ad-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

/* ─── Services (light) ───────────────────────────────────────────── */
function Services() {
  return (
    <section id="services" className="scroll-mt-20 py-20 lg:py-28">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <Eyebrow className="text-ad-accent">What we do</Eyebrow>
            <h2 className="mt-5 font-heading text-3xl font-semibold tracking-tight text-ad-ink sm:text-4xl">
              Specialist reports, backed by structural engineers.
            </h2>
          </div>
          <Link href="/our-services" className="text-sm font-semibold text-ad-steel-dark transition-colors hover:text-ad-ink">
            View all services →
          </Link>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICES.map((s) => (
            <Link
              key={s.title}
              href={s.href}
              className="group flex flex-col rounded-xl border border-ad-steel/15 bg-white p-7 transition-colors hover:border-ad-steel/40 hover:bg-ad-sky/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ad-steel focus-visible:ring-offset-4"
            >
              <span className="self-start rounded-full bg-ad-sky px-3 py-1 text-xs font-semibold uppercase tracking-wider text-ad-steel-dark">
                {s.tag}
              </span>
              <h3 className="mt-5 font-heading text-lg font-semibold text-ad-ink group-hover:text-ad-accent">
                {s.title}
              </h3>
              <p className="mt-3 flex-1 text-[0.95rem] leading-relaxed text-ad-muted">{s.body}</p>
              <span className="mt-6 text-sm font-semibold text-ad-steel-dark">Learn more →</span>
            </Link>
          ))}
        </div>
      </Container>
    </section>
  );
}

/* ─── Projects (surface) — Tier 1 image cards ────────────────────── */
function Projects() {
  const featured = TIER1_PROJECTS.slice(0, 3);
  return (
    <section id="projects" className="scroll-mt-20 bg-ad-sky py-20 lg:py-28">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <Eyebrow className="text-ad-accent">Proof</Eyebrow>
            <h2 className="mt-5 font-heading text-3xl font-semibold tracking-tight text-ad-ink sm:text-4xl">
              The projects that built our reputation.
            </h2>
          </div>
          <Link href="/portfolio" className="text-sm font-semibold text-ad-steel-dark transition-colors hover:text-ad-ink">
            View full portfolio →
          </Link>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((p) => (
            <Link
              key={p.name}
              href={`/portfolio/${p.slug}`}
              className="group overflow-hidden rounded-xl border border-ad-steel/15 bg-white transition-colors hover:border-ad-steel/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ad-steel focus-visible:ring-offset-4"
            >
              <div className="relative aspect-[3/2] overflow-hidden">
                <Image
                  src={p.image}
                  alt={p.name}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
              </div>
              <div className="p-6">
                <span className="inline-flex rounded-full bg-ad-sky px-3 py-1 text-xs font-semibold uppercase tracking-wider text-ad-steel-dark">{p.sector}</span>
                <h3 className="mt-2 font-heading text-lg font-semibold text-ad-ink group-hover:text-ad-accent">{p.name}</h3>
              </div>
            </Link>
          ))}
        </div>
      </Container>
    </section>
  );
}

/* ─── Project experience (light) — real case studies with values ── */
function Experience() {
  return (
    <section className="py-20 lg:py-28">
      <Container>
        <div className="max-w-2xl">
          <Eyebrow className="text-ad-accent">Project experience</Eyebrow>
          <h2 className="mt-5 font-heading text-3xl font-semibold tracking-tight text-ad-ink sm:text-4xl">
            Major works, documented to the millimetre.
          </h2>
        </div>
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {CASE_STUDIES.map((c) => (
            <Link
              key={c.slug}
              href={`/portfolio/${c.slug}`}
              className="group flex flex-col rounded-xl border border-ad-steel/15 bg-white p-7 transition-colors hover:border-ad-steel/40 hover:bg-ad-sky/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ad-steel focus-visible:ring-offset-4"
            >
              <div className="font-heading text-2xl font-bold text-ad-steel-dark">{c.value}</div>
              <h3 className="mt-3 font-heading text-lg font-semibold text-ad-ink group-hover:text-ad-accent">{c.project}</h3>
              <p className="mt-1 text-sm text-ad-muted">
                {c.client} · {c.location}
              </p>
              <div className="my-5 h-px bg-ad-sky-deep" />
              <ul className="space-y-2 text-[0.95rem] leading-relaxed text-ad-muted">
                {c.stats.map((st) => (
                  <li key={st.label} className="flex gap-2">
                    <span className="font-semibold text-ad-accent">{st.value}</span>
                    <span>{st.label}</span>
                  </li>
                ))}
              </ul>
            </Link>
          ))}
        </div>
      </Container>
    </section>
  );
}

/* ─── About / authority (deep steel blue) ────────────────────────── */
function About() {
  return (
    <section id="about" className="scroll-mt-20 bg-ad-steel-dark text-ad-on-dark">
      <Container className="grid gap-12 py-20 lg:grid-cols-2 lg:items-center lg:py-28">
        <div>
          <Eyebrow className="text-ad-sky-deep">Why AusDilaps</Eyebrow>
          <h2 className="mt-5 font-heading text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Specialist work deserves specialists.
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-white/85">
            A family-owned business with a 15-year history and a team of structural
            engineers experienced in defect classification. We deliver thorough,
            impartial, high-quality reports that provide a defensible record of
            existing conditions — for any project scale or environment.
          </p>
          <p className="mt-4 text-lg leading-relaxed text-white/85">
            Every report is compliant with Australian Standard {SITE.standard}, combining
            ultra-high-quality imagery, precise defect annotations and pinpoint
            location references.
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ad-sky-deep">
            The delivery team
          </p>
          <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-ad-sky/20 bg-ad-sky/20">
            {TEAM.map((m) => (
              <div key={m.name} className="bg-ad-steel p-5">
                <div className="font-heading text-base font-semibold text-white">{m.name}</div>
                <div className="mt-1 text-sm text-white/85">{m.role}</div>
              </div>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
