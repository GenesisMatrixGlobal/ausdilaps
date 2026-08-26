// Staff portal gate (Next 16's renamed middleware).
//
// Two jobs:
//   1. Refresh the Supabase session on every /staff and /admin request, so
//      access tokens actually get renewed (see lib/supabase/proxy.ts).
//   2. A coarse "is anyone signed in?" check. Department and role checks happen
//      in the route layouts, where a profile read is cheap and a 403 can be a
//      real page instead of a redirect.

import { NextResponse, type NextRequest } from "next/server";
import { createProxyClient, supabaseConfigured } from "@/lib/supabase/proxy";

export const config = {
  matcher: ["/staff/:path*", "/admin/:path*"],
};

/** Reachable without a session — the login form and the magic-link landing. */
const PUBLIC_PATHS = ["/staff/login", "/staff/auth/callback", "/staff/no-access"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const res = NextResponse.next({ request: req });

  // Local-only sign-in bypass — matches previewUser() in lib/auth/session.ts. Both are
  // needed: this gets you past the middleware, that one gives the page a user. Hard-gated
  // on NODE_ENV, which Vercel always sets to "production", so it cannot apply to a deploy.
  if (process.env.NODE_ENV !== "production" && process.env.STAFF_PREVIEW === "1") {
    return res;
  }

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return res;
  }

  // No Supabase env (e.g. a preview build without secrets) — don't pretend to
  // authenticate, just send everyone to the login page rather than 500ing.
  if (!supabaseConfigured()) {
    return NextResponse.redirect(loginUrl(req, pathname));
  }

  const supabase = createProxyClient(req, res);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(loginUrl(req, pathname + req.nextUrl.search));
  }

  return res;
}

function loginUrl(req: NextRequest, next: string): URL {
  const url = new URL("/staff/login", req.url);
  url.searchParams.set("next", next);
  return url;
}
