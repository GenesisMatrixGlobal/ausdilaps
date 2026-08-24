// Supabase client for proxy.ts (Next 16's renamed middleware).
//
// This is the piece that actually refreshes auth tokens. Server Components can't
// write cookies, so lib/supabase/server.ts swallows its setAll() — the refreshed
// tokens only get persisted if something in the request path calls getUser() with
// a writable cookie jar. That something is the proxy. Without it, sessions
// silently die when the access token expires (~1 hour) even though the user has a
// valid refresh token.

import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

export function createProxyClient(req: NextRequest, res: NextResponse) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value);
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );
}

export function supabaseConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
