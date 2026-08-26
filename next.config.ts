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
};

export default nextConfig;
