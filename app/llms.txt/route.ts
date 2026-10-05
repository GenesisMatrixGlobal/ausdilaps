import { SITE } from "@/lib/site";
import { absoluteUrl } from "@/lib/seo";
import { SERVICES_CONTENT } from "@/data/services";
import { LOCATIONS } from "@/data/locations";
import { CASE_STUDIES } from "@/data/case-studies";
import { getAllInsights } from "@/lib/insights";

export const dynamic = "force-static";

export function GET() {
  const services = SERVICES_CONTENT.map(
    (s) => `- [${s.schemaName}](${absoluteUrl(`/our-services/${s.slug}`)}): ${s.summary}`
  ).join("\n");

  const locations = LOCATIONS.map(
    (l) => `- [Dilapidation Reports ${l.city}](${absoluteUrl(`/dilapidation-reports/${l.slug}`)}): ${l.region}`
  ).join("\n");

  const proof = CASE_STUDIES.map(
    (c) => `- ${c.project} — ${c.value} (${c.client}, ${c.location})`
  ).join("\n");

  const insights = getAllInsights()
    .map((i) => `- [${i.title}](${absoluteUrl(`/insights/${i.slug}`)})`)
    .join("\n");

  const body = `# AusDilaps — Specialist Building Inspections

> Australia's specialist dilapidation (building condition) report firm. Pre and post-construction property condition reports that document existing conditions and hold up when a damage claim is made — compliant with Australian Standard ${SITE.standard} and backed by structural engineers. ${SITE.legalName} T/A AusDilaps, ABN ${SITE.abn}. Available Australia-wide, mainly the eastern seaboard (QLD, NSW, ACT, VIC) and SA.

AusDilaps is a company of the [Urban Pulse group](https://urbanpulse.com.au).

## Flagship
- [Dilapidation Reports](${absoluteUrl("/dilapidation-reports")}): the full guide — what a dilapidation report is, what's included, when you need one, and the 6-step methodology.

## Services
${services}

## Locations served
${locations}

## Proof (selected case studies)
${proof}

## Insights
${insights}

## Contact
- Phone: ${SITE.phone}
- Email: ${SITE.email}
- Request a quote: ${absoluteUrl("/quote")}
- Sample reports: ${absoluteUrl("/dilapidation-reports/samples")}
- FAQ: ${absoluteUrl("/faq")}
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
