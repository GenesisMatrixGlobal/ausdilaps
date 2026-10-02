import { LGA_STATES } from "../../lga-states";

/**
 * The labelled tail every VendorPanel feed description ends with:
 *
 *   Issued by : City of Ballarat
 *   Closing Date : 21/Oct/2026 02:00 PM (UTC+10:00) Canberra, Melbourne, Sydney time
 *   Reference number : VP527584
 *   Contact person : Not disclosed
 *
 * The feed was relying on the classifier to read the buyer and the deadline out of the body,
 * but ~95% of VendorPanel rows die in the free keyword prefilter and never reach it, so they
 * sat with no client, no state and no closing date. This reads the labels instead: free, and
 * it covers every row.
 *
 * Like the email extractors, every field is null rather than a guess.
 */
export type VendorPanelDetails = {
  agency: string | null;
  closesAt: string | null;
  jurisdiction: string | null;
  contact: string | null;
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

const STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"] as const;

/**
 * Which states a closing-date time zone allows. The buyer picks the zone, so it is a HINT,
 * not proof — Barcoo Shire (QLD) lists in "Canberra, Melbourne, Sydney" time — which is why
 * it only decides when nothing more specific does.
 */
function zoneStates(zone: string): string[] {
  if (/brisbane/i.test(zone)) return ["QLD"];
  if (/perth/i.test(zone)) return ["WA"];
  if (/darwin/i.test(zone)) return ["NT"];
  if (/hobart/i.test(zone)) return ["TAS"];
  // Broken Hill (NSW) keeps Adelaide time, so this is a hint like the rest.
  if (/adelaide/i.test(zone)) return ["SA"];
  if (/sydney|melbourne|canberra/i.test(zone)) return ["NSW", "VIC", "ACT"];
  return [];
}

/** A state government email domain in the contact line — the strongest signal there is. */
function domainState(text: string): string | null {
  const domain = /\.(nsw|vic|qld|sa|wa|tas|nt|act)\.gov\.au\b/i.exec(text);
  return domain ? domain[1].toUpperCase() : null;
}

/**
 * The state in the buyer's own name. Checked AFTER the council list, because a place name
 * can contain a state's: "Town of Victoria Park" is in Perth.
 */
function keywordState(text: string): string | null {
  if (/\bQueensland\b|\bQLD\b/i.test(text)) return "QLD";
  if (/\bNew South Wales\b|\bNSW\b/i.test(text)) return "NSW";
  if (/\bVictoria(n)?\b|\bVIC\b/.test(text)) return "VIC";
  if (/\bWestern Australia\b/i.test(text)) return "WA";
  if (/\bSouth Australia\b/i.test(text)) return "SA";
  if (/\bTasmania\b/i.test(text)) return "TAS";
  if (/\bNorthern Territory\b/i.test(text)) return "NT";
  return null;
}

const NAMES = Object.keys(LGA_STATES).sort((a, b) => b.length - a.length);
const lgaPatterns = NAMES.map((name) => ({
  name,
  re: new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[\s-]+/g, "[\\s-]*")}\\b`, "i"),
}));

/** States of every council named in the buyer, longest names first so "Greater Bendigo" beats "Bendigo". */
function lgaStates(agency: string): string[] {
  const hit = lgaPatterns.find((p) => p.re.test(agency));
  return hit ? [...LGA_STATES[hit.name]] : [];
}

/**
 * Councils whose OWN name settles a shared LGA name. Both Baysides list in Sydney time, so the
 * zone cannot; the NSW one is "Bayside Council" and the VIC one "Bayside City Council".
 */
const EXACT: Record<string, string> = {
  "bayside council": "NSW",
  "bayside city council": "VIC",
};

export function stateFor(agency: string | null, contact: string | null, zone: string): string | null {
  const exact = agency ? EXACT[agency.trim().toLowerCase()] : undefined;
  if (exact) return exact;
  const fromDomain = domainState(contact ?? "");
  if (fromDomain) return fromDomain;
  const zoned = zoneStates(zone);
  if (agency) {
    const fromLga = lgaStates(agency);
    if (fromLga.length === 1) return fromLga[0];
    // Bayside, Central Coast, Kingston…: the zone is what tells the two apart.
    const both = fromLga.filter((s) => zoned.includes(s));
    if (both.length === 1) return both[0];
    if (fromLga.length > 1) return null;
    const named = keywordState(agency);
    if (named) return named;
  }
  return zoned.length === 1 ? zoned[0] : null;
}

function field(text: string, label: string): string | null {
  const m = new RegExp(`${label}\\s*:\\s*([^\\n]+)`, "i").exec(text);
  const value = m?.[1].trim();
  return value ? value : null;
}

export function vendorPanelDetails(text: string): VendorPanelDetails {
  const agency = field(text, "Issued by");
  const contactRaw = field(text, "Contact person");
  const contact = contactRaw && !/^not disclosed$/i.test(contactRaw) ? contactRaw : null;

  // 21/Oct/2026 02:00 PM (UTC+10:00) Canberra, Melbourne, Sydney time. Date only, like every
  // other source — see extract/date.ts.
  const closing = field(text, "Closing Date") ?? "";
  const d = /(\d{1,2})\/([A-Za-z]{3})\/(\d{4})/.exec(closing);
  const month = d ? MONTHS[d[2].toLowerCase()] : undefined;
  const closesAt = d && month ? `${d[3]}-${month}-${d[1].padStart(2, "0")}` : null;
  const zone = /\)\s*([^)]*?)\s*time\b/i.exec(closing)?.[1] ?? "";

  const jurisdiction = stateFor(agency, contact, zone);
  return {
    agency,
    closesAt,
    jurisdiction: jurisdiction && (STATES as readonly string[]).includes(jurisdiction) ? jurisdiction : null,
    contact,
  };
}
