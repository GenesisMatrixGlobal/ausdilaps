import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, expectedAdminSessionToken } from "@/lib/auth/admin-session";

export const config = {
  matcher: ["/admin/:path*"],
};

export async function proxy(req: NextRequest) {
  if (req.nextUrl.pathname === "/admin/login") return NextResponse.next();

  const expected = await expectedAdminSessionToken();
  const session = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (expected && session === expected) return NextResponse.next();

  return NextResponse.redirect(new URL("/admin/login", req.url));
}
