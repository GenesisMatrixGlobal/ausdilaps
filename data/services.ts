// Service-page content. Harvested verbatim from the live ausdilaps.com.au
// service pages and the FY25/26 Capability Statement, lightly tightened to the
// AusDilaps voice. Real content only — no fabricated stats or claims.

import { CAPTURE_METHODS } from "@/lib/site";
import type { ContentSectionData } from "@/components/marketing/content-section";
import type { FaqItem } from "@/data/faq";

export type Service = {
  slug: string;
  /** <title> */
  title: string;
  metaDescription: string;
  h1: string;
  eyebrow: string;
  /** short label for nav menus / footer (falls back to h1) */
  navLabel?: string;
  /** one-line summary for index cards + related-links descriptions */
  summary: string;
  /** answer-first lead paragraph */
  intro: string;
  sections: ContentSectionData[];
  /** reuse a FAQ category from data/faq.ts … */
  faqId?: string;
  /** … or supply page-specific Q&A (grounded in the live copy) */
  faqInline?: FaqItem[];
  /** related service slugs (or the special "dilapidation-reports" pillar) */
  related: string[];
  /** schema.org Service name */
  schemaName: string;
};

const captureBand: ContentSectionData = {
  eyebrow: "Evidentiary-grade capture",
  heading: "The right technique for every asset.",
  body: "From a single residential build to major infrastructure, we match the capture method to the asset so the record is defensible — not just a folder of photos.",
  chips: CAPTURE_METHODS,
  layout: "split",
  variant: "dark",
};

