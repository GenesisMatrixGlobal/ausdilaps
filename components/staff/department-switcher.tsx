"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Department } from "@/lib/departments";

/** Jump between the departments this person can access. Hidden when they only
 *  have one — a dropdown with a single entry is just noise. */
export function DepartmentSwitcher({ departments }: { departments: Department[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const active = departments.find((d) => pathname.startsWith(`/staff/${d.slug}`));

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  if (departments.length < 2) {
    return active ? (
      <span className="truncate text-sm font-semibold text-ad-ink">{active.label}</span>
    ) : null;
  }

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold text-ad-ink transition-colors hover:bg-ad-surface"
      >
        <span className="truncate">{active?.label ?? "Departments"}</span>
        <svg viewBox="0 0 20 20" aria-hidden className="size-4 shrink-0 text-ad-muted">
          <path d="M6 8l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-56 overflow-hidden rounded-xl border border-ad-border bg-white shadow-lg">
          {departments.map((d) => (
            <Link
              key={d.slug}
              href={`/staff/${d.slug}`}
              onClick={() => setOpen(false)}
              className={cn(
                "block px-3 py-2 text-sm transition-colors hover:bg-ad-surface",
                d.slug === active?.slug ? "font-semibold text-ad-steel" : "text-ad-ink"
              )}
            >
              {d.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
