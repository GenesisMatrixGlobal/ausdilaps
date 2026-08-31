"use client";

import { useContext } from "react";
import { createPortal } from "react-dom";
import { ToolHeaderSlotContext } from "./tool-frame";

/** Renders its children into the ToolFrame's title row.
 *
 *  Falls back to rendering inline when there's no ToolFrame above it, so a tool stays
 *  usable anywhere else — embedded in an admin page, or rendered on its own. A tool
 *  should never break just because it isn't inside the staff chrome. */
export function ToolHeaderSlot({ children }: { children: React.ReactNode }) {
  const slot = useContext(ToolHeaderSlotContext);
  if (!slot) return <>{children}</>;
  return createPortal(children, slot);
}
