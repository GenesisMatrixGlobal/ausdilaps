"use client";

import { useEffect } from "react";

const APP_ID = process.env.NEXT_PUBLIC_INTERCOM_APP_ID;

/**
 * The SDK is imported INSIDE the effect, and only when an app id is set: a static import
 * put 9KB (gz) of messenger bootstrap on every page of the site while no id was configured
 * anywhere (speed sweep, 2026-10-06). With an id set it still loads after hydration.
 */
export function IntercomMessenger() {
  useEffect(() => {
    if (!APP_ID) return;
    let cancelled = false;
    import("@intercom/messenger-js-sdk").then(({ default: Intercom }) => {
      if (!cancelled) Intercom({ app_id: APP_ID });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
