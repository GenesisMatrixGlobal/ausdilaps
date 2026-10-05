// Real FAQ content harvested from the live AusDilaps site (verbatim-faithful,
// lightly tightened). Drives the FAQ page + FAQPage JSON-LD (AEO/GEO).

export type FaqItem = { q: string; a: string };
export type FaqCategory = { id: string; title: string; items: FaqItem[] };

export const FAQ: FaqCategory[] = [
  {
    id: "dilapidation-reports",
    title: "Dilapidation Reports",
    items: [
      {
        q: "What is a dilapidation report, and why do I need one?",
        a: "A dilapidation report documents a property's condition before construction, renovation or demolition works on adjacent properties. It creates a baseline record of existing defects to protect all parties from disputes about damage during works. Reports are typically required by owners, builders, developers, councils and building surveyors as a condition of approval, and they help mitigate future damage claims.",
      },
      {
        q: "Who is responsible for obtaining a dilapidation report?",
        a: "Generally the property owner, builder or developer arranges and pays for the report. Regulatory authorities or councils may require it as an approval condition. While one party usually bears responsibility, all affected parties — neighbouring owners, tenants and others potentially impacted — benefit from having the report.",
      },
      {
        q: "When should I get a dilapidation report?",
        a: "Ideally before any construction, renovation or demolition works begin on adjacent properties — as early as possible. They're also advisable near major works such as roadworks, excavation or high-rise development that could impact the property.",
      },
      {
        q: "What is included in a dilapidation report?",
        a: "A comprehensive record of the inspected property's condition, interior and exterior: property age, construction type and notable features; existing damage or defects such as cracks, settling or leaks; nearby construction that may impact the property; photographs or video documentation; repair or maintenance recommendations; and a summary of findings.",
      },
      {
        q: "How long does it take to complete a dilapidation report?",
        a: "A standard residential inspection typically takes 15 to 45 minutes; larger commercial properties or complex structures take longer. Report writing afterwards can take several days to weeks depending on complexity. Allow sufficient time before construction begins to document pre-existing conditions accurately.",
      },
      {
        q: "Can I use a previous dilapidation report for a new project?",
        a: "Previous reports aren't recommended because property conditions change over time and new damage may have occurred. A fresh report for each project ensures accuracy, and some authorities require a recent report as an approval condition.",
      },
      {
        q: "What happens if the dilapidation report identifies issues?",
        a: "The report outlines the specific problems and severity, with recommendations such as crack repair, wall reinforcement or foundation stabilisation. A pre-construction report serves as the reference point for determining new damage during works, supporting compensation claims and prompt resolution.",
      },
    ],
  },
  {
    id: "structural-engineering",
    title: "Structural Engineering",
    items: [
      {
        q: "What is structural engineering?",
        a: "Structural engineering covers the design, analysis and construction of structures such as buildings, bridges and infrastructure. Engineers apply physics, mathematics and materials science to create safe, efficient structures that withstand environmental loads, gravity and external forces, while meeting building codes.",
      },
      {
        q: "Why is structural engineering important?",
        a: "It ensures the safety, stability and durability of the structures we use daily. Engineers understand how materials behave under load and design structures that withstand forces — including extreme events — while remaining safe, functional and sustainable.",
      },
      {
        q: "How do you ensure a structure is safe and stable?",
        a: "By analysing dead, live and environmental loads with mathematical models and simulations; selecting appropriate materials; designing elements such as beams, columns and foundations; verifying performance through simulation and physical testing; and ensuring compliance with building codes designed for structure and occupant safety.",
      },
      {
        q: "What is your process for working with architects and contractors?",
        a: "We establish clear communication, review project requirements, develop designs that integrate with the overall building design, coordinate with contractors during construction through site visits and inspections, and troubleshoot design changes or construction challenges collaboratively.",
      },
    ],
  },
  {
    id: "basix",
    title: "BASIX Assessments",
    items: [
      {
        q: "What is a BASIX report and why is it needed?",
        a: "BASIX (Building Sustainability Index) is a required sustainability assessment for all new residential building projects in NSW. It assesses a building's energy and water use considering location, orientation, size and materials, and is required for building permits — submitted to the local council before construction.",
      },
      {
        q: "How do I obtain a BASIX report for my project?",
        a: "Engage an accredited building sustainability consultant (AusDilaps employs trained BASIX professionals), provide project information (location, size, design, materials), have the consultant demonstrate compliance, and submit to the council or private certifier for approval before construction.",
      },
      {
        q: "How long is a BASIX report valid for?",
        a: "BASIX reports remain valid for 12 months from the issue date. If construction hasn't commenced within 12 months, a new report may be required; significant plan or material changes can also require a new report.",
      },
    ],
  },
  {
    id: "nathers",
    title: "NatHERS Assessments",
    items: [
      {
        q: "What is a NatHERS report?",
        a: "NatHERS (Nationwide House Energy Rating Scheme) assesses a home's energy efficiency, evaluating the energy likely used for heating and cooling based on orientation, materials, insulation and shading — expressed as a star rating from zero to ten, where higher is more efficient.",
      },
      {
        q: "Who can provide NatHERS reports?",
        a: "Accredited NatHERS assessors, trained and accredited through recognised bodies, use specialised software to model a building's energy performance and generate the star rating, along with efficiency advice.",
      },
      {
        q: "Can a NatHERS report help me save money on energy bills?",
        a: "Yes — it identifies efficiency improvements such as added insulation, window upgrades or better ventilation. Implementing the recommendations reduces energy consumption and bills, while also increasing home value and reducing carbon footprint.",
      },
    ],
  },
];

/** Flattened list for FAQPage JSON-LD. */
export const FAQ_FLAT: FaqItem[] = FAQ.flatMap((c) => c.items);
