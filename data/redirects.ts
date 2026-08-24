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

  // Thin / moved legacy pages.
  { source: "/contact-us/faqs", destination: "/faq", permanent: true },
  {
    source: "/dilapidation-reports/condition-reports",
    destination: "/dilapidation-reports",
    permanent: true,
  },

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
];
