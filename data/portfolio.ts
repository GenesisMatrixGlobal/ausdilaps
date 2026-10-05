// Portfolio projects. Slugs are VERBATIM from the live portfolio sitemap (ranking
// URLs — preserved exactly). Content harvested from the live project pages and the
// FY25/26 Capability Statement. Real clients, values and AusDilaps scope only —
// no fabricated metrics. The 3 Capability-Statement case studies are merged in
// from data/case-studies.ts as richer, featured entries.

import { CASE_STUDIES } from "@/data/case-studies";

export const SECTORS = [
  "Road & Transport",
  "Rail",
  "Hospital",
  "Government & Defence",
  "Commercial & Hotel",
  "Aviation & Port",
  "Energy",
] as const;

export type Sector = (typeof SECTORS)[number];

export type PortfolioStat = { value: string; label: string };

export type PortfolioItem = {
  slug: string;
  name: string;
  sector: Sector;
  location: string;
  client?: string;
  year?: string;
  value?: string;
  image?: string;
  imageAlt?: string;
  /** Keep a small portrait photograph at its source width in the project hero. */
  imagePortrait?: boolean;
  /** card + meta one-liner */
  blurb: string;
  /** the project context (real) */
  description?: string;
  /** AusDilaps' scope of work (real) */
  scope?: string;
  stats?: PortfolioStat[];
  featured?: boolean;
  isCaseStudy?: boolean;
  /** case-study only */
  objective?: string;
  solution?: string;
};

