import type { MetadataRoute } from "next";
import { absoluteUrl, SITE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /email/ holds the email-signature images and /field-service-icons/ the Salesforce Field
      // Service map icons: public by necessity (mail clients and Salesforce fetch
      // them) but linked from no page, so keep crawlers off them.
      disallow: ["/api/", "/admin", "/staff", "/inspector-links", "/qr", "/email/", "/field-service-icons/"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
