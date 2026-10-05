import Link from "next/link";
import Image from "next/image";
import { Container } from "./container";
import { HeaderContactButton } from "./header-contact-button";
import { MobileNav } from "./mobile-nav";
import { CommandCentreLink } from "./command-centre-link";
import { ServicesMenu } from "./services-menu";
import { NAV, SITE } from "@/lib/site";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-ad-steel/15 bg-white">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex min-h-11 shrink-0 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ad-steel focus-visible:ring-offset-4" aria-label="AusDilaps home">
          <Image
            src="/logo/ad-logo.png"
            alt="AusDilaps — Specialist Building Inspections"
            width={1000}
            height={369}
            sizes="98px"
            loading="eager"
            className="h-9 w-auto"
          />
        </Link>

        <nav aria-label="Main navigation" className="hidden items-center gap-6 lg:flex">
          {NAV.map((item) =>
            item.menu === "services" ? (
              <ServicesMenu key={item.href} />
            ) : (
              <Link
                key={item.href}
                href={item.href}
                className="inline-flex min-h-11 items-center rounded-md text-sm font-medium text-ad-ink transition-colors hover:text-ad-steel-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ad-steel focus-visible:ring-offset-4"
              >
                {item.label}
              </Link>
            )
          )}
        </nav>

        <div className="flex items-center gap-3">
          <CommandCentreLink />
          <a
            href={`tel:${SITE.phone.replace(/\s/g, "")}`}
            className="hidden min-h-11 items-center rounded-md text-sm font-medium text-ad-ink transition-colors hover:text-ad-steel-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ad-steel focus-visible:ring-offset-4 lg:inline-flex"
          >
            {SITE.phone}
          </a>
          <HeaderContactButton className="hidden md:inline-flex" />
          <MobileNav />
        </div>
      </Container>
    </header>
  );
}
