import type { NextConfig } from "next";
import { REDIRECTS } from "./data/redirects";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Supabase Storage (public assets) and Cloudflare R2 public hostnames.
      // Fill in once the Supabase project + R2 bucket are provisioned, e.g.:
      // { protocol: "https", hostname: "<project>.supabase.co", pathname: "/storage/v1/object/public/**" },
      // { protocol: "https", hostname: "<account>.r2.cloudflarestorage.com" },
    ],
  },
  experimental: {
    // Knowledge-base uploads go through a server action, and the default cap is 1MB —
    // small enough that the very first real PDF would fail with an opaque error. Matches
    // MAX_UPLOAD_BYTES in lib/knowledge/extract.ts; change both together.
    serverActions: { bodySizeLimit: "25mb" },
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
    return [
      { source: "/email/:path*", headers: longCache },
      { source: "/field-service-icons/:path*", headers: longCache },
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
