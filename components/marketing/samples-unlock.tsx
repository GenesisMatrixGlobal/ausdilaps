"use client";

import { useSyncExternalStore } from "react";

/**
 * The gate on the locked samples page: ONE card, name and email.
 *
 * ⚠️ There used to be a second card beside it taking the access code off a quote, and it was
 * removed on 2026-09-30 (Rhys) rather than demoted. Two doors halved the only thing this
 * gate is for — everyone who used the code arrived anonymously, so /admin/samples could
 * never show them as more than "Visitor 3f9a2c1e · Access code". A quote link carrying
 * `?code=` still opens the library silently in proxy.ts; nothing here advertises it, and
 * there is no longer anywhere to type one.
 *
 * ⚠️ NO explanatory copy under the heading, and no reassurance line under the button —
 * both were written and both were cut on 2026-09-30 (Rhys: "keep the wording to a
 * minimum"). Three labelled fields and a button that says what it does need no preamble;
 * the subtext only restated them. The button design stays as it is.
 *
 * ⚠️ NO marketing consent checkbox (removed 2026-10-08, Rhys: "we are not going to market to
 * people who have done this"). The address is used to follow up the visit, nothing else. If
 * marketing to this list is ever wanted, the consent box has to come back FIRST, unticked —
 * the Spam Act wants permission recorded, and every row before then has none.
 *
 * Client component ONLY for the error line: the server page never reads searchParams (that
 * would make it dynamic and lose the ISR cache that survives a Box outage), so `?error=` is
 * read from the browser's own URL — via useSyncExternalStore with a null server snapshot,
 * the hydration-safe way to read window state without a setState-in-effect.
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
    // Centred and capped rather than full width: this is the one thing to do on the page, and
    // a form stretched across a 1200px screen reads as a footer, not an invitation.
    <form
      method="post"
      action="/api/samples/unlock"
      className="mx-auto max-w-xl rounded-xl border border-ad-border bg-white p-6 text-center shadow-sm sm:p-8"
    >
      <h2 className="font-heading text-xl font-semibold tracking-tight text-ad-ink sm:text-2xl">
        See the full library
      </h2>

      <div className="mx-auto mt-5 grid max-w-sm gap-2.5 text-left">
        <input
          type="text"
          name="name"
          required
          autoComplete="name"
          placeholder="Your name"
          className="h-12 rounded-full border border-ad-border bg-white px-5 text-sm text-ad-ink placeholder:text-ad-muted/70 focus:border-ad-accent focus:outline-none"
        />
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="Work email"
          aria-invalid={error === "email" || undefined}
          className="h-12 rounded-full border border-ad-border bg-white px-5 text-sm text-ad-ink placeholder:text-ad-muted/70 focus:border-ad-accent focus:outline-none aria-[invalid]:border-ad-orange"
        />
        <input
          type="text"
          name="company"
          autoComplete="organization"
          placeholder="Company (optional)"
          className="h-12 rounded-full border border-ad-border bg-white px-5 text-sm text-ad-ink placeholder:text-ad-muted/70 focus:border-ad-accent focus:outline-none"
        />
        {/* Honeypot — real browsers leave it empty; the route drops anything that fills it. */}
        <input
          type="text"
          name="company_website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden
          className="hidden"
        />
        {/* ORANGE, the conversion accent. The old pair of cards used charcoal because two
            equal buttons should not both shout; there is one action now. */}
        <button
          type="submit"
          className="mt-1 h-12 rounded-full bg-ad-orange px-6 text-[0.95rem] font-medium text-white transition-colors hover:bg-ad-orange-dark"
        >
          Open the sample library
        </button>
      </div>

      {error === "email" && (
        <p className="mt-4 text-sm text-ad-orange">
          Please enter your name and a valid email address.
        </p>
      )}
      {/* A stale quote link whose code has been retired lands here. It must not read as the
          visitor's mistake — there is nothing for them to correct, and the form above already
          works. */}
      {error === "code" && (
        <p className="mt-4 text-sm text-ad-muted">
          That link has expired. Enter your details above and the library opens straight away.
        </p>
      )}

    </form>
  );
}
