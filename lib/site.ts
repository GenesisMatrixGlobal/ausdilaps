// Real company data — sourced from the FY25/26 Capability Statement and live site.

export const SITE = {
  name: "AusDilaps",
  descriptor: "Specialist Building Inspections",
  legalName: "Urban Pulse Strategies Pty Ltd",
  abn: "82 650 700 226",
  email: "info@ausdilaps.com.au",
  phone: "1800 345 277",
  address: "PO Box 81, Aspley QLD 4034",
  standard: "AS 4349.0",
};

export type NavItem = { label: string; href: string; menu?: "services" };

export const NAV: NavItem[] = [
  { label: "Dilapidation Reports", href: "/dilapidation-reports" },
  { label: "Services", href: "/our-services", menu: "services" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Insights", href: "/insights" },
  { label: "FAQ", href: "/faq" },
];

/** Where every "Request a Quote" CTA points — the dedicated lead form. */
export const QUOTE_HREF = "/quote";

/** The capability statement PDF (committed to /public). Opens in a new tab. */
export const CAPABILITY_HREF = "/AusDilaps-Capability-Statement-FY25-26.pdf";

/** Real operating stats (Capability Statement, "Who Are We?"). */
export const STATS = [
  { value: "1,000+", label: "Surveys delivered per quarter" },
  { value: "1M+", label: "Photos captured annually" },
  { value: "1,300+", label: "On-site hours per month" },
  { value: "600+", label: "Work orders dispatched per month" },
];

/** Core services taxonomy (Capability Statement). Dilapidation is the flagship. */
export const SERVICES = [
  {
    title: "Dilapidation Reports",
    tag: "Flagship",
    href: "/dilapidation-reports",
    body: "Pre and post-construction property condition reports that document existing conditions and provide a defensible baseline — residential, commercial and infrastructure.",
  },
  {
    title: "Structural Integrity Assessments",
    tag: "SIA",
    href: "/our-services/structural-integrity-assessments",
    body: "Evaluate the structural performance and stability of assets, identifying weaknesses or potential failures early for safety, compliance and informed remediation.",
  },
  {
    title: "Defect Origin Assessments",
    tag: "DOA",
    href: "/our-services/defect-origin-assessments-doa",
    body: "Investigate and determine the root cause of defects with evidence-based reporting — supporting remediation, dispute resolution and accurate liability.",
  },
  {
    title: "Defect Comparison Assessments",
    tag: "DCA",
    href: "/our-services/defect-comparison-assessments",
    body: "Compare pre and post-construction conditions to identify changes and construction impacts, supporting claims management and transparent reporting.",
  },
];

/** Capture techniques that make reports defensible (framed under dilapidation). */
export const CAPTURE_METHODS = [
  "High-resolution photography",
  "Roadway video survey",
  "Drone survey",
  "LiDAR capture",
  "Point cloud / 3D model",
  "Culvert & pipe inspection",
  "GPS / georeferenced imagery",
];

/** The 6-step methodology (Capability Statement). */
export const PROCESS = [
  { n: "01", title: "Services Proposal", body: "Desktop review of requirements, scope defined, and a detailed itemised quote with clarity on pricing, methodology and deliverables." },
  { n: "02", title: "Project Kick-Off", body: "Access logistics confirmed, a dedicated project coordinator assigned, scheduling and stakeholder communications managed for on-time bookings." },
  { n: "03", title: "Access Arrangement", body: "Access initiated via doorknocks, SMS, postal letters, calls and emails; every attempt recorded to maximise inspection success rates." },
  { n: "04", title: "Perform Surveys", body: "An engineer attends site to capture high-resolution visual records with wide/zoom lenses, GPS logging and crack gauges — photos, video and structured annotations." },
  { n: "05", title: "Report Delivery", body: "Precise defect categorisation with location-referenced imagery and professional sign-off, compliant with Australian Standards including AS 4349.0." },
  { n: "06", title: "Project Closeout", body: "A comprehensive PDF summary with inspection dates, access efforts and report links, then transition to accounts for final invoicing." },
];

/** Leadership + delivery team (Capability Statement). */
export const TEAM = [
  { name: "Mike Burford", role: "Founder" },
  { name: "Rhys Morgan", role: "CEO" },
  { name: "Kylie Crosson", role: "Senior Estimator" },
  { name: "Niro Rudrakumar", role: "Civil Engineer" },
  { name: "Jessica Lebbos", role: "Project Manager" },
  { name: "Martin Weng", role: "Structural Engineer" },
];

export type Project = { name: string; sector: string; image: string; slug: string };

export const TIER1_PROJECTS: Project[] = [
  { name: "Queens Wharf", sector: "Commercial", image: "/projects/queens-wharf.jpg", slug: "queens-wharf-brisbane" },
  { name: "NorthConnex", sector: "Infrastructure", image: "/projects/northconnex.jpg", slug: "northconnex" },
  { name: "Brisbane Airport", sector: "Aviation", image: "/projects/brisbane-airport.jpg", slug: "brisbane-airport" },
  { name: "North West Rail Link", sector: "Rail", image: "/projects/north-west-rail-link.jpg", slug: "northwest-rail-link" },
  { name: "Barangaroo", sector: "Commercial", image: "/projects/barangaroo.jpg", slug: "barangaroo-south" },
];
