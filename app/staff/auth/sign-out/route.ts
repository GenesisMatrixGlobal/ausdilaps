// Sign out. POST-only so a prefetch or an <img> can't log someone out.

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/staff/login", req.nextUrl.origin), { status: 303 });
}
