import { NextResponse } from "next/server";
import { getStaffUser, isAdmin } from "@/lib/auth/session";

/** Is the caller a signed-in admin? Read by the website header's Command Centre link, which
 *  can't ask the server itself without making every marketing page dynamic. Says nothing
 *  beyond one boolean. */
export async function GET() {
  const user = await getStaffUser();
  return NextResponse.json(
    { admin: user ? isAdmin(user) : false },
    { headers: { "cache-control": "private, no-store" } }
  );
}
