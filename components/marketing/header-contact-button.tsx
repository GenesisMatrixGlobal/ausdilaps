"use client";

import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { QUOTE_HREF } from "@/lib/site";

/** Homepage visitors can use the form already in front of them. */
export function HeaderContactButton({
  className,
  onClick,
  size = "md",
}: {
  className?: string;
  onClick?: () => void;
  size?: "sm" | "md" | "lg";
}) {
  const isHome = usePathname() === "/";
  return (
    <Button href={isHome ? "#quote" : QUOTE_HREF} size={size} variant="accent" className={className} onClick={onClick}>
      {isHome ? "Get in touch" : "Request a Quote"}
    </Button>
  );
}
