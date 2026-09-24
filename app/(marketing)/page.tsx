import Image from "next/image";
import Link from "next/link";
import { Container } from "@/components/marketing/container";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Button } from "@/components/ui/button";
import { CtaBand } from "@/components/marketing/cta-band";
import { ClientLogoBar } from "@/components/marketing/client-logo-bar";
import { SITE, STATS, SERVICES, PROCESS, TEAM, TIER1_PROJECTS, QUOTE_HREF, CAPABILITY_HREF } from "@/lib/site";
import { CASE_STUDIES } from "@/data/case-studies";

export default function HomePage() {
  return (
    <>
      <Hero />
      <StatsBand />
      <ClientLogoBar />
      <Problem />
      <Process />
      <Services />
      <Projects />
      <Experience />
      <About />
      <CtaBand eyebrow="Let's work together" />
    </>
  );
}

/* ─── Hero (light) ───────────────────────────────────────────────── */
function Hero() {
  return (
    <section className="relative overflow-hidden">
      <Container className="grid items-center gap-12 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
        <div>
          <Eyebrow className="text-ad-accent">Specialist Building Inspections</Eyebrow>
          <h1 className="mt-6 text-balance font-heading text-4xl font-semibold leading-[1.05] tracking-tight text-ad-ink sm:text-5xl lg:text-6xl">
            The dilapidation specialists Tier&nbsp;1 contractors trust to hold up
            in court.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ad-muted">
            Pre- and post-construction building condition reports for Australia&apos;s
            most scrutinised projects. When a damage claim is made — not if — your
            report has to defend it.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button href={QUOTE_HREF} size="lg" variant="accent">Request a Quote</Button>
            <Button href={CAPABILITY_HREF} size="lg" variant="outline" newTab>
              Download Capability Statement
            </Button>
          </div>
        </div>

        <div className="relative">
          <div className="relative aspect-[4/5] overflow-hidden rounded-2xl shadow-xl shadow-ad-navy/15">
            <Image
              src="/projects/queens-wharf.jpg"
              alt="Queens Wharf, Brisbane — a Tier 1 project AusDilaps has reported on"
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 45vw"
              className="object-cover"
            />
          </div>
          <div className="absolute -bottom-5 -left-5 hidden rounded-xl border border-ad-border bg-white px-5 py-4 shadow-lg sm:block">
            <div className="font-heading text-2xl font-bold text-ad-ink">1M+</div>
            <div className="text-xs uppercase tracking-wider text-ad-muted">
              photos captured annually
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

/* ─── Stats band (navy) ──────────────────────────────────────────── */
function StatsBand() {
  return (
    <section className="bg-ad-navy text-ad-on-dark">
      <Container className="py-12">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label}>
              <div className="font-heading text-3xl font-bold tracking-tight text-white sm:text-4xl">
                {s.value}
              </div>
              <div className="rule-accent mt-3 w-10" />
              <div className="mt-3 text-sm text-ad-on-dark-muted">{s.label}</div>
            </div>
          ))}
        </div>
        <p className="mt-10 text-center text-sm text-ad-on-dark-muted">
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
            <div key={c.title} className="rounded-xl border border-ad-border bg-white p-6">
              <div className="rule-accent mb-5 w-10" />
              <h3 className="font-heading text-lg font-semibold text-ad-ink">{c.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ad-muted">{c.body}</p>
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
    <section id="process" className="scroll-mt-20 bg-ad-surface py-20 lg:py-28">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <Eyebrow className="text-ad-accent">How it works</Eyebrow>
            <h2 className="mt-5 font-heading text-3xl font-semibold tracking-tight text-ad-ink sm:text-4xl">
              A defensible report, the right way.
            </h2>
          </div>
          <a href="#contact" className="text-sm font-medium text-ad-accent hover:brightness-90">
            See the full 6-step methodology →
          </a>
        </div>
        <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-ad-border bg-ad-border md:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n} className="bg-white p-8">
              <div className="font-heading text-sm font-bold text-ad-accent">{s.n}</div>
              <h3 className="mt-4 font-heading text-xl font-semibold text-ad-ink">{s.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-ad-muted">{s.body}</p>
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
              Specialist reports, backed by chartered engineering.
            </h2>
          </div>
          <Link href="/our-services" className="text-sm font-medium text-ad-accent hover:brightness-90">
            View all services →
          </Link>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICES.map((s) => (
            <Link
              key={s.title}
              href={s.href}
              className="group flex flex-col rounded-xl border border-ad-border bg-white p-7 transition-colors hover:border-ad-accent/40"
            >
              <span className="self-start rounded-full bg-ad-surface px-3 py-1 text-xs font-medium uppercase tracking-wider text-ad-muted">
                {s.tag}
              </span>
              <h3 className="mt-5 font-heading text-lg font-semibold text-ad-ink group-hover:text-ad-accent">
                {s.title}
              </h3>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-ad-muted">{s.body}</p>
              <span className="mt-6 text-sm font-medium text-ad-accent">Learn more →</span>
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
    <section id="projects" className="scroll-mt-20 bg-ad-surface py-20 lg:py-28">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <Eyebrow className="text-ad-accent">Proof</Eyebrow>
            <h2 className="mt-5 font-heading text-3xl font-semibold tracking-tight text-ad-ink sm:text-4xl">
              The projects that built our reputation.
            </h2>
          </div>
          <Link href="/portfolio" className="text-sm font-medium text-ad-accent hover:brightness-90">
            View full portfolio →
          </Link>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((p) => (
            <Link
              key={p.name}
              href={`/portfolio/${p.slug}`}
              className="group overflow-hidden rounded-xl border border-ad-border bg-white transition-colors hover:border-ad-accent/40"
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
                <div className="text-xs font-medium uppercase tracking-wider text-ad-accent">{p.sector}</div>
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
              className="group flex flex-col rounded-xl border border-ad-border bg-white p-7 transition-colors hover:border-ad-accent/40"
            >
              <div className="font-heading text-2xl font-bold text-ad-ink">{c.value}</div>
              <h3 className="mt-3 font-heading text-lg font-semibold text-ad-ink group-hover:text-ad-accent">{c.project}</h3>
              <p className="mt-1 text-sm text-ad-muted">
                {c.client} · {c.location}
              </p>
              <div className="rule-hairline my-5" />
              <ul className="space-y-2 text-sm text-ad-muted">
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

/* ─── About / authority (navy) ───────────────────────────────────── */
function About() {
  return (
    <section id="about" className="scroll-mt-20 bg-ad-navy text-ad-on-dark">
      <Container className="grid gap-12 py-20 lg:grid-cols-2 lg:items-center lg:py-28">
        <div>
          <Eyebrow className="text-ad-accent-2">Why AusDilaps</Eyebrow>
          <h2 className="mt-5 font-heading text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Specialist work deserves specialists.
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-ad-on-dark-muted">
            A family-owned business with a 15-year history and a team of structural
            engineers experienced in defect classification. We deliver thorough,
            impartial, high-quality reports that provide a defensible record of
            existing conditions — for any project scale or environment.
          </p>
          <p className="mt-4 text-lg leading-relaxed text-ad-on-dark-muted">
            Every report is compliant with Australian Standard {SITE.standard}, combining
            ultra-high-quality imagery, precise defect annotations and pinpoint
            location references.
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-ad-on-dark-muted">
            The delivery team
          </p>
          <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/10">
            {TEAM.map((m) => (
              <div key={m.name} className="bg-ad-navy p-5">
                <div className="font-heading text-base font-semibold text-white">{m.name}</div>
                <div className="text-sm text-ad-on-dark-muted">{m.role}</div>
              </div>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}

