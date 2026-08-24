import Link from "next/link";
import Image from "next/image";
import { requireAdmin } from "@/lib/auth/session";
import { Container } from "@/components/marketing/container";
import { AdminNav } from "@/components/staff/admin-nav";

export const metadata = {
  title: "Admin · AusDilaps",
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
            <Link href="/admin" className="flex shrink-0 items-center" aria-label="Admin home">
              <Image
                src="/logo/ad-logo.png"
                alt="AusDilaps"
                width={640}
                height={236}
                priority
                className="h-8 w-auto"
              />
            </Link>
            <span className="hidden h-5 w-px shrink-0 bg-ad-border sm:block" />
            <span className="hidden shrink-0 text-xs font-semibold uppercase tracking-[0.14em] text-ad-orange sm:block">
              Admin
            </span>
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
    </div>
  );
}
