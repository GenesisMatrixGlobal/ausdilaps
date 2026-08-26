import { cn } from "@/lib/utils";

/** Small status badge. Extracted from components/tools/tender-watch/view.tsx, where it
 *  was private, so /admin can use the same visual language for the same meanings. */
export type PillTone = "ok" | "warn" | "critical" | "muted";

const TONES: Record<PillTone, string> = {
  ok: "bg-ad-steel/10 text-ad-steel",
  warn: "bg-ad-orange/10 text-ad-orange",
  critical: "bg-ad-orange/15 text-ad-orange",
  muted: "bg-ad-surface text-ad-muted",
};

export function Pill({
  tone = "muted",
  children,
  className,
}: {
  tone?: PillTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "rounded px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide",
        TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
