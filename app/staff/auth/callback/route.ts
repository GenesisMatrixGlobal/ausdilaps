// Magic-link / invite landing. Turns a one-time link into a session cookie.
//
// Handles both shapes Supabase can send:
//   ?code=…                    PKCE — magic links started from our own login form
//   ?token_hash=…&type=…       server-issued links (invites), via a template that
//                              uses {{ .TokenHash }} — see docs/staff-portal.md
//
// Anything else is a dead or already-used link, so bounce to login with a reason.

import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  // Only ever redirect to our own paths — never trust ?next off the wire.
  const nextParam = searchParams.get("next");
  const next = nextParam && nextParam.startsWith("/") ? nextParam : "/staff";

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
    return NextResponse.redirect(new URL(failure(error.message), origin));
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL(next, origin));
    return NextResponse.redirect(new URL(failure(error.message), origin));
  }

  return NextResponse.redirect(new URL("/staff/login?error=link_invalid", origin));
}

function failure(message: string): string {
  const reason = /expired/i.test(message) ? "link_expired" : "link_invalid";
  return `/staff/login?error=${reason}`;
}
