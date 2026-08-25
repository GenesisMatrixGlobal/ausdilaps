import Link from "next/link";
import Image from "next/image";
import { Container } from "./container";
import { Button } from "@/components/ui/button";
import { MobileNav } from "./mobile-nav";
import { ServicesMenu } from "./services-menu";
import { NAV, SITE, QUOTE_HREF } from "@/lib/site";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-ad-border bg-white/85 backdrop-blur-md">
      <Container className="flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center" aria-label="AusDilaps home">
          <Image
            src="/logo/ad-logo.png"
            alt="AusDilaps — Specialist Building Inspections"
            width={1000}
            height={369}
            priority
            className="h-9 w-auto"
          />
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {NAV.map((item) =>
            item.menu === "services" ? (
              <ServicesMenu key={item.href} />
            ) : (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm font-medium text-ad-muted transition-colors hover:text-ad-ink"
              >
                {item.label}
              </Link>
            )
          )}
        </nav>

        <div className="flex items-center gap-3">
          <a
            href={`tel:${SITE.phone.replace(/\s/g, "")}`}
            className="hidden text-sm font-medium text-ad-muted transition-colors hover:text-ad-ink lg:block"
          >
            {SITE.phone}
          </a>
          <Button href={QUOTE_HREF} size="sm" variant="accent" className="hidden md:inline-flex">
            Request a Quote
          </Button>
          <MobileNav />
        </div>
      </Container>
    </header>
  );
}
