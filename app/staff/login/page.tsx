import Image from "next/image";
import { redirect } from "next/navigation";
import { getStaffUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata = {
  title: "Staff sign in · AusDilaps",
  robots: { index: false, follow: false },
};

const ERRORS: Record<string, string> = {
  link_invalid: "That sign-in link is invalid or has already been used. Request a new one below.",
  link_expired: "That sign-in link has expired. Request a new one below.",
  no_account: "There's no staff account for that email. Ask an admin to invite you.",
};

/** Only ever redirect within the site, and never back to a login route. */
function safeNext(next?: string): string {
  if (!next || !next.startsWith("/")) return "/staff";
  if (next.startsWith("/staff/login") || next.startsWith("/admin/login")) return "/staff";
  return next;
}

export default async function StaffLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  // Already signed in — don't sit on a login form.
  if (await getStaffUser()) redirect(safeNext(next));

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
      <Image
        src="/logo/ad-logo.png"
        alt="AusDilaps"
        width={168}
        height={48}
        className="h-11 w-auto"
        priority
      />

      <h1 className="mt-8 text-2xl font-semibold text-ad-ink">Staff portal</h1>
      <p className="mt-2 text-sm leading-relaxed text-ad-muted">
        Enter your AusDilaps email and we&rsquo;ll send you a sign-in link. No password needed.
      </p>

      {error && ERRORS[error] && (
        <p className="mt-5 rounded-lg border border-ad-orange/30 bg-ad-orange/5 px-3 py-2 text-sm text-ad-ink">
          {ERRORS[error]}
        </p>
      )}

      <LoginForm next={safeNext(next)} />

      <p className="mt-8 text-xs leading-relaxed text-ad-muted">
        Need access? Ask a company admin to invite you. This portal is for AusDilaps staff only.
      </p>
    </main>
  );
}
