import type { MetadataRoute } from "next";
import { absoluteUrl, SITE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /email/ holds the email-signature images: public by necessity (mail clients fetch
      // them) but linked from no page, so keep crawlers off them.
      disallow: ["/api/", "/admin", "/staff", "/inspector-links", "/qr", "/email/"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
