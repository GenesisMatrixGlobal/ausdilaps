"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/staff", label: "Staff" },
  { href: "/admin/tools", label: "Tools" },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1">
      {LINKS.map((link) => {
        const active =
          link.href === "/admin" ? pathname === "/admin" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "-mb-px border-b-2 px-3 py-3 text-sm font-medium transition-colors",
              active
                ? "border-ad-orange text-ad-ink"
                : "border-transparent text-ad-muted hover:text-ad-ink"
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
