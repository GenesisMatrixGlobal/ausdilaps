"use client";

import { useEffect, useRef } from "react";

/**
 * Cloudflare Turnstile, rendered EXPLICITLY.
 *
 * The form used to drop in `<div class="cf-turnstile">` and let api.js find it. api.js only
 * scans the page once, when it first loads — so a form that mounts AFTER that (client-side
 * navigation from / to /quote, or "send another" after a success) got an empty div, no token,
 * and a "Verification failed" on every submit. Rendering by hand works on every mount.
 *
 * A token is SINGLE-USE: bump `resets` after any submit that didn't succeed, or the retry
 * sends a spent token and fails. (A counter prop rather than an imperative ref: the submit
 * handler is passed through react-hook-form during render, which the compiler lint rejects
 * for anything reading a ref.)
 */

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    s.onerror = () => {
      loading = null; // let the next mount try again
      reject(new Error("turnstile failed to load"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export function Turnstile({
  siteKey,
  onToken,
  resets = 0,
  className,
}: {
  siteKey: string;
  /** The current token, or "" when it expires or errors. */
  onToken: (token: string) => void;
  /** Change this to discard the current token and run the check again. */
  resets?: number;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const latest = useRef(onToken);
  useEffect(() => {
    latest.current = onToken;
  });

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((ts) => {
        if (cancelled || !box.current) return;
        widgetId.current = ts.render(box.current, {
          sitekey: siteKey,
          callback: (t: string) => latest.current(t),
          "expired-callback": () => latest.current(""),
          "error-callback": () => latest.current(""),
        });
      })
      .catch((e) => console.error("[turnstile]", e));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    if (resets === 0) return;
    latest.current("");
    if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
  }, [resets]);

  return <div ref={box} className={className} />;
}
