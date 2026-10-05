import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { MobileActionBar } from "@/components/marketing/mobile-action-bar";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main>{children}</main>
      {/* Bottom padding = the mobile action bar's height, so it never sits over the footer. */}
      <div className="pb-[76px] md:pb-0">
        <SiteFooter />
      </div>
      <MobileActionBar />
    </>
  );
}
