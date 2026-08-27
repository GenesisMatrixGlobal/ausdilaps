// Staff portal gate (Next 16's renamed middleware).
//
// Two jobs:
//   1. Refresh the Supabase session on every /staff and /admin request, so
//      access tokens actually get renewed (see lib/supabase/proxy.ts).
//   2. A coarse "is anyone signed in?" check. Department and role checks happen
//      in the route layouts, where a profile read is cheap and a 403 can be a
//      real page instead of a redirect.
//   3. Send /staff/<department> to its Tools tab. This HAS to happen here rather
//      than in a page — see departmentIndexRedirect() below.

import { NextResponse, type NextRequest } from "next/server";
import { createProxyClient, supabaseConfigured } from "@/lib/supabase/proxy";
import { isDepartmentSlug } from "@/lib/departments";

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

  // After the auth check, so a signed-out visitor still gets the login page.
  const toTools = departmentIndexRedirect(req);
  if (toTools) return toTools;

  return res;
}

/** /staff/estimators -> /staff/estimators/tools.
 *
 *  This used to be a `redirect()` in app/staff/[department]/page.tsx, which was a
 *  real bug once Tools and Training became parallel-route slots. On a soft
 *  navigation Next RETAINS a slot that doesn't match the new URL — that retention
 *  is exactly what keeps a tool's state alive behind the Training tab. But it
 *  retained this page too, so every subsequent navigation re-ran its redirect and
 *  bounced the URL straight back to /tools. Clicking Training fetched the training
 *  slot, then had the URL yanked out from under it, and looked like a dead button.
 *
 *  Middleware runs before any of that, so there is nothing for the router to hold
 *  on to. The children slot now only ever resolves to default.tsx (null), which
 *  makes the whole class of bug unreachable rather than just this instance. */
function departmentIndexRedirect(req: NextRequest): NextResponse | null {
  const segments = req.nextUrl.pathname.split("/").filter(Boolean);
  // Exactly ["staff", "<department>"] — /staff itself and anything deeper is fine.
  if (segments.length !== 2 || segments[0] !== "staff") return null;
  if (!isDepartmentSlug(segments[1])) return null;

  const url = req.nextUrl.clone();
  url.pathname = `/staff/${segments[1]}/tools`;
  return NextResponse.redirect(url);
}

function loginUrl(req: NextRequest, next: string): URL {
  const url = new URL("/staff/login", req.url);
  url.searchParams.set("next", next);
  return url;
}
