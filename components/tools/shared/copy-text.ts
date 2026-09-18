"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Clipboard write that reports success instead of throwing — a denied permission or an
 *  insecure origin is an ordinary outcome for the button to show, not a crash. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** `copy(text)` then `copied` is true for a moment — the "Copied" flash on a button label. */
export function useCopied(flashMs = 1500): { copied: boolean; failed: boolean; copy: (text: string) => Promise<void> } {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = useCallback(
    async (text: string) => {
      const ok = await copyText(text);
      setCopied(ok);
      setFailed(!ok);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setCopied(false);
        setFailed(false);
      }, flashMs);
    },
    [flashMs]
  );

  return { copied, failed, copy };
}