/** The 22-strong project portfolio (legacy slugs preserved verbatim). */
const PROJECTS: PortfolioItem[] = [
  {
    slug: "northconnex",
    name: "NorthConnex",
    sector: "Road & Transport",
    location: "Pennant Hills to Wahroonga, NSW",
    client: "Transurban & NSW Government",
    year: "2019",
    value: "$2.65B",
    image: "/projects/northconnex.jpg",
    blurb: "Dilapidation inspections along the route of Sydney's nine-kilometre twin motorway tunnels.",
    description:
      "NorthConnex provides twin motorway tunnels around nine kilometres in length, with a height clearance of 5.3m and a speed limit of 80km/h — linking the M1 Pacific Motorway at Wahroonga to the Hills M2 Motorway at West Pennant Hills, including northern and southern interchanges, ventilation outlets and a motorway control centre.",
    scope: "AusDilaps' scope of work included dilapidation inspections on several properties along the project route.",
  },
  {
    slug: "westconnex",
    name: "WestConnex",
    sector: "Road & Transport",
    location: "Sydney's Inner West, NSW",
    client: "Lendlease, Bouygues & Samsung JV",
    year: "2020",
    value: "$15B",
    image: "/portfolio/westconnex.jpg",
    imageAlt: "WestConnex motorway tunnel entrance at dusk",
    blurb: "6,000+ properties inspected for Australia's largest road infrastructure project.",
    description:
      "WestConnex is part of an integrated transport plan to keep Sydney moving — easing congestion, creating jobs and connecting communities. Works included widening the M4 between Parramatta and Homebush, extending it in twin underground tunnels from Homebush to Haberfield, and upgrading the King Georges Road M5 interchange.",
    scope:
      "AusDilaps had the opportunity to inspect over 6,000 properties within close vicinity of the construction works.",
    stats: [{ value: "6,000+", label: "properties inspected" }],
  },
  {
    slug: "the-northern-road-upgrade",
    name: "The Northern Road Upgrade",
    sector: "Road & Transport",
    location: "Luddenham, NSW",
    client: "Lendlease, Georgiou, Burton & Fulton Hogan",
    year: "2021",
    value: "$4.1B",
    image: "/portfolio/the-northern-road-upgrade.jpg",
    blurb: "400+ properties documented across upgrades supporting the new Western Sydney Airport.",
    description:
      "These combined roadway upgrades deliver new and improved roads to support integrated transport in the region and capitalise on the economic benefits of the Western Sydney Airport at Badgerys Creek — improving safety, increasing capacity and reducing congestion. The works span an 11.3km primary upgrade and a 4.3km second stage, with grade-separated interchanges and shared paths.",
    scope: "AusDilaps delivered dilapidation reporting across the upgrade corridor.",
    stats: [{ value: "400+", label: "properties documented" }],
  },
  {
    slug: "mona-vale-road-upgrade",
    name: "Mona Vale Road Upgrade",
    sector: "Road & Transport",
    location: "Terrey Hills to Mona Vale, NSW",
    client: "Georgiou",
    year: "2019",
    value: "$140M",
    image: "/portfolio/mona-vale-road-upgrade.jpg",
    blurb: "450 properties documented as Mona Vale Road was widened from two lanes to four.",
    description:
      "The NSW Government upgraded Mona Vale Road from two lanes to four between Terrey Hills and Mona Vale. The project was staged to provide a better travelling experience and to improve safety and traffic efficiency.",
    scope: "AusDilaps delivered dilapidation reporting services for the upgrade.",
    stats: [{ value: "450", label: "properties documented" }],
  },
  {
    slug: "dapto-bridge",
    name: "Dapto (Fowlers Road) Bridge",
    sector: "Road & Transport",
    location: "Dapto, NSW",
    client: "Abergeldie · Wollongong City Council",
    year: "2019",
    value: "$40M",
    image: "/portfolio/dapto-bridge.jpg",
    blurb: "160+ properties and 1.2km of roadway documented for the West Dapto Access Strategy.",
    description:
      "Wollongong City Council engaged Abergeldie as head contractor to extend Fowlers Road from the Princes Highway to the Fairwater Drive/Daisy Bank Drive roundabout. The Fowlers Road to Fairwater Drive Link is one of several road improvements under the broader West Dapto Access Strategy — providing bridges, roads and shared paths to improve flood-period access, reduce congestion and connect West Dapto's growing population.",
    scope: "AusDilaps completed dilapidation inspections of over 160 properties and 1.2km of roadway.",
    stats: [
      { value: "160+", label: "properties inspected" },
      { value: "1.2km", label: "of roadway documented" },
    ],
  },
  {
    slug: "northern-beaches-b-line",
    name: "Northern Beaches B-Line",
    sector: "Road & Transport",
    location: "Mona Vale to Sydney CBD, NSW",
    client: "Fulton Hogan & Transport for NSW",
    year: "2019",
    value: "$600M",
    image: "/portfolio/northern-beaches-b-line.jpg",
    blurb: "2,000+ residential and commercial properties documented along the B-Line bus corridor.",
    description:
      "The B-Line Program is an integrated package of service and infrastructure improvements designed to provide more reliable journeys between Mona Vale and the Sydney CBD — featuring modern bus stops and four new commuter car parks to encourage park-and-ride.",
    scope:
      "AusDilaps provided dilapidation reports for over 2,000 residential and commercial properties located near the B-Line project.",
    stats: [{ value: "2,000+", label: "properties documented" }],
  },

  /* ── Rail ────────────────────────────────────────────────────────── */
  {
    slug: "northwest-rail-link",
    name: "North West Rail Link",
    sector: "Rail",
    location: "Rouse Hill to Chatswood, NSW",
    client: "Lendlease & Transport for NSW",
    year: "2019",
    value: "$8.3B",
    image: "/projects/north-west-rail-link.jpg",
    blurb: "32km of council assets and property façades inspected for Australia's first fully automated metro.",
    description:
      "Sydney Metro Northwest (formerly the North West Rail Link) delivered eight new railway stations across Sydney's growing North West — the first fully automated metro rail system in Australia, with trains running every four minutes and 4,000 commuter car-parking spaces.",
    scope:
      "Lendlease and Transport for NSW tasked AusDilaps with providing dilapidation reports, including the inspection of 32km of council assets and property façades along the early-works route.",
    stats: [{ value: "32km", label: "council assets & façades inspected" }],
  },
  {
    slug: "zig-zag-railway-blue-mountains",
    name: "Zig Zag Railway, Blue Mountains",
    sector: "Rail",
    location: "Clarence & Bell, Blue Mountains, NSW",
    client: "CPB Contractors",
    year: "2019",
    value: "$2.3M",
    image: "/portfolio/zig-zag-railway-blue-mountains.jpg",
    imageAlt: "Zig Zag Railway station in the Blue Mountains",
    blurb: "12 heritage rail tunnels, tracks and stations inspected on a beloved Blue Mountains landmark.",
    description:
      "Zig Zag Railway is a tourist attraction throughout the Blue Mountains region, and AusDilaps had the opportunity to work on restoring this part of history. The railway works included clearing and resealing the car park, refurbishing the amenities building and the crossing, track works and the installation of two electric charging stations.",
    scope: "AusDilaps inspected the heritage-listed rail tunnels, tracks and stations along the route.",
    stats: [{ value: "12", label: "heritage rail tunnels inspected" }],
  },
  {
    slug: "epping-to-thornleigh-third-track",
    name: "Epping to Thornleigh Third Track",
    sector: "Rail",
    location: "Epping to Thornleigh, NSW",
    client: "Transport for NSW",
    image: "/portfolio/epping-to-thornleigh-third-track.jpg",
    imageAlt: "Freight train on a rail corridor",
    blurb: "Dilapidation surveys along the corridor of a new third rail track on Sydney's Main North line.",
    description:
      "The Epping to Thornleigh Third Track added a third railway track between Epping and Thornleigh on Sydney's Main North line, separating freight and passenger services to increase capacity and reliability on a heavily used section of the network.",
    scope: "AusDilaps delivered dilapidation surveys on properties and assets along the project corridor.",
  },
  {
    slug: "transport-for-nsw-station-refresh-project",
    name: "Transport for NSW Station Refresh Project",
    sector: "Rail",
    location: "Oak Flats, Thornleigh, Minnamurra, Regents Park & Allawah, NSW",
    client: "Transport for NSW",
    year: "2019",
    image: "/portfolio/transport-for-nsw-station-refresh-project.jpg",
    imageAlt: "Train and station buildings at Allawah railway station",
    blurb: "Dilapidation inspections across six stations upgraded under the Transport Access Program.",
    description:
      "The upgrades at Oak Flats, Thornleigh, Minnamurra, Regents Park and Allawah stations were delivered as part of the Transport Access Program — an NSW Government initiative providing accessible, modern, secure and integrated transport infrastructure, including precincts accessible to those with a disability, limited mobility, prams and luggage.",
    scope:
      "AusDilaps provided dilapidation inspections across the stations; our team members hold rail-industry worker certifications enabling comprehensive corridor inspections.",
    stats: [{ value: "6", label: "stations" }],
  },

  /* ── Hospital ────────────────────────────────────────────────────── */
  {
    slug: "blacktown-hospital",
    name: "Blacktown Hospital",
    sector: "Hospital",
    location: "Blacktown, NSW",
    client: "A W Edwards & Laing O'Rourke",
    year: "2020",
    value: "$700M",
    image: "/portfolio/blacktown-hospital.jpg",
    blurb: "Multi-stage condition reporting for a major expansion of Sydney's west health services.",
    description:
      "Recognising that a growing and ageing population and the massive expansion in Sydney's west had changed the community, the NSW Government expanded Blacktown Hospital — a new emergency department with psychiatric services, a new intensive care unit, eight operating theatres, expanded birthing and maternity facilities, paediatric services, medical imaging and a 420-space car park.",
    scope: "AusDilaps worked across multiple construction stages, documenting conditions on different sections of the works.",
  },
  {
    slug: "northern-beaches-hospital",
    name: "Northern Beaches Hospital",
    sector: "Hospital",
    location: "Frenchs Forest, NSW",
    client: "Ferrovial York JV · Health Infrastructure NSW",
    year: "2018",
    value: "$2B",
    image: "/portfolio/northern-beaches-hospital.jpg",
    blurb: "410 pre- and post-construction property inspections for a purpose-built 488-bed hospital.",
    description:
      "The Northern Beaches Hospital in Frenchs Forest is a purpose-built facility with 488 beds (60% public, 40% private), a large integrated emergency department, state-of-the-art intensive and critical care units and a modern inpatient mental health facility. The hospital was a finalist for the 2018 Australian Construction Achievement Award.",
    scope: "AusDilaps conducted 410 residential and commercial property condition inspections, before and after construction.",
    stats: [{ value: "410", label: "property inspections" }],
  },
  {
    slug: "canberra-hospital-upgrade-royal-north-shore-hospital-and-westmead-private-hospital",
    name: "Canberra, Royal North Shore & Westmead Private Hospitals",
    sector: "Hospital",
    location: "Garran ACT, Sydney & Westmead NSW",
    client: "Shape, Garde & Erilian",
    year: "2019",
    image: "/portfolio/canberra-hospital-upgrade.jpg",
    blurb: "Condition reporting across three hospital upgrades — new wings, car parks and full refurbishments.",
    description:
      "These hospitals completed a range of works including new wings to house state-of-the-art facilities, multi-storey car park upgrades, short-stay patient accommodation, and complete fit-outs and refurbishments of existing amenities.",
    scope:
      "Commissioned across the three hospital projects, AusDilaps provided condition reporting to the highest degree of discretion while covering every detail of these sensitive, operational sites.",
  },

  /* ── Government & Defence ─────────────────────────────────────────── */
  {
    slug: "hmas-waterhen-hmas-albatross-and-hmas-creswell",
    name: "HMAS Waterhen, Albatross & Creswell",
    sector: "Government & Defence",
    location: "Sydney & Jervis Bay, NSW",
    client: "Duratec, Lendlease, Barpa & Dept. of Defence",
    year: "2019",
    image: "/portfolio/hmas-waterhen-hmas-albatross-and-hmas-creswell.jpg",
    blurb: "Heritage-listed defence facilities documented to exacting standards across three naval bases.",
    description:
      "The Australian Defence Force undertakes refurbishments to ensure its facilities maintain a high standard. Across these three naval establishments — commissioned by a range of contractors — AusDilaps ensured the heritage-listed components were documented to the highest standards.",
    scope: "AusDilaps provided dilapidation expertise with extensive detail on even the most minor heritage-listed components.",
  },
  {
    slug: "australian-war-memorial",
    name: "Australian War Memorial",
    sector: "Government & Defence",
    location: "Canberra, ACT",
    client: "Lendlease",
    year: "2019",
    image: "/portfolio/australian-war-memorial.jpg",
    imageAlt: "Courtyard and Hall of Memory at the Australian War Memorial in Canberra",
    blurb: "Extreme-detail heritage documentation on one of Australia's most important landmarks.",
    description:
      "This project was very special to AusDilaps — being such an important Australian landmark, it required extreme detail across multiple heritage-listed components, undertaken alongside Lendlease.",
    scope: "AusDilaps delivered heritage condition documentation to exacting detail across the memorial's protected components.",
  },
  {
    slug: "department-of-prime-minister-and-cabinet",
    name: "Department of Prime Minister & Cabinet",
    sector: "Government & Defence",
    location: "Canberra, ACT",
    client: "SHAPE",
    year: "2019",
    value: "$411M",
    image: "/portfolio/department-of-prime-minister-and-cabinet.jpg",
    blurb: "Condition reports for a full fit-out of a Commonwealth government building.",
    description:
      "AusDilaps were contracted by SHAPE to provide dilapidation reports for the Department of Prime Minister and Cabinet building, where SHAPE were conducting a full fit-out.",
    scope: "AusDilaps completed condition reports for the full building fit-out.",
  },

  /* ── Commercial & Hotel ──────────────────────────────────────────── */
  {
    slug: "barangaroo-south",
    name: "Barangaroo South",
    sector: "Commercial & Hotel",
    location: "Barangaroo, Sydney, NSW",
    client: "Lendlease",
    year: "2024",
    value: "$6B",
    image: "/projects/barangaroo.jpg",
    blurb: "Sydney's largest urban renewal project since the 2000 Olympics.",
    description:
      "AusDilaps worked with Lendlease on Sydney's largest urban renewal project since the 2000 Olympics — one of the world's most significant waterfront transformations at the time of construction. The former container wharf became a vibrant new waterfront financial district, with world-class sustainable office space, premium residential, and lively retail, dining, hotel and public spaces.",
    scope: "AusDilaps delivered dilapidation reporting across the precinct works.",
  },
  {
    slug: "queens-wharf-brisbane",
    name: "Queen's Wharf Brisbane",
    sector: "Commercial & Hotel",
    location: "Brisbane CBD, QLD",
    client: "Probuild",
    year: "2022",
    value: "$3.6B",
    image: "/projects/queens-wharf.jpg",
    blurb: "Inspections on surrounding heritage-listed buildings for a CBD-transforming integrated resort.",
    description:
      "The Queen's Wharf project demolished three non-heritage former government buildings to create an integrated resort development — luxury hotels, restaurants, accessible public space and retail. Brisbane's heritage was preserved through protection plans for nine heritage buildings and two heritage parks, restored and incorporated into the precinct.",
    scope:
      "AusDilaps worked with Probuild to provide dilapidation reports, carrying out inspections on the surrounding heritage-listed buildings.",
  },
  {
    slug: "adina-apartment-hotel-pier-one-hotel-four-seasons-hotel-circular-quay",
    name: "Adina, Pier One & Four Seasons Hotels",
    sector: "Commercial & Hotel",
    location: "Sydney, NSW",
    client: "Various builders",
    year: "2018–2019",
    image: "/portfolio/adina-four-seasons-circular-quay.jpg",
    blurb: "Fast, comprehensive high-rise hotel inspections on time-sensitive refurbishment projects.",
    description:
      "Adina, Pier One and Four Seasons are a handful of the hotels AusDilaps has serviced. Completing inspections on high-rise buildings within short time frames is a testament to how hard our inspectors work to provide fast yet comprehensive reports. Hotels undergo minor refurbishments roughly every five years and major refurbishments every ten — and these time-sensitive projects create a real sense of urgency.",
    scope: "AusDilaps delivered dilapidation reports on high-rise hotel buildings within tight timeframes.",
  },

  /* ── Aviation & Port ─────────────────────────────────────────────── */
  {
    slug: "brisbane-airport",
    name: "Brisbane Airport (BNE)",
    sector: "Aviation & Port",
    location: "Brisbane, QLD",
    client: "Skyway Joint Venture",
    year: "2018",
    image: "/projects/brisbane-airport.jpg",
    blurb: "Heritage-listed items inspected adjoining the works at Queensland's primary gateway.",
    description:
      "Brisbane Airport Corporation carried out an extensive investment program — more than $1.7 billion since FY12 — building Brisbane's New Runway, redeveloping the Domestic Terminal, a new multi-storey car park, and a new industrial park and auto mall. As the primary gateway to Queensland, Brisbane Airport welcomes millions of visitors annually.",
    scope: "AusDilaps' scope of work was to inspect heritage-listed items adjoining the site works.",
  },
  {
    slug: "port-botany-bulk-liquids-berth",
    name: "Port Botany Bulk Liquids Berth",
    sector: "Aviation & Port",
    location: "Port Botany, Sydney, NSW",
    client: "John Holland",
    year: "2014",
    image: "/portfolio/port-botany-bulk-liquids-berth.jpg",
    blurb: "Roads and infrastructure inspected adjoining NSW's primary bulk liquid and gas port.",
    description:
      "Port Botany is Australia's premium port and home to the state's largest container facility — NSW's primary bulk liquid and gas port, with the largest dedicated common-user facility of its type in Australia. The facilities handle 100% of the state's bitumen, 90% of bulk chemicals, 70% of LPG demand and 28% of jet fuel.",
    scope:
      "AusDilaps carried out inspections and reports on the roads and infrastructure adjoining the berth and the petrochemical and liquid storage facilities.",
  },
];

