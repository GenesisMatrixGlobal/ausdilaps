import Link from "next/link";
import { getStaffUser } from "@/lib/auth/session";
import { Container } from "@/components/marketing/container";

export const metadata = {
  title: "No access · AusDilaps",
  robots: { index: false, follow: false },
};

export default async function NoAccessPage() {
  const user = await getStaffUser();

  return (
    <Container className="flex min-h-[70vh] max-w-lg flex-col justify-center py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ad-steel">
        Access denied
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-ad-ink">
        You don&rsquo;t have access to that
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-ad-muted">
        {user
          ? "Your account doesn't include that department. If you need it, ask a company admin to add it to your access."
          : "You're not signed in as staff."}
      </p>

      <div className="mt-6 flex flex-wrap gap-4 text-sm font-medium">
        {user ? (
          <Link href="/staff" className="text-ad-steel hover:underline">
            ← Back to your departments
          </Link>
        ) : (
          <Link href="/staff/login" className="text-ad-steel hover:underline">
            Sign in
          </Link>
        )}
      </div>
    </Container>
  );
}
