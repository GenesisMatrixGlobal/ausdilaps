import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { requireAdmin } from "@/lib/auth/session";
import { Container } from "@/components/marketing/container";
import { AdminNav } from "@/components/staff/admin-nav";
import { NavTimer } from "@/components/staff/nav-timer";

export const metadata = {
  title: "Command Centre",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Company admins only — ordinary staff get bounced to /staff/no-access.
  const user = await requireAdmin("/admin");

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-50 border-b border-ad-border bg-white/90 backdrop-blur-md">
        <Container className="flex h-16 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {/* The logo is the company's: it goes to the website. The label beside it is this
                section's, and goes to its overview. */}
            <Link href="/" className="flex shrink-0 items-center" aria-label="AusDilaps website">
              <Image
                src="/logo/ad-logo.png"
                alt="AusDilaps"
                width={1000}
                height={369}
                priority
                className="h-8 w-auto"
              />
            </Link>
            <span className="hidden h-5 w-px shrink-0 bg-ad-border sm:block" />
            <Link
              href="/admin"
              className="shrink-0 text-xs font-semibold uppercase tracking-[0.14em] text-ad-orange transition-opacity hover:opacity-80"
            >
              Command Centre
            </Link>
          </div>

          <div className="flex shrink-0 items-center gap-4">
            <Link
              href="/staff"
              className="text-sm font-medium text-ad-muted transition-colors hover:text-ad-ink"
            >
              Staff portal
            </Link>
            <span className="hidden max-w-[16ch] truncate text-sm text-ad-muted lg:block">
              {user.fullName || user.email}
            </span>
            <form action="/staff/auth/sign-out" method="post">
              <button
                type="submit"
                className="text-sm font-medium text-ad-muted transition-colors hover:text-ad-ink"
              >
                Sign out
              </button>
            </form>
          </div>
        </Container>
      </header>

      <div className="border-b border-ad-border">
        <Container>
          <AdminNav />
        </Container>
      </div>

      <Container className="py-8">{children}</Container>

      {/* Times each tab click, start to content, into the /api/vitals log — renders nothing.
          Suspense because it reads useSearchParams; every page here is dynamic, so it never
          actually suspends, but a statically rendered route would refuse to build without it. */}
      <Suspense fallback={null}>
        <NavTimer />
      </Suspense>
    </div>
  );
}
