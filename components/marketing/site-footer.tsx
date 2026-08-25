import Link from "next/link";
import Image from "next/image";
import { Container } from "./container";
import { SITE } from "@/lib/site";
import {
  SERVICES_PILLAR,
  SERVICES_DILAPIDATION,
  SERVICES_SPECIALIST,
  type NavLink,
} from "@/lib/nav";

const toPairs = (links: NavLink[]): [string, string][] =>
  links.map((l) => [l.label, l.href] as [string, string]);

const DILAPIDATION_LINKS: [string, string][] = [
  [SERVICES_PILLAR.label, SERVICES_PILLAR.href],
  ...toPairs(SERVICES_DILAPIDATION),
  ["Sample reports", "/dilapidation-reports/samples"],
];

const SPECIALIST_LINKS: [string, string][] = [
  ...toPairs(SERVICES_SPECIALIST),
  ["All services", "/our-services"],
];

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: [string, string][];
}) {
  return (
    <div>
      <div className="font-heading text-xs font-medium uppercase tracking-[0.18em] text-ad-on-dark-muted">
        {title}
      </div>
      <ul className="mt-4 space-y-2.5">
        {links.map(([label, href]) => (
          <li key={label}>
            <Link href={href} className="text-sm text-white/85 transition-colors hover:text-ad-accent-2">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="bg-ad-navy-deep text-ad-on-dark">
      <Container className="py-16">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr_1fr]">
          <div>
            <Image
              src="/logo/ad-logo-white.png"
              alt="AusDilaps — Specialist Building Inspections"
              width={1000}
              height={369}
              className="h-10 w-auto"
            />
            <p className="mt-4 max-w-xs text-sm text-ad-on-dark-muted">
              Pre- and post-construction building condition reports that hold up when
              a damage claim is made. Compliant with {SITE.standard}.
            </p>
          </div>
          <FooterCol title="Dilapidation" links={DILAPIDATION_LINKS} />
          <FooterCol title="Specialist" links={SPECIALIST_LINKS} />
          <FooterCol
            title="Company"
            links={[
              ["Portfolio", "/portfolio"],
              ["Insights", "/insights"],
              ["FAQ", "/faq"],
              ["Request a Quote", "/quote"],
            ]}
          />
          <div>
            <div className="font-heading text-xs font-medium uppercase tracking-[0.18em] text-ad-on-dark-muted">
              Contact
            </div>
            <a
              href={`mailto:${SITE.email}`}
              className="mt-4 block text-sm text-white/85 transition-colors hover:text-ad-accent-2"
            >
              {SITE.email}
            </a>
            <a
              href={`tel:${SITE.phone.replace(/\s/g, "")}`}
              className="mt-1.5 block text-sm text-white/85 transition-colors hover:text-ad-accent-2"
            >
              {SITE.phone}
            </a>
            <p className="mt-1.5 text-sm text-ad-on-dark-muted">{SITE.address}</p>
          </div>
        </div>

        <div className="rule-hairline-dark my-10" />

        <div className="flex flex-col gap-2 text-xs text-ad-on-dark-muted sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 {SITE.legalName} T/A AusDilaps · ABN {SITE.abn}</p>
          <p>
            A company of the{" "}
            <a
              href="https://urbanpulse.com.au"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-ad-accent-2"
            >
              Urban Pulse group
            </a>{" "}
            · Professional Indemnity &amp; Public Liability insured
          </p>
        </div>
      </Container>
    </footer>
  );
}
