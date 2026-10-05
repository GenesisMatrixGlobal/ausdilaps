"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Menu, X, ChevronDown } from "lucide-react";
import { HeaderContactButton } from "./header-contact-button";
import { NAV, SITE } from "@/lib/site";
import {
  SERVICES_PILLAR,
  SERVICES_DILAPIDATION,
  SERVICES_SPECIALIST,
  SERVICES_UTILITY,
} from "@/lib/nav";

/**
 * Mobile/tablet navigation drawer. Renders the hamburger trigger (lg:hidden) and a
 * full-width panel below the 64px sticky header. Reuses brand tokens only.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close the drawer and collapse the Services accordion together.
  const closeDrawer = () => {
    setOpen(false);
    setServicesOpen(false);
  };

  // Lock body scroll + close on Escape while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onDesktop = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setOpen(false);
        setServicesOpen(false);
      }
    };
    const onNavigate = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest("a[href]")) {
        setOpen(false);
        setServicesOpen(false);
      }
    };
    panelRef.current?.querySelector<HTMLElement>("a[href], button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setServicesOpen(false);
        triggerRef.current?.focus();
      } else if (e.key === "Tab") {
        const controls = panelRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
        const first = controls?.[0];
        const last = controls?.[controls.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("click", onNavigate);
    desktop.addEventListener("change", onDesktop);
    return () => {
      html.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onNavigate);
      desktop.removeEventListener("change", onDesktop);
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? closeDrawer() : setOpen(true))}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        className="-mr-1 inline-flex h-11 w-11 items-center justify-center rounded-md text-ad-ink transition-colors hover:bg-ad-sky focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ad-steel focus-visible:ring-offset-2"
      >
        {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={closeDrawer}
            className="fixed inset-x-0 bottom-0 top-16 z-40 cursor-default bg-ad-ink/30 backdrop-blur-sm"
          />
          {/* Panel */}
          <div
            ref={panelRef}
            id="mobile-nav-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Site navigation"
            className="fixed inset-x-0 top-16 z-50 max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain border-b border-ad-steel/15 bg-white"
          >
            <nav className="flex flex-col px-6 py-4">
              {NAV.map((item) =>
                item.menu === "services" ? (
                  <div key={item.href} className="border-b border-ad-border">
                    <button
                      type="button"
                      onClick={() => setServicesOpen((v) => !v)}
                      aria-expanded={servicesOpen}
                      aria-controls="mobile-services-submenu"
                      className="flex w-full items-center justify-between py-4 font-heading text-lg font-medium text-ad-ink transition-colors hover:text-ad-accent"
                    >
                      {item.label}
                      <ChevronDown
                        className={`h-5 w-5 transition-transform ${servicesOpen ? "rotate-180" : ""}`}
                        aria-hidden="true"
                      />
                    </button>
                    {servicesOpen && (
                      <div id="mobile-services-submenu" className="pb-3">
                        <Link
                          href={SERVICES_PILLAR.href}
                          onClick={closeDrawer}
                          className="block py-2 font-heading text-base font-semibold text-ad-steel transition-colors hover:text-ad-steel-dark"
                        >
                          {SERVICES_PILLAR.label}
                        </Link>
                        {[...SERVICES_DILAPIDATION, ...SERVICES_SPECIALIST].map((l) => (
                          <Link
                            key={l.href}
                            href={l.href}
                            onClick={closeDrawer}
                            className="block py-2 pl-3 text-sm text-ad-muted transition-colors hover:text-ad-ink"
                          >
                            {l.label}
                          </Link>
                        ))}
                        {SERVICES_UTILITY.map((l) => (
                          <Link
                            key={l.href}
                            href={l.href}
                            onClick={closeDrawer}
                            className="block py-2 text-sm font-medium text-ad-muted transition-colors hover:text-ad-steel"
                          >
                            {l.label} →
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={closeDrawer}
                    className="border-b border-ad-border py-4 font-heading text-lg font-medium text-ad-ink transition-colors hover:text-ad-accent"
                  >
                    {item.label}
                  </Link>
                )
              )}
              <a
                href={`tel:${SITE.phone.replace(/\s/g, "")}`}
                onClick={closeDrawer}
                className="py-4 text-sm font-medium text-ad-muted transition-colors hover:text-ad-ink"
              >
                Call {SITE.phone}
              </a>
              <HeaderContactButton
                size="lg"
                className="mt-2 w-full"
                onClick={closeDrawer}
              />
            </nav>
          </div>
        </>
      )}
    </div>
  );
}
