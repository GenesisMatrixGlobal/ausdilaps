import type { ReactNode } from "react";
import Image from "next/image";
import { Container } from "./container";
import { Eyebrow } from "./eyebrow";
import { Breadcrumbs, type Crumb } from "./breadcrumbs";
import { Button } from "@/components/ui/button";
import { QUOTE_HREF, CAPABILITY_HREF } from "@/lib/site";
import { cn } from "@/lib/utils";

/**
 * Standard interior-page hero: breadcrumbs + eyebrow + h1 + lead + CTAs.
 * Used by every service / location / content page so the top of the page is
 * consistent with the dilapidation pillar.
 */
export function PageHero({
  crumbs,
  eyebrow,
  title,
  intro,
  actions,
  image,
}: {
  crumbs?: Crumb[];
  eyebrow: string;
  title: ReactNode;
  intro: ReactNode;
  /** Override the default CTA pair. */
  actions?: ReactNode;
  /** Project photography, beside the copy on desktop and below it on mobile. */
  image?: { src: string; alt: string; portrait?: boolean };
}) {
  return (
    <section className="border-b border-ad-border py-16 lg:py-20">
      <Container className={image ? undefined : "max-w-3xl"}>
        {crumbs && <Breadcrumbs crumbs={crumbs} />}
        <div className={image ? "mt-6 grid gap-10 lg:grid-cols-2 lg:items-center" : "mt-6"}>
          <div className="min-w-0">
            <Eyebrow className="text-ad-accent">{eyebrow}</Eyebrow>
            <h1 className="mt-5 text-balance font-heading text-4xl font-semibold leading-[1.08] tracking-tight text-ad-ink sm:text-5xl">
              {title}
            </h1>
            {typeof intro === "string" ? (
              <p className="mt-6 text-lg leading-relaxed text-ad-muted">{intro}</p>
            ) : (
              <div className="mt-6 space-y-4 text-lg leading-relaxed text-ad-muted">{intro}</div>
            )}
            <div className="mt-8 flex flex-wrap gap-3">
              {actions ?? (
                <>
                  <Button href={QUOTE_HREF} size="lg" variant="accent">
                    Request a Quote
                  </Button>
                  <Button
                    href={CAPABILITY_HREF}
                    size="lg"
                    variant="outline"
                    className="h-auto min-h-12 max-w-full whitespace-normal py-2.5 text-center"
                    newTab
                  >
                    Download Capability Statement
                  </Button>
                </>
              )}
            </div>
          </div>
          {image && (
            <div
              className={cn(
                "relative overflow-hidden rounded-2xl bg-ad-sky ring-1 ring-ad-steel/15",
                image.portrait
                  ? "mx-auto aspect-[30/43] w-full max-w-[300px]"
                  : "aspect-[3/2]",
              )}
            >
              <Image
                src={image.src}
                alt={image.alt}
                fill
                sizes={
                  image.portrait
                    ? "(max-width: 347px) calc(100vw - 48px), 300px"
                    : "(max-width: 1023px) 100vw, (max-width: 1240px) 50vw, 568px"
                }
                className="object-cover"
                preload
              />
            </div>
          )}
        </div>
      </Container>
    </section>
  );
}
