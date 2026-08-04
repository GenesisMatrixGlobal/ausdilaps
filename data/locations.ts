// Location landing pages. Built as best-practice local pages — unique local copy,
// real local drivers, real project proof (linked to the portfolio), honest
// service-area framing. AusDilaps is HQ'd in Aspley QLD and delivers on-site
// Australia-wide (mainly the eastern seaboard + SA) — no fabricated branch offices.

import type { FaqItem } from "@/data/faq";

export type Location = {
  slug: string; // "dilapidation-reports-<city>" — legacy nested pattern preserved
  city: string;
  state: string;
  region: string;
  title: string;
  metaDescription: string;
  h1: string;
  intro: string;
  why: { heading: string; body: string };
  /** local triggers / drivers */
  drivers: string[];
  /** portfolio slugs delivered in/near this city (real) */
  localProjects: string[];
  /** honest service-area statement */
  serviceNote: string;
  faq: FaqItem[];
  isNew?: boolean;
};

export const LOCATIONS: Location[] = [
  {
    slug: "dilapidation-reports-sydney",
    city: "Sydney",
    state: "NSW",
    region: "New South Wales",
    title: "Dilapidation Reports Sydney | Pre-Construction Condition Surveys NSW",
    metaDescription:
      "Specialist dilapidation reports across Sydney and NSW. Pre- and post-construction condition surveys for DA consent, compliant with AS 4349.0 — backed by structural engineers and proven on NorthConnex, WestConnex and Sydney Metro.",
    h1: "Dilapidation Reports Sydney",
    intro:
      "Across Sydney, construction, excavation and demolition near third-party property is rarely without risk. A dilapidation report documents the existing condition of adjoining buildings, council assets and infrastructure — before and after works — so that when a damage claim is made, it's settled on evidence, not argument.",
    why: {
      heading: "Why Sydney projects need a dilapidation report.",
      body: "Sydney is the most active construction market in the country — metro and motorway tunnelling, dense infill, heritage streetscapes and vibration-sensitive neighbours. Many Sydney councils require a dilapidation report on adjoining properties as a condition of development consent, and on major works it's a contractual necessity. We've delivered exactly that scale of survey — from a few heritage-listed buildings to 6,000+ properties along a motorway corridor.",
    },
    drivers: [
      "A DA consent condition requiring condition reports on adjoining properties",
      "Tunnelling, excavation or piling near heritage or vibration-sensitive structures",
      "Major corridor works — Sydney Metro, motorway upgrades, rail and road",
      "Neighbour-dispute or insurance exposure on dense infill sites",
    ],
    localProjects: [
      "westconnex",
      "northconnex",
      "northwest-rail-link",
      "barangaroo-south",
      "northern-beaches-b-line",
      "northern-beaches-hospital",
    ],
    serviceNote:
      "Our engineers attend sites across Greater Sydney and NSW — from the Inner West and CBD to the Northern Beaches, Western Sydney and the Central Coast.",
    faq: [
      {
        q: "Do I need a dilapidation report in Sydney?",
        a: "If you're building, excavating or demolishing near adjoining property, very likely yes. Many Sydney councils require a dilapidation report on neighbouring properties as a condition of development consent, and major projects make it a contractual requirement. It protects you against damage claims by recording the existing condition before works begin.",
      },
      {
        q: "How much does a dilapidation report cost in Sydney?",
        a: "Cost depends on the number of adjoining properties, the asset types involved and access. Tell us the project, location and number of adjoining properties and we'll scope an itemised quote.",
      },
      {
        q: "Who arranges access to the neighbouring properties?",
        a: "We do. As part of our methodology we initiate access via doorknocks, SMS, letters, calls and emails, and record every attempt — maximising inspection success rates so your report is as complete as possible.",
      },
    ],
  },
  {
    slug: "dilapidation-reports-brisbane",
    city: "Brisbane",
    state: "QLD",
    region: "Queensland",
    title: "Dilapidation Reports Brisbane | Property Condition Surveys QLD",
    metaDescription:
      "Specialist dilapidation reports across Brisbane and South East Queensland. Pre- and post-construction condition surveys compliant with AS 4349.0 — from a Queensland-based team proven on Queen's Wharf and Brisbane Airport.",
    h1: "Dilapidation Reports Brisbane",
    intro:
      "When demolition and construction in Brisbane involves heavy machinery and excavation, there's a real chance of impact on adjoining properties. A Brisbane dilapidation report captures the precise condition of those neighbouring buildings, roads, kerbs, bridges and assets — before and after construction — as protection and as the basis for answering any claim.",
    why: {
      heading: "Brisbane's building boom makes the baseline essential.",
      body: "With the lead-up to the 2032 Olympic and Paralympic Games, Cross River Rail, Brisbane Metro and sustained South East Queensland growth, Brisbane is building at pace. AusDilaps is a Queensland-based, family-owned firm — and we've documented some of the city's most sensitive works, including the heritage-listed buildings surrounding Queen's Wharf and heritage items adjoining Brisbane Airport.",
    },
    drivers: [
      "Council certification requiring pre- and post-construction condition reports",
      "Works adjoining heritage-listed buildings or council assets",
      "Major SEQ infrastructure — rail, road and Games-related precincts",
      "Bond protection on works affecting kerbing, roadways, drainage or pathways",
    ],
    localProjects: ["queens-wharf-brisbane", "brisbane-airport"],
    serviceNote:
      "As a Queensland-based firm, our engineers cover Brisbane, the Gold Coast, the Sunshine Coast and across SEQ — and travel Australia-wide for major works.",
    faq: [
      {
        q: "Is a dilapidation report required in Brisbane?",
        a: "For many Brisbane projects, yes. Councils often require pre- and post-construction condition reports for certification, and they're essential where works adjoin heritage buildings or council assets. The report protects you and provides the basis for resolving damage claims and recovering your bond.",
      },
      {
        q: "Is AusDilaps based in Brisbane?",
        a: "AusDilaps is a Queensland-based, family-owned firm (Aspley, Brisbane). We've delivered dilapidation surveys on some of Brisbane's most significant projects, including Queen's Wharf and Brisbane Airport.",
      },
      {
        q: "What does a Brisbane dilapidation report cover?",
        a: "A complete photographic and written record of the adjoining properties — buildings, roads, kerbs, bridges, tunnels and council assets — inspected before construction and again after completion, with location-referenced imagery and engineer sign-off compliant with AS 4349.0.",
      },
    ],
  },
  {
    slug: "dilapidation-reports-melbourne",
    city: "Melbourne",
    state: "VIC",
    region: "Victoria",
    title: "Dilapidation Reports Melbourne | Pre-Construction Condition Surveys VIC",
    metaDescription:
      "Specialist dilapidation reports across Melbourne and Victoria. Pre- and post-construction property condition surveys compliant with AS 4349.0, backed by structural engineers and georeferenced capture.",
    h1: "Dilapidation Reports Melbourne",
    intro:
      "Planning a major demolition or construction project in Melbourne? Before breaking ground, a dilapidation report records the status and condition of the adjoining properties — a photographic and written baseline that protects you if construction is later blamed for damage.",
    why: {
      heading: "Victoria's Big Build raises the stakes on every site.",
      body: "The Metro Tunnel, West Gate Tunnel, North East Link and the Suburban Rail Loop have made Melbourne one of the most heavily tunnelled and excavated cities in the country — and that activity reaches far beyond the project boundary. A dilapidation report gives developers and contractors a defensible record of every adjoining property before works begin, and a clear comparison afterwards.",
    },
    drivers: [
      "Council requirements for condition reports before works begin",
      "Tunnelling, settlement and vibration impacts on adjoining property",
      "Large-scale infrastructure and high-density residential development",
      "Insurance and dispute exposure on construction-related damage",
    ],
    localProjects: ["glenrowan-solar-farm"],
    serviceNote:
      "Our engineers travel to sites across Melbourne and regional Victoria — our Victorian work includes georeferenced surveys on the Glenrowan Solar Farm.",
    faq: [
      {
        q: "Why do I need a dilapidation report in Melbourne?",
        a: "Also called a property condition report, a Melbourne dilapidation report is a photographic and written record of the adjoining properties' condition. With Victoria's Big Build driving tunnelling and excavation across the city, it's the evidence that protects you when construction-related damage is alleged — and councils frequently require it before works begin.",
      },
      {
        q: "Do you cover regional Victoria as well as Melbourne?",
        a: "Yes. Our engineers attend sites across metropolitan Melbourne and regional Victoria. Our Victorian project experience includes georeferenced dilapidation surveys on the $170M Glenrowan Solar Farm.",
      },
      {
        q: "How long does a Melbourne dilapidation report take?",
        a: "It depends on the number of properties and the scope. Smaller residential surveys can be completed quickly; larger corridor or infrastructure jobs are scheduled in stages. Send us the detail and we'll scope it.",
      },
    ],
  },
  {
    slug: "dilapidation-reports-wollongong",
    city: "Wollongong",
    state: "NSW",
    region: "New South Wales",
    title: "Dilapidation Reports Wollongong | Illawarra Condition Surveys NSW",
    metaDescription:
      "Specialist dilapidation reports across Wollongong and the Illawarra. Pre- and post-construction property condition surveys compliant with AS 4349.0 — proven on the Dapto bridge works for Wollongong City Council.",
    h1: "Dilapidation Reports Wollongong",
    intro:
      "Planning a demolition or construction project in Wollongong or the Illawarra? A dilapidation report is a photographic and written record of the condition of the adjoining properties — buildings, pathways, fences and roads — that should be filed before work starts. It can seem like added paperwork, but the protection it provides is long-term.",
    why: {
      heading: "Local growth, local proof.",
      body: "From the West Dapto Access Strategy to Transport Access Program station upgrades across the Illawarra, the region is investing in roads, bridges and rail. AusDilaps has delivered on that work directly — including dilapidation inspections of over 160 properties and 1.2km of roadway for Wollongong City Council's Fowlers Road bridge link, and station-refresh inspections at Oak Flats and Minnamurra.",
    },
    drivers: [
      "Condition reports required before works begin on adjoining property",
      "Council and infrastructure works — roads, bridges and rail upgrades",
      "Flood-mitigation and access projects across the Illawarra",
      "Bond protection on works affecting council-owned assets",
    ],
    localProjects: ["dapto-bridge", "transport-for-nsw-station-refresh-project"],
    serviceNote:
      "Our engineers attend sites across Wollongong, the Illawarra, the South Coast and down to Shellharbour and Kiama.",
    faq: [
      {
        q: "Are dilapidation reports required in Wollongong?",
        a: "As a matter of policy on most projects, a Wollongong dilapidation report should be filed before work starts. It records all visual defects — cracks, spalling concrete, distortion — on the adjoining properties, backed by photographs and notes, so any later damage claim is resolved on the evidence.",
      },
      {
        q: "Have you worked on Wollongong projects before?",
        a: "Yes — AusDilaps delivered dilapidation inspections of over 160 properties and 1.2km of roadway for Wollongong City Council's Fowlers Road to Fairwater Drive bridge link, part of the West Dapto Access Strategy, plus Transport Access Program station upgrades across the Illawarra.",
      },
      {
        q: "How do I get a quote for a Wollongong dilapidation report?",
        a: "Contact us with the project, location and number of adjoining properties. We'll prepare an itemised quote and arrange access on your behalf once you proceed.",
      },
    ],
  },
  {
    slug: "dilapidation-reports-canberra",
    city: "Canberra",
    state: "ACT",
    region: "Australian Capital Territory",
    isNew: true,
    title: "Dilapidation Reports Canberra | ACT Property Condition Surveys",
    metaDescription:
      "Specialist dilapidation reports across Canberra and the ACT. Pre- and post-construction condition surveys compliant with AS 4349.0 — proven on the Australian War Memorial and Commonwealth government works.",
    h1: "Dilapidation Reports Canberra",
    intro:
      "Canberra's mix of Commonwealth landmarks, government precincts and growing residential development demands exacting documentation. A dilapidation report records the condition of adjoining and heritage-listed property before and after works — the defensible baseline that protects sensitive, high-profile projects.",
    why: {
      heading: "Trusted on Canberra's most sensitive landmarks.",
      body: "We've delivered dilapidation and condition reporting on some of the capital's most important works — extreme-detail heritage documentation at the Australian War Memorial alongside Lendlease, a full fit-out condition report for the Department of Prime Minister and Cabinet, and hospital upgrade works at Garran. That's the standard of discretion and detail Canberra projects require.",
    },
    drivers: [
      "Works adjoining heritage-listed or Commonwealth-owned property",
      "Government fit-outs and precinct upgrades requiring condition reports",
      "Hospital, defence and institutional works",
      "Residential and commercial development across the ACT",
    ],
    localProjects: [
      "australian-war-memorial",
      "department-of-prime-minister-and-cabinet",
      "canberra-hospital-upgrade-royal-north-shore-hospital-and-westmead-private-hospital",
    ],
    serviceNote:
      "Our engineers attend sites across Canberra and the ACT, and hold the certifications required for government and defence environments.",
    faq: [
      {
        q: "Has AusDilaps worked in Canberra?",
        a: "Yes — extensively. Our Canberra project experience includes heritage condition documentation at the Australian War Memorial, a full fit-out condition report for the Department of Prime Minister and Cabinet, and hospital upgrade works at Garran.",
      },
      {
        q: "Do you handle heritage-listed and government property?",
        a: "Yes. Much of our Canberra work involves heritage-listed and Commonwealth-owned property, documented to exacting detail with the discretion these sites require.",
      },
      {
        q: "How do I request a Canberra dilapidation report?",
        a: "Tell us the project, location and the adjoining or heritage-listed properties involved, and we'll scope an itemised quote.",
      },
    ],
  },
  {
    slug: "dilapidation-reports-perth",
    city: "Perth",
    state: "WA",
    region: "Western Australia",
    isNew: true,
    title: "Dilapidation Reports Perth | Property Condition Surveys WA",
    metaDescription:
      "Specialist dilapidation reports for Perth and Western Australia. Pre- and post-construction property condition surveys compliant with AS 4349.0 — a national specialist available Australia-wide.",
    h1: "Dilapidation Reports Perth",
    intro:
      "Building, excavating or demolishing near third-party property in Perth? A dilapidation report documents the existing condition of the adjoining buildings and assets before and after works — the defensible baseline that resolves damage claims on evidence, not argument.",
    why: {
      heading: "A national specialist, available Australia-wide.",
      body: "AusDilaps is Australia's specialist dilapidation firm — 15 years, a team of structural engineers, and reports compliant with AS 4349.0. We deliver more than 1,000 surveys a quarter and travel to projects Australia-wide, bringing the same evidentiary-grade capture and engineer sign-off to Perth and Western Australian sites that we bring to the eastern seaboard.",
    },
    drivers: [
      "Council requirements for condition reports before works begin",
      "Excavation, piling or demolition adjoining third-party property",
      "Resource, civil and infrastructure projects",
      "Insurance and dispute exposure on construction-related damage",
    ],
    localProjects: [],
    serviceNote:
      "AusDilaps is HQ'd in Queensland and delivers on-site Australia-wide. For Perth and WA projects, our engineers travel to your site — get in touch to scope it.",
    faq: [
      {
        q: "Does AusDilaps service Perth and WA?",
        a: "Yes. AusDilaps is a national dilapidation specialist available Australia-wide. While our heaviest presence is along the eastern seaboard, our engineers travel to Perth and Western Australian projects — contact us to scope your job.",
      },
      {
        q: "What standard are your reports compliant with?",
        a: "Every AusDilaps report is compliant with Australian Standard AS 4349.0, with precise defect categorisation, location-referenced imagery and professional engineer sign-off.",
      },
      {
        q: "How do I get a quote for a Perth dilapidation report?",
        a: "Tell us the project, location and number of adjoining properties, and we'll prepare an itemised quote — including travel and scheduling.",
      },
    ],
  },
];

export const LOCATION_BY_SLUG: Record<string, Location> = Object.fromEntries(
  LOCATIONS.map((l) => [l.slug, l])
);

export const LOCATION_SLUGS = LOCATIONS.map((l) => l.slug);
