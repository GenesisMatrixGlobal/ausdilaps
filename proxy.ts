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
//   4. The samples gate — see samplesGate() below. Lives here and not in the page so
//      both samples routes stay static ISR pages.

import { NextResponse, after, type NextRequest } from "next/server";
import { createProxyClient, supabaseConfigured } from "@/lib/supabase/proxy";
import { isDepartmentSlug } from "@/lib/departments";
import {
  SAMPLES_COOKIE,
  SAMPLES_COOKIE_OPTIONS,
  SAMPLES_LIBRARY_PATH,
  SAMPLES_PATH,
  cookieValueFor,
  gateEnabled,
  isValidCode,
  isValidCookie,
} from "@/lib/samples-access";
import { looksLikeBot, recordPageView, type PageViewEvent } from "@/lib/page-views";

export const config = {
  matcher: ["/staff/:path*", "/admin/:path*", "/dilapidation-reports/samples/:path*"],
};

/** Reachable without a session — the login form and the magic-link landing. */
const PUBLIC_PATHS = ["/staff/login", "/staff/auth/callback", "/staff/no-access"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === SAMPLES_PATH || pathname.startsWith(`${SAMPLES_PATH}/`)) {
    return samplesGate(req);
  }

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

/** The access gate on the sample report library (lib/samples-access.ts).
 *
 *  Two static pages, one URL. /dilapidation-reports/samples is the locked teaser and the
 *  only route Google sees; /dilapidation-reports/samples/library is the real list. A
 *  browser holding the cookie is REWRITTEN to the library (URL unchanged), one without it
 *  that hits the library directly is sent back. `?code=` — how every quote links here —
 *  is validated, turned into the cookie, and redirected to the clean URL, so the code never
 *  sits in the address bar to be shared on. A wrong code redirects with `?error=code`,
 *  which the page's unlock form reads in the browser (the server page never reads
 *  searchParams — that would make it dynamic and lose the ISR cache).
 *
 *  No codes configured = no gate: everything rewrites to the library. Fail open, because a
 *  missing env var must not hide the library from the clients it exists for. */
async function samplesGate(req: NextRequest): Promise<NextResponse> {
  const url = req.nextUrl;
  const clean = new URL(SAMPLES_PATH, req.url);

  // Counts a person looking at the page, for the /admin tile. Only top-level document
  // requests from something that is not a bot: prefetches, link previewers, crawlers and
  // our own headless tests would otherwise triple the number and make it worthless.
  const ua = req.headers.get("user-agent");
  const countable =
    req.method === "GET" &&
    (req.headers.get("sec-fetch-dest") ?? "document") === "document" &&
    !req.headers.get("next-router-prefetch") &&
    !looksLikeBot(ua);
  const count = (event: PageViewEvent) => {
    if (!countable) return;
    const referrer = req.headers.get("referer");
    after(() => recordPageView(event, { referrer, userAgent: ua }));
  };

  if (!gateEnabled()) {
    count("view_library");
    return url.pathname === SAMPLES_LIBRARY_PATH
      ? NextResponse.next()
      : NextResponse.rewrite(new URL(SAMPLES_LIBRARY_PATH, req.url));
  }

  const code = url.searchParams.get("code");
  if (code !== null) {
    if (isValidCode(code)) {
      count("unlock_code");
      const res = NextResponse.redirect(clean, 303);
      res.cookies.set(SAMPLES_COOKIE, await cookieValueFor(code), SAMPLES_COOKIE_OPTIONS);
      return res;
    }
    count("unlock_code_failed");
    clean.searchParams.set("error", "code");
    return NextResponse.redirect(clean, 303);
  }

  const unlocked = await isValidCookie(req.cookies.get(SAMPLES_COOKIE)?.value);

  if (url.pathname === SAMPLES_LIBRARY_PATH) {
    if (unlocked) count("view_library");
    return unlocked ? NextResponse.next() : NextResponse.redirect(clean, 303);
  }
  if (url.pathname === SAMPLES_PATH) {
    count(unlocked ? "view_library" : "view_locked");
    if (unlocked) return NextResponse.rewrite(new URL(SAMPLES_LIBRARY_PATH, req.url));
  }
  return NextResponse.next();
}

function loginUrl(req: NextRequest, next: string): URL {
  const url = new URL("/staff/login", req.url);
  url.searchParams.set("next", next);
  return url;
}
