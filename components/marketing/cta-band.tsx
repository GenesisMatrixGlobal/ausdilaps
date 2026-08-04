import { Container } from "./container";
import { Eyebrow } from "./eyebrow";
import { Button } from "@/components/ui/button";
import { QUOTE_HREF, CAPABILITY_HREF } from "@/lib/site";

/**
 * The site-wide conversion band (charcoal + blueprint grid). Always carries
 * id="contact" so every page's "Request a Quote" anchor resolves on-page.
 */
export function CtaBand({
  eyebrow,
  heading = "Protect your project from the dispute that hasn't happened yet.",
  subhead = "Tell us about your project and we'll scope it.",
  secondary = true,
  size = "lg",
}: {
  eyebrow?: string;
  heading?: string;
  subhead?: string;
  secondary?: boolean;
  size?: "md" | "lg";
}) {
  const padding = size === "lg" ? "py-20 lg:py-28" : "py-16 lg:py-20";
  return (
    <section id="contact" className="scroll-mt-20 bg-ad-navy-deep">
      <div className="blueprint-grid">
        <Container className={`text-center ${padding}`}>
          {eyebrow && <Eyebrow className="justify-center text-ad-accent-2">{eyebrow}</Eyebrow>}
          <h2
            className={`mx-auto max-w-3xl text-balance font-heading font-semibold tracking-tight text-white ${
              eyebrow ? "mt-6" : ""
            } ${size === "lg" ? "text-4xl sm:text-5xl" : "text-3xl sm:text-4xl"}`}
          >
            {heading}
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-ad-on-dark-muted">{subhead}</p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Button href={QUOTE_HREF} size="lg" variant="onDarkAccent">
              Request a Quote
            </Button>
            {secondary && (
              <Button href={CAPABILITY_HREF} size="lg" variant="onDarkOutline" newTab>
                Download Capability Statement
              </Button>
            )}
          </div>
        </Container>
      </div>
    </section>
  );
}
