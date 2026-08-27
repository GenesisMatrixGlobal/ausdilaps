"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Makes #heading deep links actually land on the heading.
 *
 *  The browser resolves a hash once, at load, against whatever is in the DOM at
 *  that instant — and on a streamed React page the heading isn't there yet, so it
 *  gives up and leaves you at the top. Client-side navigation into a route slot
 *  misses it for the same reason. Neither is obviously broken on screen, which is
 *  worse: a citation to "Common problems" silently opens the top of a long page
 *  and the reader concludes the search was wrong.
 *
 *  Polls briefly until the target exists. Timers rather than requestAnimationFrame
 *  on purpose: rAF is paused entirely while a tab is backgrounded, so a citation
 *  opened in a new tab would never scroll. scrollIntoView honours the scroll-mt-24
 *  the headings already carry, so the target clears the sticky header. */
export function ScrollToHash() {
  const pathname = usePathname();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    function go(attempt = 0) {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;

      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ block: "start" });
        return;
      }
      // ~2s of retries. Longer than any render of a training module, short enough
      // that a genuinely missing anchor doesn't leave a timer running.
      if (attempt < 40) timer = setTimeout(() => go(attempt + 1), 50);
    }

    go();
    const onHashChange = () => go();
    window.addEventListener("hashchange", onHashChange);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [pathname]);

  return null;
}
