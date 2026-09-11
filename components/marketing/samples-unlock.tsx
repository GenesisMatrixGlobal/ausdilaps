"use client";

import { useSyncExternalStore } from "react";
import { SAMPLES_PATH } from "@/lib/samples-access";

/**
 * The gate on the locked samples page. Two ways in, side by side:
 *
 *  - the access code from a quote — a plain GET form, so `?code=` lands in proxy.ts exactly
 *    as a quote's link does. No JavaScript in the path; the middleware sets the cookie.
 *  - an email address — POSTs to /api/samples/unlock, which records a lead and sets the same
 *    cookie. The fallback for someone who arrived from Google, or whose quote went to a
 *    colleague.
 *
 * This is a client component ONLY for the error line: the server page never reads
 * searchParams (that would make it dynamic and lose the ISR cache), so `?error=` is read
 * from the browser's own URL — via useSyncExternalStore with a null server snapshot, which
 * is the hydration-safe way to read window state without a setState-in-effect.
 */

function subscribeNever() {
  return () => {};
}

function readErrorParam(): "code" | "email" | null {
  const e = new URLSearchParams(window.location.search).get("error");
  return e === "code" || e === "email" ? e : null;
}
export function SamplesUnlock() {
  const error = useSyncExternalStore(subscribeNever, readErrorParam, () => null);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <form
        method="get"
        action={SAMPLES_PATH}
        className="rounded-xl border border-ad-border bg-white p-5"
      >
        <h2 className="font-heading text-base font-semibold text-ad-ink">Have a quote from us?</h2>
        <p className="mt-1 text-sm text-ad-muted">Enter the access code printed on it.</p>
        <div className="mt-4 flex gap-2">
          <input
            type="text"
            name="code"
            required
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="Access code"
            aria-invalid={error === "code" || undefined}
            className="h-11 min-w-0 flex-1 rounded-full border border-ad-border bg-white px-4 font-mono text-sm uppercase tracking-wider text-ad-ink placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-ad-muted/70 focus:border-ad-accent focus:outline-none aria-[invalid]:border-ad-orange"
          />
          <button
            type="submit"
            className="h-11 shrink-0 rounded-full bg-ad-navy px-5 text-sm font-medium text-white transition-colors hover:bg-ad-navy-deep"
          >
            Open
          </button>
        </div>
        {error === "code" && (
          <p className="mt-3 text-sm text-ad-orange">
            That code didn&rsquo;t match. Check the quote, or use your email instead.
          </p>
        )}
      </form>

      <form
        method="post"
        action="/api/samples/unlock"
        className="rounded-xl border border-ad-border bg-white p-5"
      >
        <h2 className="font-heading text-base font-semibold text-ad-ink">No code yet?</h2>
        <p className="mt-1 text-sm text-ad-muted">Leave your email and we&rsquo;ll open the library now.</p>
        <div className="mt-4 grid gap-2">
          <input
            type="text"
            name="name"
            required
            autoComplete="name"
            placeholder="Your name"
            className="h-11 rounded-full border border-ad-border bg-white px-4 text-sm text-ad-ink placeholder:text-ad-muted/70 focus:border-ad-accent focus:outline-none"
          />
          <div className="flex gap-2">
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              placeholder="Work email"
              aria-invalid={error === "email" || undefined}
              className="h-11 min-w-0 flex-1 rounded-full border border-ad-border bg-white px-4 text-sm text-ad-ink placeholder:text-ad-muted/70 focus:border-ad-accent focus:outline-none aria-[invalid]:border-ad-orange"
            />
            <button
              type="submit"
              className="h-11 shrink-0 rounded-full bg-ad-navy px-5 text-sm font-medium text-white transition-colors hover:bg-ad-navy-deep"
            >
              Open
            </button>
          </div>
          {/* Honeypot — real browsers leave it empty; the route drops anything that fills it. */}
          <input
            type="text"
            name="company_website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden
            className="hidden"
          />
        </div>
        {error === "email" && (
          <p className="mt-3 text-sm text-ad-orange">
            Please enter your name and a valid email address.
          </p>
        )}
      </form>
    </div>
  );
}
