import { Container } from "./container";
import { Eyebrow } from "./eyebrow";
import { Button } from "@/components/ui/button";
import { QUOTE_HREF, CAPABILITY_HREF } from "@/lib/site";
import { cn } from "@/lib/utils";

/**
 * The site-wide conversion band, with an optional pale-blue tone. Always carries
 * id="contact" so every page's "Request a Quote" anchor resolves on-page.
 */
export function CtaBand({
  eyebrow,
  heading = "Protect your project from the dispute that hasn't happened yet.",
  subhead = "Tell us about your project and we'll scope it.",
  secondary = true,
  size = "lg",
  tone = "dark",
}: {
  eyebrow?: string;
  heading?: string;
  subhead?: string;
  secondary?: boolean;
  size?: "md" | "lg";
  tone?: "dark" | "light";
}) {
  const padding = size === "lg" ? "py-20 lg:py-28" : "py-16 lg:py-20";
  const isLight = tone === "light";
  return (
    <section id="contact" className={cn("scroll-mt-20", isLight ? "bg-ad-sky-deep" : "bg-ad-navy-deep")}>
      <div className={isLight ? undefined : "blueprint-grid"}>
        <Container className={`text-center ${padding}`}>
          {eyebrow && <Eyebrow className={cn("justify-center", isLight ? "text-ad-steel-dark" : "text-ad-accent-2")}>{eyebrow}</Eyebrow>}
          <h2
            className={cn(
              "mx-auto max-w-3xl text-balance font-heading font-semibold tracking-tight",
              isLight ? "text-ad-ink-deep" : "text-white",
              eyebrow && "mt-6",
              size === "lg" ? "text-4xl sm:text-5xl" : "text-3xl sm:text-4xl"
            )}
          >
            {heading}
          </h2>
          <p className={cn("mx-auto mt-5 max-w-xl text-lg", isLight ? "text-ad-ink" : "text-ad-on-dark-muted")}>{subhead}</p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Button href={QUOTE_HREF} size="lg" variant={isLight ? "accent" : "onDarkAccent"}>
              Request a Quote
            </Button>
            {secondary && (
              <Button
                href={CAPABILITY_HREF}
                size="lg"
                variant={isLight ? "outline" : "onDarkOutline"}
                className={isLight ? "h-auto min-h-12 max-w-full whitespace-normal border-ad-steel/25 bg-white py-2 text-ad-ink hover:bg-ad-sky" : undefined}
                newTab
              >
                Download Capability Statement
              </Button>
            )}
          </div>
        </Container>
      </div>
    </section>
  );
}
