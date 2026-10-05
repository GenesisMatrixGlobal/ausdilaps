"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import {
  SERVICES_PILLAR,
  SERVICES_DILAPIDATION,
  SERVICES_SPECIALIST,
  SERVICES_UTILITY,
} from "@/lib/nav";

/**
 * Desktop "Services" mega-menu — a disclosure dropdown opened on hover or by
 * keyboard (Enter/Space on the trigger). Closes on mouse-leave (intent delay),
 * Escape (focus returns to trigger), outside-pointer, blur-out, or link click.
 * Brand tokens only; the dilapidation pillar is highlighted, the rest flat.
 */
export function ServicesMenu() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const openMenu = () => {
    cancelClose();
    setOpen(true);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };
  const closeNow = () => {
    cancelClose();
    setOpen(false);
  };

  // Escape (return focus to trigger) + outside-pointer close, while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (closeTimer.current) {
          clearTimeout(closeTimer.current);
          closeTimer.current = null;
        }
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  // Clear any pending timer on unmount.
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    []
  );

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={openMenu}
      onMouseLeave={scheduleClose}
      onBlur={(e) => {
        if (!containerRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls="services-menu-panel"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-medium transition-colors hover:text-ad-steel-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ad-steel focus-visible:ring-offset-4 ${
          open ? "text-ad-steel-dark" : "text-ad-ink"
        }`}
      >
        Services
        <ChevronDown
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      <div
        id="services-menu-panel"
        className={`absolute left-0 top-full z-50 w-[30rem] pt-3 transition duration-150 ${
          open
            ? "visible translate-y-0 opacity-100"
            : "pointer-events-none invisible -translate-y-1 opacity-0"
        }`}
      >
        <nav
          aria-label="Services"
          className="overflow-hidden rounded-xl border border-ad-steel/15 bg-white shadow-xl shadow-ad-steel/10"
        >
          {/* Flagship pillar */}
          <div className="border-l-2 border-ad-steel bg-ad-sky px-5 py-4">
            <Link
              href={SERVICES_PILLAR.href}
              onClick={closeNow}
              className="group inline-flex items-center gap-1.5 font-heading text-sm font-semibold text-ad-ink transition-colors hover:text-ad-steel"
            >
              {SERVICES_PILLAR.label}
              <span className="text-ad-steel transition-transform group-hover:translate-x-0.5">→</span>
            </Link>
            <p className="mt-1 text-xs leading-relaxed text-ad-muted">{SERVICES_PILLAR.blurb}</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {SERVICES_DILAPIDATION.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={closeNow}
                  className="text-xs font-medium text-ad-steel transition-colors hover:text-ad-steel-dark hover:underline"
                >
                  {l.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Specialist services */}
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 p-2">
            {SERVICES_SPECIALIST.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={closeNow}
                className="rounded-md px-3 py-2 text-sm font-medium text-ad-ink transition-colors hover:bg-ad-sky hover:text-ad-steel-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ad-steel"
              >
                {l.label}
              </Link>
            ))}
          </div>

          {/* Utility row */}
          <div className="flex items-center gap-4 border-t border-ad-border px-5 py-3">
            {SERVICES_UTILITY.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={closeNow}
                className="text-xs font-semibold text-ad-muted transition-colors hover:text-ad-steel"
              >
                {l.label} →
              </Link>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}
