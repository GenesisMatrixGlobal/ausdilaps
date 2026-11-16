// 301 redirect map for legacy WordPress URLs. Slugs that survive 1:1 (services,
// portfolio, locations, the pillar) need NO redirect — they're preserved exactly.
// Only URLs that genuinely change are mapped here. Verify each with `curl -I`
// before the domain cutover.

export type Redirect = { source: string; destination: string; permanent: boolean };

export const REDIRECTS: Redirect[] = [
  // Legacy portfolio category archives → the new filterable portfolio.
  // (Real legacy path is /portfolio_categories/<cat>/ — NOT /projects/, which
  // would have shadowed the hero images served from /public/projects/*.jpg.)
  { source: "/portfolio_categories", destination: "/portfolio", permanent: true },
  { source: "/portfolio_categories/:cat", destination: "/portfolio", permanent: true },

  // Duplicate / junk portfolio slugs.
  {
    source: "/portfolio/epping-to-thornleigh-third-track-2",
    destination: "/portfolio/epping-to-thornleigh-third-track",
    permanent: true,
  },
  { source: "/portfolio/tatsu-5214", destination: "/portfolio", permanent: true },

  // Dated blog post → clean insights URL.
  {
    source: "/2023/05/21/why-are-basix-reports-important",
    destination: "/insights/why-are-basix-reports-important",
    permanent: true,
  },

  // Legacy pages with no equivalent here, still receiving direct traffic a
  // month after cutover (web_vitals, 2026-10-06: /about-ausdilaps alone had 25
  // visits in 28 days, all 404s). The old About content is the team section.
  { source: "/about-ausdilaps", destination: "/#about", permanent: true },
  { source: "/about-ausdilaps/why-choose-ausdilaps", destination: "/#about", permanent: true },
  // Old /projects/ archives (commercial-projects, road-projects, …). The
  // pattern is letters and hyphens only, so it cannot swallow the hero images
  // served from /public/projects/*.jpg.
  { source: "/projects", destination: "/portfolio", permanent: true },
  { source: "/projects/:cat([a-z0-9-]+)", destination: "/portfolio", permanent: true },
  // A service slug typed without its /our-services/ prefix.
  {
    source: "/industrial-dilapidation-reports",
    destination: "/our-services/industrial-dilapidation-reports",
    permanent: true,
  },

  // Thin / moved legacy pages.
  { source: "/contact-us/faqs", destination: "/faq", permanent: true },
  {
    source: "/dilapidation-reports/condition-reports",
    destination: "/dilapidation-reports",
    permanent: true,
  },

  // Old WordPress URLs that still 404'd after cutover (checked against the WP archive
  // 2026-11-16, prompted by a Semrush audit flagging 4XX pages). Each goes to its
  // closest live page.
  // Services renamed or folded into another page.
  {
    source: "/our-services/structural-integrity-assessments-sia",
    destination: "/our-services/structural-integrity-assessments",
    permanent: true,
  },
  {
    source: "/our-services/defect-comparison-assessments-dca",
    destination: "/our-services/defect-comparison-assessments",
    permanent: true,
  },
  {
    source: "/our-services/3d-models-digital-twins",
    destination: "/our-services/aerial-drone-surveys",
    permanent: true,
  },
  {
    source: "/our-services/lidar-point-cloud-capture-analysis",
    destination: "/our-services/aerial-drone-surveys",
    permanent: true,
  },
  {
    source: "/our-services/culvert-and-pipe-reporting",
    destination: "/our-services/highways-roads",
    permanent: true,
  },
  // Access arrangement is step 3 of the process on the pillar page.
  { source: "/our-services/access-management", destination: "/dilapidation-reports", permanent: true },
  // Blog archives and the two Victorian earthquake posts (never rebuilt).
  {
    source: "/2023/10/23/lessons-from-melbournes-recent-earthquake",
    destination: "/insights",
    permanent: true,
  },
  {
    source: "/2023/10/24/victorias-earthquakes-structural-checks",
    destination: "/insights",
    permanent: true,
  },
  { source: "/blog", destination: "/insights", permanent: true },
  { source: "/category/:slug", destination: "/insights", permanent: true },
  { source: "/tag/:slug", destination: "/insights", permanent: true },
  { source: "/author/:slug", destination: "/insights", permanent: true },
  { source: "/portfolios", destination: "/portfolio", permanent: true },
  // The old access-letter response forms. Letters already posted to residents may still
  // carry these addresses, so they land on the same form as the /letter QR code. Not
  // permanent, for the same reason as /letter below.
  {
    source: "/access-letter-response",
    destination: "/quote?src=access-letter&type=access-letter#enquiry",
    permanent: false,
  },
  {
    source: "/accessresponse",
    destination: "/quote?src=access-letter&type=access-letter#enquiry",
    permanent: false,
  },
  { source: "/newstaff", destination: "/staff", permanent: true },
  // No equivalent: a COVID-era policy and the old theme's header/footer templates.
  { source: "/infection-control-policy-coronavirus", destination: "/", permanent: true },
  { source: "/tatsu_header/:slug", destination: "/", permanent: true },
  { source: "/tatsu_footer/:slug", destination: "/", permanent: true },

  // Convenience shortcut — canonical page stays at /dilapidation-reports/samples
  // (preserves the live ranking URL); this is just a shorter alias.
  { source: "/samples", destination: "/dilapidation-reports/samples", permanent: true },

  // Staff portal — the /admin/* field tools moved to /staff/<department>/tools/*
  // when per-user auth landed. /admin is now company-admins only.
  {
    source: "/admin/property-sizing",
    destination: "/staff/estimators/tools/property-sizing",
    permanent: true,
  },
  {
    source: "/admin/site-markups",
    destination: "/staff/estimators/tools/site-markups",
    permanent: true,
  },
  {
    source: "/admin/kml-builder",
    destination: "/staff/inspectors/tools/kml-builder",
    permanent: true,
  },
  { source: "/admin/login", destination: "/staff/login", permanent: true },

  // Short link for the inspector QR code sticker.
  { source: "/qr", destination: "/inspector-links", permanent: true },

  // Legacy contact pages. The old WPForms /contact-us and /contact-us/consultation
  // were consolidated into the single /quote lead form; /contact-us/capability was
  // the gated capability-statement request, which /quote now captures.
  { source: "/contact-us", destination: "/quote", permanent: true },
  { source: "/contact-us/consultation", destination: "/quote", permanent: true },
  { source: "/contact-us/capability", destination: "/quote", permanent: true },

  // Legal pages. Every quote sent before the v2 terms linked to the old WordPress terms
  // page, so it has to keep resolving — the terms page links version 1 for that work
  // (data/legal.ts). /terms and /privacy are short aliases for texts and letters.
  { source: "/contact-us/terms-conditions", destination: "/terms-and-conditions", permanent: true },
  { source: "/contact-us/privacy-policy", destination: "/privacy-policy", permanent: true },
  { source: "/terms", destination: "/terms-and-conditions", permanent: true },
  { source: "/privacy", destination: "/privacy-policy", permanent: true },

  // Printed QR codes (Rhys, 2026-11-16). Short links so the codes stay small and easy to
  // scan, and NOT permanent: a 308 is cached by the phone, so a destination changed later
  // would never reach anyone who had scanned before. `src` tags the enquiry ("Came from"
  // on /admin/leads), `type` pre-selects the enquiry type, `#enquiry` lands on the form.
  // The QR artwork lives in print/qr-codes/ — never rename these sources once printed.
  { source: "/pamphlet", destination: "/quote?src=pamphlet#enquiry", permanent: false },
  {
    source: "/letter",
    destination: "/quote?src=access-letter&type=access-letter#enquiry",
    permanent: false,
  },

  // WordPress media. After cutover ausdilaps.com.au IS this site, so every
  // /wp-content/uploads/* URL Google has indexed (and every external link to a
  // sample PDF) would land on a 404. The capability statement is committed to
  // /public so it redirects to the real file; everything else goes to the samples
  // page, the closest live equivalent.
  //
  // ORDER MATTERS: the specific file must precede the wildcard, or the wildcard
  // swallows it.
  {
    source: "/wp-content/uploads/2026/04/AusDilaps-Capability-Statement-FY25-26.pdf",
    destination: "/AusDilaps-Capability-Statement-FY25-26.pdf",
    permanent: true,
  },
  // ⚠️ EMAIL SIGNATURE ASSETS — these MUST precede the wildcard, and they are not an SEO
  // concern, they are a live bug fix. Every staff signature still points at the old
  // WordPress URLs below. Under the wildcard alone they 308'd to the samples page, so an
  // <img> in a signature fetched an HTML document and rendered as a BROKEN IMAGE in every
  // email the company had sent since cutover — and each fetch also counted as a samples
  // page view, which is what put 284 bot views on the /admin tile (Gmail's image proxy
  // alone was 55 of them). Redirecting to the real file fixes both, and fixes signatures
  // already sitting in people's sent folders without anyone editing Outlook.
  {
    source: "/wp-content/uploads/2025/09/AusDilaps-Logo-GIF.gif",
    destination: "/email/signature-logo.gif",
    permanent: true,
  },
  {
    source: "/wp-content/uploads/2026/06/Email-Banner-GIF-FY26.gif",
    destination: "/email/signature-banner.gif",
    permanent: true,
  },
  // Two more images still used by Salesforce email templates (report delivery, H4P, T2D,
  // Burswood — about 20 templates, checked 2026-11-16). The wildcard was sending both to
  // the samples page, so every one of those emails showed broken images. The old logo was
  // square (the templates draw it at 140x140), so it gets the square brand mark.
  {
    source: "/wp-content/uploads/2023/08/ausdilapsemaillogo.png",
    destination: "/email/square-logo-v1.png",
    permanent: true,
  },
  {
    source: "/wp-content/uploads/2025/09/Email-Banner-Gif-FY26-6.gif",
    destination: "/email/signature-banner.gif",
    permanent: true,
  },
  // The version 1 terms PDF, linked from the old terms page. Kept unaltered in
  // /public/legal because work accepted before the v2 terms is still governed by it.
  {
    source: "/wp-content/uploads/2023/06/AusDilaps-General-Terms-and-Conditions-20230607.pdf",
    destination: "/legal/AusDilaps-General-Terms-and-Conditions-2023-06-07.pdf",
    permanent: true,
  },
  {
    source: "/wp-content/uploads/:path*",
    destination: "/dilapidation-reports/samples",
    permanent: true,
  },
];
