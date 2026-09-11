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
    return [
      { source: "/email/:path*", headers: longCache },
      { source: "/field-service-icons/:path*", headers: longCache },
    ];
  },
};

export default nextConfig;
