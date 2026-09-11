import type { Metadata } from "next";
import { SamplesLibrary } from "@/components/marketing/samples-library";
import { SamplesContactBand, SamplesHeader } from "@/components/marketing/samples-page-parts";
import { getSampleCategories, SAMPLES_REVALIDATE } from "@/lib/samples-data";
import { SAMPLES_PATH } from "@/lib/samples-access";

// The UNLOCKED library. Never linked and never indexed: proxy.ts rewrites
// /dilapidation-reports/samples here when the visitor holds the access cookie, and
// bounces a direct hit without one back to the locked page. The canonical stays on the
// public URL so the two routes are one page as far as Google is concerned.
export const metadata: Metadata = {
  title: "Sample Dilapidation Reports | Library",
  robots: { index: false, follow: false },
  alternates: { canonical: SAMPLES_PATH },
};

export const revalidate = SAMPLES_REVALIDATE;

export default async function SamplesLibraryPage() {
  const categories = await getSampleCategories();
  return (
    <>
      <SamplesHeader>
        <SamplesLibrary categories={categories} />
      </SamplesHeader>
      <SamplesContactBand />
    </>
  );
}
