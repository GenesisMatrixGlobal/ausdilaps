"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/** "Command Centre" in the website header, for a signed-in admin only.
 *
 *  Client-side on purpose: reading the session on the server would make every marketing page
 *  dynamic and lose its static/ISR caching. And it only asks when a Supabase auth cookie is
 *  present, so an ordinary visitor costs no request at all. */
export function CommandCentreLink() {
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    if (!/(?:^|;\s*)sb-[^=]+-auth-token/.test(document.cookie)) return;
    let live = true;
    fetch("/api/staff/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { admin?: boolean } | null) => {
        if (live && j?.admin) setAdmin(true);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!admin) return null;
  return (
    <Link
      href="/admin"
      className="text-xs font-semibold uppercase tracking-[0.14em] text-ad-orange transition-opacity hover:opacity-80"
    >
      Command Centre
    </Link>
  );
}
