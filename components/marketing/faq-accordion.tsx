import Link from "next/link";
import { Container } from "./container";
import { Eyebrow } from "./eyebrow";
import type { FaqItem } from "@/data/faq";
import { cn } from "@/lib/utils";

type FaqTone = "default" | "brand";

/**
 * The bare accordion list of question/answer <details> rows. No JS needed —
 * native disclosure. Used directly by the /faq page (grouped by category) and
 * wrapped by <FaqSection> on service / pillar pages.
 */
export function FaqList({ items, tone = "default" }: { items: FaqItem[]; tone?: FaqTone }) {
  return (
    <div className={tone === "brand" ? "space-y-3" : undefined}>
      {items.map((item) => (
        <details
          key={item.q}
          className={cn(
            "group py-5",
            tone === "brand"
              ? "rounded-xl border border-ad-steel/15 bg-white px-5 transition-colors open:border-ad-steel/35"
              : "border-b border-ad-border"
          )}
        >
          <summary className={cn(
            "flex cursor-pointer list-none items-center justify-between gap-4 font-heading text-base font-semibold text-ad-ink [&::-webkit-details-marker]:hidden",
            tone === "brand" && "focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ad-steel focus-visible:ring-offset-4"
          )}>
            {item.q}
            <span className="shrink-0 text-xl leading-none text-ad-accent transition-transform duration-200 group-open:rotate-45">
              +
            </span>
          </summary>
          <p className="mt-3 text-[0.95rem] leading-relaxed text-ad-muted">{item.a}</p>
        </details>
      ))}
    </div>
  );
}

/**
 * Full FAQ band (surface) with heading + optional "see all" link. Emits no
 * schema itself — the page passes the same items to faqPageSchema().
 */
export function FaqSection({
  items,
  eyebrow = "Common questions",
  heading,
  seeAllHref = "/faq",
  tone = "default",
}: {
  items: FaqItem[];
  eyebrow?: string;
  heading: string;
  seeAllHref?: string | null;
  tone?: FaqTone;
}) {
  return (
    <section className={cn("py-20 lg:py-24", tone === "brand" ? "bg-ad-sky" : "bg-ad-surface")}>
      <Container className="max-w-3xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow className="text-ad-accent">{eyebrow}</Eyebrow>
            <h2 className={cn("mt-5 font-heading text-3xl font-semibold tracking-tight text-ad-ink", tone === "brand" && "sm:text-4xl")}>
              {heading}
            </h2>
          </div>
          {seeAllHref && (
            <Link
              href={seeAllHref}
              className={tone === "brand"
                ? "text-sm font-semibold text-ad-steel-dark transition-colors hover:text-ad-ink"
                : "text-sm font-medium text-ad-accent hover:brightness-90"}
            >
              See all FAQs →
            </Link>
          )}
        </div>
        <div className="mt-8">
          <FaqList items={items} tone={tone} />
        </div>
      </Container>
    </section>
  );
}
