import type { NextConfig } from "next";
import { REDIRECTS } from "./data/redirects";

const nextConfig: NextConfig = {
  images: {
    // AVIF is ~30% smaller than WebP for the same look; the optimizer only serves it when
    // listed. 40 is the hero photo's quality — it sits under an 84% colour wash — and any
    // quality not listed here is refused by the optimizer, so add before using.
    formats: ["image/avif", "image/webp"],
    qualities: [40, 75],
    // Optimised images are immutable per (src, size, quality); 30 days spares a returning
    // visitor a revalidation round-trip on every picture.
    minimumCacheTTL: 2_592_000,
  },
  experimental: {
    // Knowledge-base uploads go through a server action, and the default cap is 1MB —
    // small enough that the very first real PDF would fail with an opaque error. Matches
    // MAX_UPLOAD_BYTES in lib/knowledge/extract.ts; change both together.
    serverActions: { bodySizeLimit: "25mb" },
    // Reuse a dynamic page the browser rendered in the last 30s instead of asking the
    // server again (Next's default is 0). Flicking between Command Centre tabs is then
    // instant. APP-WIDE, so any dynamic page can show data up to 30s old after navigating
    // back to it.
    //
    // ⚠️ Only router.refresh() or a server action that calls revalidatePath()/redirect()
    // clears this cache. A fetch() to a route handler clears NOTHING — so a client view
    // seeded from server props that then mutates through /api/* must call router.refresh()
    // after a successful write, or a Link back within 30s shows the pre-write data. Tender
    // Watch is the case that bit (2026-10-08): a sent tender reappeared in the queue.
    staleTimes: { dynamic: 30 },
  },
  async redirects() {
    return REDIRECTS;
  },
  async headers() {
    // /email/ (signature images) and /field-service-icons/ (Salesforce Field Service map
    // icons) are fetched by other systems, not by pages on this site: every Salesforce user's
    // browser pulls the icon set each time the map renders, and every mail client fetches
    // the signature. Cache them hard so a browser asks once and keeps them, which is both
    // faster and far less traffic for Vercel's bot mitigation to look at. To change an
    // image, add a new file with a new name rather than overwriting — a year-long cache
    // means an overwrite would take up to a year to reach everyone.
    const longCache = [
      { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
      { key: "Access-Control-Allow-Origin", value: "*" },
    ];
    // Baseline security headers. Deliberately NOT a Content-Security-Policy yet: the staff
    // tools load Google Maps JS, Static Maps tiles and Box thumbnails, so a CSP needs its own
    // testing pass rather than being bolted on blind. These four are safe everywhere.
    const security = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-DNS-Prefetch-Control", value: "on" },
    ];
    // Brand assets and the capability statement are fetched on every page / every
    // enquiry email but were served `max-age=0` — a day in the browser, a week at the
    // edge. Not immutable: these files DO get overwritten in place.
    const weekCache = [
      { key: "Cache-Control", value: "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800" },
    ];
    return [
      { source: "/email/:path*", headers: longCache },
      { source: "/field-service-icons/:path*", headers: longCache },
      { source: "/logo/:path*", headers: weekCache },
      { source: "/clients/:path*", headers: weekCache },
      { source: "/AusDilaps-Capability-Statement-FY25-26.pdf", headers: weekCache },
      { source: "/:path*", headers: security },
      // The staff portal and admin must never be framable — a transparent iframe over a
      // real session is how a staff action gets clicked by someone else's page. The public
      // marketing pages stay framable: nothing there acts on a session.
      {
        source: "/staff/:path*",
        headers: [...security, { key: "X-Frame-Options", value: "DENY" }],
      },
      {
        source: "/admin/:path*",
        headers: [...security, { key: "X-Frame-Options", value: "DENY" }],
      },
    ];
  },
};

export default nextConfig;
