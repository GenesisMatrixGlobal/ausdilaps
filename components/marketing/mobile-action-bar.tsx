"use client";

import { usePathname } from "next/navigation";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SITE, QUOTE_HREF } from "@/lib/site";

/**
 * Call / Request a Quote, pinned to the bottom of the screen on phones only.
 *
 * A third of visitors are on mobile, and below `md` the header hides BOTH the
 * phone number and the Request a Quote button — a resident who got our letter
 * saw a logo and a hamburger. On the homepage the quote button scrolls to the
 * hero form; everywhere else it goes to /quote. Hidden on /quote itself, where
 * the form is the page and the bar would sit over its Submit button.
 */
export function MobileActionBar() {
  const pathname = usePathname();
  if (pathname === QUOTE_HREF) return null;
  const quoteHref = pathname === "/" ? "#quote" : QUOTE_HREF;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ad-border bg-white/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-md md:hidden">
      <div className="mx-auto grid max-w-md grid-cols-2 gap-3">
        <Button href={`tel:${SITE.phone.replace(/\s/g, "")}`} variant="outline" className="w-full">
          <Phone className="h-4 w-4" aria-hidden="true" />
          {SITE.phone}
        </Button>
        <Button href={quoteHref} variant="accent" className="w-full">
          {pathname === "/" ? "Get in touch" : "Request a Quote"}
        </Button>
      </div>
    </div>
  );
}
