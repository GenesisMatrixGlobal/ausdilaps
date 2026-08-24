"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export function LoginForm({ next }: { next?: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setState("sending");

    const params = new URLSearchParams();
    if (next && next.startsWith("/")) params.set("next", next);
    const redirectTo = `${window.location.origin}/staff/auth/callback${
      params.size ? `?${params}` : ""
    }`;

    const { error: err } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: redirectTo,
        // Critical: Supabase's default is to CREATE a user for an unknown email.
        // Without this, anyone could self-provision a staff account.
        shouldCreateUser: false,
      },
    });

    if (err) {
      // Supabase returns a generic signup-disabled error for unknown emails.
      setError(
        /signup|not allowed|not found/i.test(err.message)
          ? "There's no staff account for that email. Ask an admin to invite you."
          : err.message
      );
      setState("idle");
      return;
    }

    setState("sent");
  }

  if (state === "sent") {
    return (
      <div className="mt-6 rounded-xl border border-ad-border bg-ad-surface px-4 py-5">
        <p className="text-sm font-semibold text-ad-ink">Check your email</p>
        <p className="mt-1 text-sm leading-relaxed text-ad-muted">
          We sent a sign-in link to <span className="text-ad-ink">{email.trim()}</span>. It expires
          in an hour and can only be used once.
        </p>
        <button
          type="button"
          onClick={() => setState("idle")}
          className="mt-3 text-sm font-medium text-ad-steel hover:underline"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-3">
      <label htmlFor="email" className="block text-sm font-medium text-ad-ink">
        Work email
        <input
          id="email"
          type="email"
          required
          autoFocus
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@ausdilaps.com.au"
          className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm font-normal text-ad-ink outline-none focus:border-ad-steel"
        />
      </label>

      <button
        type="submit"
        disabled={state === "sending"}
        className={cn(
          buttonVariants({ variant: "primary", size: "md" }),
          "w-full",
          state === "sending" && "opacity-60"
        )}
      >
        {state === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>

      {error && <p className="text-sm text-ad-orange">{error}</p>}
    </form>
  );
}
