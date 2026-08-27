"use client";

import { useState, useTransition } from "react";
import { knowledgeSourceFile } from "../../search-action";

/** Opens the stored original. The URL is a short-lived signed link minted per click,
 *  so there is nothing to put in an href ahead of time. */
export function DownloadOriginal({
  department,
  sourceId,
}: {
  department: string;
  sourceId: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await knowledgeSourceFile(department, sourceId);
            if (res.ok) window.open(res.url, "_blank", "noopener,noreferrer");
            else setError(res.error);
          })
        }
        className="text-sm font-medium text-ad-steel hover:underline disabled:opacity-60"
      >
        {pending ? "Preparing…" : "Download original"}
      </button>
      {error && <span className="ml-2 text-sm text-ad-orange">{error}</span>}
    </span>
  );
}