export const SERVICES_CONTENT: Service[] = [
  /* ── Commercial dilapidation ─────────────────────────────────────── */
  {
    slug: "commercial-dilapidation-reports",
    title: "Commercial Dilapidation Reports | Council-Ready Condition Reports",
    metaDescription:
      "Independent commercial dilapidation reports that document the pre and post-construction condition of council-owned and adjoining assets — protecting your investment and your bond. Backed by structural engineers.",
    h1: "Commercial Dilapidation Reports",
    eyebrow: "Commercial Dilapidation",
    navLabel: "Commercial",
    summary: "Council-ready pre and post-construction condition reports for commercial property.",
    intro:
      "Owning a commercial property is a significant investment. Before construction or development begins, a commercial dilapidation report documents the existing condition of council-owned and adjoining assets — mitigating the risk of damage claims and protecting your bond.",
    sections: [
      {
        eyebrow: "Independent expertise",
        heading: "Prepared by experts who catch what others miss.",
        body: "These reports are independently prepared by experts who can identify pre-existing conditions or concerns that might otherwise be missed. Whether your property has adjoining walls with other commercial premises or stands freestanding, a commercial dilapidation report confirms you have covered all pre and post-construction requirements.",
        variant: "light",
      },
      {
        eyebrow: "Why AusDilaps",
        heading: "Set up to fill the commercial dilapidation gap.",
        body: "AusDilaps was established to fill a growing gap for commercial dilapidation services that other building-survey providers were not meeting. Our team isn't only qualified, experienced building inspectors — it includes several structural engineers, a real advantage when it comes to the detail commercial construction demands. Our clients span Australia and value us for efficiency, cost-effectiveness and professionalism.",
        variant: "surface",
      },
      {
        eyebrow: "What it covers",
        heading: "A dual pre and post-construction process.",
        cards: [
          {
            n: "01 — Pre-construction",
            title: "Verify existing conditions",
            body: "An on-site inspection by a qualified team member documents any structural issues or damage to council-owned and adjoining assets — kerbing, roadways, drainage, pathways — supported by a photographic portfolio.",
          },
          {
            n: "02 — Post-construction",
            title: "Prove what changed",
            body: "A matching inspection after works identifies any change or damage caused by heavy machinery or excavation, evidenced and matched to the pre-construction baseline — the record councils need before returning your bond.",
          },
        ],
        variant: "light",
      },
      captureBand,
      {
        eyebrow: "Where it applies",
        heading: "Regular AusDilaps commercial projects.",
        chips: [
          "Highway upgrades",
          "Railway stations",
          "Bridges",
          "Schools",
          "Unit blocks",
          "Warehouses",
          "Swimming pools",
          "Pipelines",
          "Factories",
          "Shops",
          "Office blocks",
        ],
        layout: "split",
        body: "Our top-of-the-line equipment and detailed photographic reports are used to compile commercial dilapidation reports for council certification, insurance requirements and development approvals.",
        variant: "surface",
      },
    ],
    faqId: "dilapidation-reports",
    related: ["residential-dilapidation-reports", "industrial-dilapidation-reports", "dilapidation-reports"],
    schemaName: "Commercial Dilapidation Reports",
  },

  /* ── Residential dilapidation ────────────────────────────────────── */
  {
    slug: "residential-dilapidation-reports",
    title: "Residential Dilapidation Reports | Pre-Construction Site Surveys",
    metaDescription:
      "Residential dilapidation reports for builds, renovations and demolitions. Document the condition of neighbour- and council-owned assets to mitigate claims — from a team of structural engineers and building inspectors.",
    h1: "Residential Dilapidation Reports",
    eyebrow: "Residential Dilapidation",
    navLabel: "Residential",
    summary: "Dilapidation reports for residential builds, renovations and demolitions.",
    intro:
      "Land and housing are among the most stable and lucrative personal assets — so when construction work is planned, you don't want to cut corners on having the site correctly evaluated for dilapidation before any work begins.",
    sections: [
      {
        eyebrow: "Residential dilapidation services",
        heading: "Cover all bases — before and after.",
        body: "Many councils now require a dilapidation inspection prior to construction on a residential site, and a post-construction inspection is strongly recommended too. Mitigate any risk of claims from your council or your neighbours by engaging a reputable company that specialises in residential dilapidation reporting.",
        variant: "light",
      },
      {
        eyebrow: "Why AusDilaps",
        heading: "Structural engineers and expert building inspectors.",
        body: "AusDilaps was originally established to service an increasing demand for residential dilapidation services. Our specialist team is a collection of experienced structural engineers and expert building inspectors — knowledgeable in their field and able to pinpoint issues that may arise during a construction project.",
        variant: "surface",
      },
      {
        eyebrow: "What we document",
        heading: "Every neighbour- and council-owned asset at risk.",
        body: "Our reports detail existing issues or damage to council- or neighbour-owned assets such as driveways, retaining walls, roadways, pools, fences, buildings and landscaping. We liaise closely with you on-site and off — pre-construction, during, and post-construction — and tailor each report to your project, no matter its size or complexity.",
        bullets: [
          "Driveways, roadways and kerbing",
          "Retaining walls and fences",
          "Pools and landscaping",
          "Buildings and adjoining structures",
        ],
        layout: "split",
        variant: "light",
      },
      captureBand,
    ],
    faqId: "dilapidation-reports",
    related: ["commercial-dilapidation-reports", "industrial-dilapidation-reports", "dilapidation-reports"],
    schemaName: "Residential Dilapidation Reports",
  },

  /* ── Industrial dilapidation ─────────────────────────────────────── */
  {
    slug: "industrial-dilapidation-reports",
    title: "Industrial Dilapidation Reports | Factories, Warehouses & Pipelines",
    metaDescription:
      "Industrial dilapidation reports for factories, warehouses, pipelines and railway sites. A two-step pre and post-construction process that verifies conditions and mitigates damage claims.",
    h1: "Industrial Dilapidation Reports",
    eyebrow: "Industrial Dilapidation",
    navLabel: "Industrial",
    summary: "Condition reporting for factories, warehouses, pipelines and industrial sites.",
    intro:
      "Construction on an industrial property is a big decision and a substantial financial investment. With lawsuits and litigation growing year on year, many councils now require dilapidation reports for industrial construction projects — so it pays to have the work carried out by specialised professionals.",
    sections: [
      {
        eyebrow: "Industrial dilapidation services",
        heading: "Processes carried out by specialists.",
        body: "Industrial projects involve a substantial financial investment, so it's important the work is carried out by specialised professionals who know what to look for and how to prepare reports correctly. Industrial dilapidation reports help mitigate the risk of claims stemming from the construction phase of a project.",
        variant: "light",
      },
      {
        eyebrow: "Our recommended two-step process",
        heading: "Pre and post-construction, matched.",
        cards: [
          {
            n: "01 — Pre-construction",
            title: "Confirm the baseline",
            body: "A documented on-site inspection with a photographic portfolio outlines existing issues — verifying pre-construction conditions and confirming the stability of assets before extensive excavation involving heavy machinery.",
          },
          {
            n: "02 — Post-construction",
            title: "Match and confirm",
            body: "A specialist inspects the completed works, focusing on pre-existing areas of concern and any new issues. Every detail is confirmed in writing and matched with the pre-construction report should any claims be made — and when seeking your bond back from the council.",
          },
        ],
        variant: "surface",
      },
      {
        eyebrow: "Where it applies",
        heading: "Regular AusDilaps industrial projects.",
        chips: ["Farms", "Schools", "Warehouses", "Railway stations", "Pipelines", "Factories", "Office blocks"],
        layout: "split",
        body: "Catering to clients in Sydney, Wollongong, the Central Coast, Newcastle, the Gold Coast, Brisbane and the Sunshine Coast, we specialise in property condition reports across industrial assets.",
        variant: "light",
      },
      captureBand,
    ],
    faqId: "dilapidation-reports",
    related: ["commercial-dilapidation-reports", "residential-dilapidation-reports", "dilapidation-reports"],
    schemaName: "Industrial Dilapidation Reports",
  },

  /* ── Structural engineering ──────────────────────────────────────── */
  {
    slug: "structural-engineering",
    title: "Structural Engineering | Design, Certificates & Existing-Structure Reviews",
    metaDescription:
      "Structural engineering from AusDilaps — concrete, steel and timber design, structural design certificates, existing-structure reviews, and excavation and demolition assessments. No project too small.",
    h1: "Structural Engineering",
    eyebrow: "Structural Engineering",
    navLabel: "Structural Engineering",
    summary: "Chartered structural design, certificates and existing-structure reviews.",
    intro:
      "Successful structural engineering relies on understanding the client's needs and applying the latest design technology in a way that enhances a structure's functionality and look — without onerous financial commitments or inflexible building use. We deliver it from simple wall removals to the detailed design of high-rise buildings.",
    sections: [
      {
        eyebrow: "Why structurally engineer?",
        heading: "Engineering principles in service of your vision.",
        body: "Combined with a keen knowledge of fundamental and advanced engineering principles, standards, methodologies and technologies, our understanding of each client's goals lets our engineers realise a cohesive vision for every project. We move every project through its stages — from consultation and design creativity to tendering and construction — and have invested heavily in attracting and developing skilful structural engineers.",
        variant: "surface",
      },
      {
        eyebrow: "No project too small",
        heading: "Large spans, no columns, no walls? You're in the right place.",
        body: "No project is too small, too big or too difficult. If your needs are large spans with no columns or walls, we love problem-solving and will design a way to meet any stringent requirement. Our services range from simple wall removals, inspections and structural design certificates to the detailed structural design of high-rise buildings.",
        variant: "light",
      },
      {
        eyebrow: "What we deliver",
        heading: "Regular structural engineering projects.",
        chips: [
          "Structural design — concrete, steel, timber",
          "Review of existing structures",
          "Testing and compliance",
          "Multi-unit buildings",
          "Commercial / retail",
          "Building refurbishment",
          "Excavation and demolition assessments",
          "Propping and shoring design",
        ],
        layout: "split",
        body: "Our engineering experience lets us build long-lasting relationships with clients across Sydney, Wollongong, the Central Coast, Newcastle, the Gold Coast, Brisbane and the Sunshine Coast.",
        variant: "surface",
      },
    ],
    faqId: "structural-engineering",
    related: ["structural-integrity-assessments", "defect-origin-assessments-doa", "commercial-dilapidation-reports"],
    schemaName: "Structural Engineering",
  },

  /* ── Aerial drone surveys ────────────────────────────────────────── */
  {
    slug: "aerial-drone-surveys",
    title: "Aerial Drone Surveys | UAV Site Inspection, Mapping & Photogrammetry",
    metaDescription:
      "Aerial drone surveys from AusDilaps — UAV site inspections, 3D mapping and photogrammetry accurate to 10–20mm. Solar panel thermography, mine-site volumetrics, roof and façade inspection, and environmental mapping.",
    h1: "Aerial Drone Surveys",
    eyebrow: "Aerial Drone Surveys",
    navLabel: "Aerial Drone Surveys",
    summary: "UAV survey, mapping and inspection — accurate to 10–20mm.",
    intro:
      "Drone surveying — also known as aerial surveying — uses unmanned aerial vehicles (UAVs) to gather data from the air. With its ability to capture high-resolution imagery and 3D models, drone surveying has revolutionised how industries approach site inspections, mapping and land surveying.",
    sections: [
      {
        eyebrow: "Aerial surveys of construction sites",
        heading: "Turn visual inspections into a faster, cheaper process.",
        body: "Drone-collected data creates accurate 3D models, real-time 2D maps and 360-degree virtual tours of any construction site — from initial site surveys and measurements to construction modelling, progress monitoring and inspections that increase workplace safety.",
        bullets: [
          "Keep track of on-site progress",
          "Streamline communication",
          "Enable rapid decision-making",
          "Identify areas of concern in real time",
          "Build detailed maps and 3D models",
          "Overlap old and new maps to measure progress",
        ],
        layout: "split",
        variant: "light",
      },
      {
        eyebrow: "What we inspect from the air",
        heading: "The right aerial method for every asset.",
        cards: [
          {
            title: "Solar panel inspections",
            body: "Using FLIR VUE infrared thermography on our UAVs to inspect immense solar fields — detecting heat leakage and faulty panels rapidly and economically to keep power load and operations smooth.",
          },
          {
            title: "Mine sites, landfills & quarries",
            body: "Precise volumetric calculations of stockpiles and material at every stage of the cycle, with real-life visual imagery accurate to 10–20mm — without exposing manpower to hazardous environments.",
          },
          {
            title: "Roofs & infrastructure",
            body: "Close visual inspection of roofs and façades to detect damaged tiles, brickwork, façade cracks and lintel issues — surveys completed in a few hours, with no scaffolding and reduced working-at-heights risk.",
          },
          {
            title: "Environmental surveys",
            body: "Detailed photographic data on waterways and dams, measuring changes in water levels or erosion over time using point-cloud orthomosaic mapping and multispectral cameras for sensitive areas.",
          },
          {
            title: "Mapping & photogrammetry",
            body: "Using RTK and PPK positioning to generate 3D point-cloud mapping with precise GPS, enabling side-by-side pre-, during- and post-construction comparisons of buildings, towers and assets.",
          },
        ],
        variant: "surface",
      },
    ],
    faqInline: [
      {
        q: "How accurate is drone survey data?",
        a: "Our aerial systems deliver real-life visual imagery accurate to 10–20mm, with millimetre-accurate topographic measurements of the surrounding terrain using point-cloud orthomosaic mapping.",
      },
      {
        q: "Can you inspect a roof without scaffolding?",
        a: "Yes. Drone inspection removes the need for scaffolding or access equipment — surveys are completed in a few hours, and roofs that are inaccessible, fragile or contain ageing asbestos materials are safely captured from the air.",
      },
      {
        q: "What can drone surveys be used for?",
        a: "Construction-site progress monitoring, solar panel thermal inspections, mine-site and quarry volumetric calculations, roof and façade defect detection, environmental mapping of waterways and dams, and 3D mapping and photogrammetry.",
      },
    ],
    related: ["highways-roads", "noise-and-vibration-monitoring-services", "commercial-dilapidation-reports"],
    schemaName: "Aerial Drone Surveys",
  },

  /* ── Noise & vibration monitoring ────────────────────────────────── */
  {
    slug: "noise-and-vibration-monitoring-services",
    title: "Noise & Vibration Monitoring Services | Construction Compliance",
    metaDescription:
      "Noise and vibration monitoring across Australia. Baseline site analysis plus real-time data capture to keep construction and industrial works compliant and protect nearby residents, wildlife and structures.",
    h1: "Noise & Vibration Monitoring Services",
    eyebrow: "Noise & Vibration",
    navLabel: "Noise & Vibration",
    summary: "Baseline and real-time monitoring to keep works compliant.",
    intro:
      "Construction and industrial activity generates noise and vibration that can disrupt communities, wildlife and the environment. AusDilaps is your trusted partner in noise and vibration monitoring — helping you remain compliant while keeping the peace around your site.",
    sections: [
      {
        eyebrow: "Understanding the need",
        heading: "Excessive noise and vibration has real consequences.",
        body: "Every construction or industrial activity generates noise and vibration that can significantly impact the well-being of communities, wildlife and the environment.",
        bullets: [
          "Disrupting the daily lives of nearby residents",
          "Disturbing local wildlife and altering behavioural patterns",
          "Causing structural damage to nearby buildings and infrastructure",
        ],
        layout: "split",
        variant: "light",
      },
      {
        eyebrow: "Why choose AusDilaps",
        heading: "Experience, equipment and tailored solutions.",
        cards: [
          {
            title: "Experience & expertise",
            body: "A proven track record in the Australian market and a team trained to handle the most advanced monitoring equipment, ensuring accurate results.",
          },
          {
            title: "State-of-the-art equipment",
            body: "The latest monitoring technology, calibrated regularly and capable of capturing real-time data to inform decisions.",
          },
          {
            title: "Nationwide reach",
            body: "Our services span across Australia — wherever your project is located, we're there to support your monitoring needs.",
          },
          {
            title: "Custom solutions",
            body: "Every project is unique. We tailor monitoring to your site and its surroundings so you stay compliant with all local regulations and standards.",
          },
        ],
        variant: "surface",
      },
      {
        eyebrow: "The AusDilaps approach",
        heading: "Baseline first, then continuous insight.",
        body: "We start with a comprehensive site analysis to understand existing levels and potential sources of noise and vibration — crucial for setting benchmarks and predicting impacts. We then deploy monitoring equipment at strategic locations to capture data continuously or at set intervals, and analyse it to provide insights and recommend mitigation strategies where required.",
        variant: "light",
      },
    ],
    faqInline: [
      {
        q: "Why is noise and vibration monitoring needed on construction sites?",
        a: "Construction and industrial activity generates noise and vibration that can disrupt nearby residents, disturb local wildlife, and cause structural damage to nearby buildings and infrastructure. Monitoring keeps your project compliant and protects the surrounding environment.",
      },
      {
        q: "How does AusDilaps monitor noise and vibration?",
        a: "We start with a comprehensive site analysis to establish baseline levels, then deploy calibrated monitoring equipment at strategic locations to capture real-time data continuously or at set intervals. The data is analysed to provide insights and recommend mitigation strategies where required.",
      },
    ],
    related: ["aerial-drone-surveys", "structural-engineering", "defect-origin-assessments-doa"],
    schemaName: "Noise and Vibration Monitoring",
  },

  /* ── Defect Origin Assessments (DOA) ─────────────────────────────── */
  {
    slug: "defect-origin-assessments-doa",
    title: "Defect Origin Assessments (DOA) | What Caused the Damage, and When",
    metaDescription:
      "Defect Origin Assessments from AusDilaps — expert, evidence-based analysis of visible damage to determine what caused a defect, when it likely occurred, and how confidently that conclusion can be drawn.",
    h1: "Defect Origin Assessments (DOA)",
    eyebrow: "Defect Origin Assessments",
    navLabel: "Defect Origin (DOA)",
    summary: "Evidence-based analysis of what caused a defect, and when.",
    intro:
      "When damage is discovered during or after construction, the stakes are high. Questions about responsibility, timing and liability arise — especially when there's no clear-cut evidence. That's where a Defect Origin Assessment comes in.",
    sections: [
      {
        eyebrow: "Know exactly what caused the damage — and when",
        heading: "Expert, evidence-based analysis of visible damage.",
        body: "Our DOA reports assess the nature, location and context of each defect to determine what caused it, when it likely occurred, and how confidently that conclusion can be drawn.",
        variant: "light",
      },
      {
        eyebrow: "What a DOA includes",
        heading: "A defensible, transparent analysis.",
        bullets: [
          "Site-specific photographic comparisons",
          "Defect categorisation and location mapping",
          "Analysis of contributing risk factors (vibration, water ingress, structural movement)",
          "Summary of likely origin and timing of damage",
          "Confidence rating assigned to each conclusion",
          "Recommendations for next steps, further inspection or remediation",
        ],
        layout: "split",
        variant: "surface",
      },
      {
        eyebrow: "Why DOAs are essential",
        heading: "Protect every party with a third-party analysis.",
        body: "Defect disputes can stall projects, damage reputations, or result in costly legal claims. A DOA delivers an objective, third-party analysis that clarifies what actually happened — and why — so you can move forward confidently, with documentation to back you up.",
        variant: "light",
      },
    ],
    faqInline: [
      {
        q: "What is a Defect Origin Assessment?",
        a: "A Defect Origin Assessment is a specialist report that supplements pre and post-construction condition reports. It identifies physical changes in a structure and uses photographic evidence, site context and engineering insight to assess whether a defect is pre-existing, construction-related, the result of worsening conditions, or unrelated entirely — each supported by a confidence rating.",
      },
      {
        q: "When do I need a DOA?",
        a: "If you're dealing with unexplained cracking, property complaints or potential claims, a Defect Origin Assessment provides the clarity you need to move forward — with documentation to back you up.",
      },
    ],
    related: ["defect-comparison-assessments", "structural-integrity-assessments", "commercial-dilapidation-reports"],
    schemaName: "Defect Origin Assessments",
  },

  /* ── Highways & roads ────────────────────────────────────────────── */
  {
    slug: "highways-roads",
    title: "Highway & Road Condition Reports | Roughness, Rutting & Texture Data",
    metaDescription:
      "Road condition surveys from AusDilaps — vehicle-mounted video and on-foot high-resolution capture of roughness, rutting and surface texture. Defensible before-and-after reporting for infrastructure, civil and haulage projects.",
    h1: "Highway & Road Reports",
    eyebrow: "Highways & Roads",
    navLabel: "Highways & Roads",
    summary: "Roughness, rutting and surface condition reports for road and haulage projects.",
    intro:
      "AusDilaps provides detailed road condition assessments tailored to infrastructure, civil and haulage projects. Whether you're documenting a highway before construction begins or need verified data to meet council standards, our reports are built for accountability.",
    sections: [
      {
        eyebrow: "Why road condition matters",
        heading: "A clear record before and after works.",
        body: "Roads take a beating — especially under construction vehicles, haulage fleets and large-scale infrastructure work. Without a clear record of road condition before and after works, asset owners and contractors are exposed to legal disputes, costly remediation and denied insurance claims. Councils increasingly require high-quality reporting as part of approval processes, and we help you meet and exceed those expectations.",
        variant: "light",
      },
      {
        eyebrow: "What we deliver",
        heading: "Precision data that's hard to dispute.",
        cards: [
          {
            title: "Vehicle-mounted video inspections",
            body: "Efficient capture across long stretches — from regional access roads to hundreds of kilometres of highway.",
          },
          {
            title: "On-foot high-resolution capture",
            body: "Detailed, close-range documentation where a vehicle pass isn't enough.",
          },
          {
            title: "Roughness, rutting & texture data",
            body: "The critical surface metrics that ensure compliance and reduce liability.",
          },
          {
            title: "Optional add-ons",
            body: "Tailored extras to match your council, insurance and contractual requirements.",
          },
        ],
        variant: "surface",
      },
    ],
    faqInline: [
      {
        q: "What does a road condition survey measure?",
        a: "We capture critical surface metrics including roughness, rutting and texture using vehicle-mounted video and on-foot high-resolution capture — ensuring compliance, reducing liability and giving you defensible data.",
      },
      {
        q: "Why does road condition need documenting before construction?",
        a: "Roads take a beating under construction vehicles and haulage fleets. Without a clear before-and-after record, asset owners and contractors are exposed to legal disputes, costly remediation and denied insurance claims.",
      },
    ],
    related: ["aerial-drone-surveys", "commercial-dilapidation-reports", "noise-and-vibration-monitoring-services"],
    schemaName: "Highway and Road Condition Reports",
  },

  /* ── Structural Integrity Assessments (SIA) ──────────────────────── */
  {
    slug: "structural-integrity-assessments",
    title: "Structural Integrity Assessments (SIA) | Asset Performance & Stability",
    metaDescription:
      "Structural Integrity Assessments from AusDilaps — evaluate the structural performance and stability of assets using advanced methods, identifying weaknesses or potential failures early for safety, compliance and informed remediation.",
    h1: "Structural Integrity Assessments (SIA)",
    eyebrow: "Structural Integrity",
    navLabel: "Structural Integrity (SIA)",
    summary: "Evaluate asset performance and stability before it becomes a failure.",
    intro:
      "A Structural Integrity Assessment evaluates the structural performance and stability of an asset using advanced assessment methods — identifying weaknesses or potential failures early to ensure safety, compliance and informed decision-making for asset management and remediation.",
    sections: [
      {
        eyebrow: "What an SIA evaluates",
        heading: "Catch weaknesses before they become failures.",
        body: "Our structural engineers assess the performance and stability of your asset using advanced assessment methods, identifying weaknesses or potential failures early. The result is a clear, defensible basis for decisions about safety, compliance and remediation.",
        variant: "light",
      },
      {
        eyebrow: "Why it matters",
        heading: "Informed decisions for asset management.",
        body: "Whether you're confirming an asset's condition before remediation, after an event that may have caused damage, or as part of ongoing asset management, an SIA gives you the engineering insight to act with confidence — backed by a team experienced in defect classification.",
        variant: "surface",
      },
    ],
    faqInline: [
      {
        q: "What is a Structural Integrity Assessment?",
        a: "An SIA evaluates the structural performance and stability of an asset using advanced assessment methods, identifying weaknesses or potential failures early to ensure safety, compliance and informed decision-making for asset management and remediation.",
      },
      {
        q: "When should I commission an SIA?",
        a: "When you need to confirm an asset's safety and stability — before remediation, after an event that may have caused damage, or as part of ongoing asset management.",
      },
    ],
    related: ["structural-engineering", "defect-origin-assessments-doa", "defect-comparison-assessments"],
    schemaName: "Structural Integrity Assessments",
  },

  /* ── Defect Comparison Assessments (DCA) ─────────────────────────── */
  {
    slug: "defect-comparison-assessments",
    title: "Defect Comparison Assessments (DCA) | Pre- vs Post-Construction",
    metaDescription:
      "Defect Comparison Assessments from AusDilaps — compare pre and post-construction asset conditions to identify changes, assess construction impacts, and provide independent, defensible reporting for claims management.",
    h1: "Defect Comparison Assessments (DCA)",
    eyebrow: "Defect Comparison",
    navLabel: "Defect Comparison (DCA)",
    summary: "Pre- vs post-construction comparison that isolates what changed.",
    intro:
      "A Defect Comparison Assessment compares pre and post-construction asset conditions to identify changes, assess potential construction impacts, and provide independent, defensible reporting that supports claims management and transparent communication between all stakeholders.",
    sections: [
      {
        eyebrow: "What a DCA does",
        heading: "Isolate exactly what changed — and why.",
        body: "By directly comparing the pre and post-construction records, a DCA identifies changes and assesses whether construction impacts caused them. It turns two sets of evidence into one clear, independent conclusion.",
        variant: "light",
      },
      {
        eyebrow: "Why it matters",
        heading: "Defensible reporting for claims management.",
        body: "When a claim is made, the comparison is what settles it. Our independent, defensible reporting supports claims management and keeps communication transparent between all stakeholders — so a dispute is resolved on the evidence, not on argument.",
        variant: "surface",
      },
    ],
    faqInline: [
      {
        q: "What is a Defect Comparison Assessment?",
        a: "A DCA compares pre and post-construction asset conditions to identify changes, assess potential construction impacts, and provide independent, defensible reporting that supports claims management and transparent communication between all stakeholders.",
      },
      {
        q: "How is a DCA different from a dilapidation report?",
        a: "A dilapidation report documents condition at a point in time; a DCA directly compares the pre and post-construction records to isolate what changed and whether construction caused it.",
      },
    ],
    related: ["defect-origin-assessments-doa", "structural-integrity-assessments", "commercial-dilapidation-reports"],
    schemaName: "Defect Comparison Assessments",
  },
];

export const SERVICE_BY_SLUG: Record<string, Service> = Object.fromEntries(
  SERVICES_CONTENT.map((s) => [s.slug, s])
);

/** Order for the /our-services index + homepage cards (dilapidation-led). */
export const SERVICE_SLUGS = SERVICES_CONTENT.map((s) => s.slug);