/** Map the 3 Capability-Statement case studies into the portfolio shape. */
const CASE_STUDY_META: Record<
  string,
  { sector: Sector; image: string; imageAlt: string; imagePortrait?: boolean }
> = {
  "main-south-road-duplication": {
    sector: "Road & Transport",
    image: "/portfolio/main-south-road-duplication.jpeg",
    imageAlt: "Aerial view of the Main South Road duplication works",
    imagePortrait: true,
  },
  "ipswich-hospital": {
    sector: "Hospital",
    image: "/portfolio/ipswich-hospital.jpeg",
    imageAlt: "Entrance and main building of Ipswich Hospital",
  },
  "glenrowan-solar-farm": {
    sector: "Energy",
    image: "/portfolio/glenrowan-solar-farm.png",
    imageAlt: "Aerial view of solar panels at Glenrowan Solar Farm",
  },
};

const CASE_STUDY_ITEMS: PortfolioItem[] = CASE_STUDIES.map((c) => ({
  slug: c.slug,
  name: c.project,
  sector: CASE_STUDY_META[c.slug]?.sector ?? "Road & Transport",
  location: c.location,
  client: c.client,
  year: c.date,
  value: c.value,
  image: CASE_STUDY_META[c.slug]?.image,
  imageAlt: CASE_STUDY_META[c.slug]?.imageAlt,
  imagePortrait: CASE_STUDY_META[c.slug]?.imagePortrait,
  blurb: c.objective,
  description: c.objective,
  scope: c.solution,
  stats: c.stats,
  featured: true,
  isCaseStudy: true,
  objective: c.objective,
  solution: c.solution,
}));

/** Featured case studies first, then the project portfolio. */
export const PORTFOLIO: PortfolioItem[] = [...CASE_STUDY_ITEMS, ...PROJECTS];

export const PORTFOLIO_BY_SLUG: Record<string, PortfolioItem> = Object.fromEntries(
  PORTFOLIO.map((p) => [p.slug, p])
);

export const PORTFOLIO_SLUGS = PORTFOLIO.map((p) => p.slug);
