import Link from "next/link";
import Image from "next/image";
import { Container } from "@/components/marketing/container";
import { DEPARTMENTS } from "@/lib/departments";
import { canAccess, isAdmin, type StaffUser } from "@/lib/auth/session";
import { DepartmentSwitcher } from "./department-switcher";

export function StaffHeader({ user }: { user: StaffUser }) {
  const departments = DEPARTMENTS.filter((d) => canAccess(user, d.slug));

  return (
    <header className="sticky top-0 z-50 border-b border-ad-border bg-white/90 backdrop-blur-md">
      <Container className="flex h-16 items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/staff" className="flex shrink-0 items-center" aria-label="Staff portal home">
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
          <span className="hidden shrink-0 text-xs font-semibold uppercase tracking-[0.14em] text-ad-steel sm:block">
            Staff
          </span>
          <DepartmentSwitcher departments={departments} />
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {isAdmin(user) && (
            <Link
              href="/admin"
              className="hidden text-sm font-medium text-ad-muted transition-colors hover:text-ad-ink sm:block"
            >
              Admin
            </Link>
          )}
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
  );
}
