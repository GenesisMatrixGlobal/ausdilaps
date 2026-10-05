// Real case studies from the FY25/26 Capability Statement.

export type CaseStudy = {
  slug: string;
  project: string;
  value: string;
  client: string;
  location: string;
  date: string;
  objective: string;
  solution: string;
  stats: { value: string; label: string }[];
};

export const CASE_STUDIES: CaseStudy[] = [
  {
    slug: "main-south-road-duplication",
    project: "Main South Road Duplication",
    value: "$1.1bn",
    client: "Fleurieu Connections Alliance",
    location: "South Australia",
    date: "2021–2026",
    objective:
      "Improve traffic flow and safety across the Fleurieu Peninsula with new intersections, safety barriers and shared pathways.",
    solution:
      "A shared tracking system coordinated the client's community engagement and our bookings team. Engineers conducted 16 weeks of site visits, with 50km+ of roadway condition surveys captured on video as high-precision georeferenced data.",
    stats: [
      { value: "40,000+", label: "Photos captured (pre & post)" },
      { value: "175", label: "Properties inspected" },
      { value: "50km+", label: "Roads assessed via vehicle-mounted video" },
    ],
  },
  {
    slug: "ipswich-hospital",
    project: "Ipswich Hospital",
    value: "$710M",
    client: "Bennet & Bennet",
    location: "Ipswich, QLD",
    date: "July 2024",
    objective:
      "A hospital expansion adding 200 beds, faster emergency care and expanded surgical services, with enhanced imaging and a modern sterilisation facility.",
    solution:
      "Georeferenced pre and post-construction dilapidation surveys enabled accurate, repeatable comparisons, with clear documentation of hospital structures and surrounding assets while maintaining safety amid high foot traffic.",
    stats: [
      { value: "5,000m²+", label: "Inspected (plant rooms, roofs, wards)" },
      { value: "4,108", label: "Location-marked photos" },
      { value: "782", label: "Defects measured & classified by engineers" },
    ],
  },
  {
    slug: "glenrowan-solar-farm",
    project: "Glenrowan Solar Farm",
    value: "$170M",
    client: "UGL Pty Limited",
    location: "Glenrowan, Victoria",
    date: "2021–2024",
    objective:
      "A 130MW solar project powering ~55,000 homes, contributing to the state's renewable energy targets.",
    solution:
      "A structured, repeatable inspection method documented 20km+ of roadways and surrounding assets, with high-accuracy georeferenced photography and traffic-controlled inspections for safety and accuracy.",
    stats: [
      { value: "20km", label: "Roadways & adjacent assets captured" },
      { value: "3,036", label: "Georeferenced photos" },
      { value: "2,549", label: "Scheduled inspection minutes" },
    ],
  },
];
