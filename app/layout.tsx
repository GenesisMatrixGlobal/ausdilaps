import type { Metadata } from "next";
import Script from "next/script";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { JsonLd } from "@/components/seo/json-ld";
import { organizationSchema, localBusinessSchema } from "@/lib/seo";
import { IntercomMessenger } from "@/components/marketing/intercom-messenger";

const GA_ID = process.env.NEXT_PUBLIC_GA4_ID;

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
    "Australia's specialist dilapidation reporting firm — pre- and post-construction condition reports that hold up when a damage claim is made. Trusted on Queens Wharf, NorthConnex, Brisbane Airport and Barangaroo.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body>
        <JsonLd data={[organizationSchema(), localBusinessSchema()]} />
        {children}
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
