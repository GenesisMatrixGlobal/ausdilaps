import type { Metadata } from "next";
import Script from "next/script";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { JsonLd } from "@/components/seo/json-ld";
import { organizationSchema, localBusinessSchema } from "@/lib/seo";
import { IntercomMessenger } from "@/components/marketing/intercom-messenger";
import { WebVitalsReporter } from "@/components/marketing/web-vitals-reporter";

const GA_ID = process.env.NEXT_PUBLIC_GA4_ID;

// The generic fallback families are appended in globals.css (--font-sans / --font-heading),
// NOT via next/font's `fallback` option — under Turbopack that option silently drops the
// metric-matched "Inter Fallback" face, which is what keeps desktop from reflowing.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://ausdilaps.com.au"),
  title: {
    default: "AusDilaps — Tier 1 Dilapidation Specialists",
    template: "%s — AusDilaps",
  },
  description:
    "Australia's specialist dilapidation reporting firm — pre and post-construction condition reports that hold up when a damage claim is made. Trusted on Queen's Wharf, NorthConnex, Brisbane Airport and Barangaroo.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // data-scroll-behavior: globals.css sets `scroll-behavior: smooth`, and without this
    // Next's reset-to-top on every client navigation ANIMATED — a footer link opened the next
    // page by sliding up from 12,000px. With it, Next turns smoothing off for route changes
    // only; in-page anchors keep it.
    <html
      lang="en-AU"
      className={`${inter.variable} ${spaceGrotesk.variable}`}
      data-scroll-behavior="smooth"
    >
      <body>
        <JsonLd data={[organizationSchema(), localBusinessSchema()]} />
        {children}
        {/* Real-user Core Web Vitals -> /api/vitals -> the Site health panel on /admin.
            Renders nothing and ships no request until the page is hidden. */}
        <WebVitalsReporter />
        <IntercomMessenger />
        {GA_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga4" strategy="afterInteractive">
              {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');`}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
