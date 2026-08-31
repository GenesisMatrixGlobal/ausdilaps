"use client";

import { createContext, useState } from "react";

/** Where a tool can render its own controls — its sub-mode tabs, typically — into the
 *  frame's title row.
 *
 *  It exists because those controls belong to the tool, which is this component's CHILD,
 *  so they can't be handed down as a prop. The alternatives were worse: hoisting a tool's
 *  tab state out into the page, or letting every tool render its own heading, which is
 *  the exact thing ToolFrame was built to avoid. A portal keeps the title here and the
 *  tabs there. */
export const ToolHeaderSlotContext = createContext<HTMLElement | null>(null);

/** Shared chrome for every tool page, so the tools themselves render no headings
 *  and stay department-agnostic.
 *
 *  Deliberately no description: the registry's one-liner introduces the tool on its card
 *  in the tools list, which is where you decide to open it. Repeating it here just pushes
 *  the actual work further down the page. */
export function ToolFrame({
  title,
  code,
  children,
}: {
  title: string;
  /** Short reference code (SMK, PSZ, ...) — shown so someone looking at a tool
   *  can quote it in a message without leaving the page. */
  code?: string;
  children: React.ReactNode;
}) {
  // State, not a ref: the portal target has to exist before ToolHeaderSlot can render
  // into it, and a ref mutation wouldn't re-render the consumer.
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  return (
    <div>
      {/* Tabs sit immediately after the title rather than pushed to the far right, so
          the eye travels title -> tabs -> content in one short move. items-end so their
          active underline lands on this row's rule and the two read as one tabbed
          header. */}
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2 border-b border-ad-border">
        <div className="flex items-center gap-2.5 pb-2">
          <h2 className="text-xl font-semibold text-ad-ink">{title}</h2>
          {code && (
            <span className="rounded border border-ad-border bg-ad-surface px-2 py-0.5 font-mono text-[0.7rem] font-semibold tracking-wide text-ad-muted">
              {code}
            </span>
          )}
        </div>
        <div ref={setSlot} className="flex items-end" />
      </div>
      <ToolHeaderSlotContext.Provider value={slot}>
        <div className="mt-6">{children}</div>
      </ToolHeaderSlotContext.Provider>
    </div>
  );
}
