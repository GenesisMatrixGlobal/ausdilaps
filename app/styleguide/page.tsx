import { Container } from "@/components/marketing/container";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Style Guide", robots: { index: false } };

const swatches: [string, string][] = [
  ["ad-blue", "#2293D7"],
  ["ad-blue-dark", "#1B6FA3"],
  ["ad-blue-light", "#4FB0E8"],
  ["ad-ink", "#14181B"],
  ["ad-ink-deep", "#0F1316"],
  ["ad-surface", "#F6F7F9"],
  ["ad-muted", "#5B6B77"],
];

export default function StyleGuide() {
  return (
    <div className="py-16">
      <Container className="space-y-16">
        <header>
          <Eyebrow className="text-ad-blue">Design System</Eyebrow>
          <h1 className="mt-4 font-heading text-4xl font-bold tracking-tight text-ad-ink">
            AusDilaps Style Guide
          </h1>
          <p className="mt-3 max-w-xl text-ad-muted">
            Hybrid: light editorial base, bold near-black bands, AusDilaps blue accent.
          </p>
        </header>

        <section>
          <h2 className="mb-5 font-heading text-sm font-medium uppercase tracking-[0.18em] text-ad-muted">Colour</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
            {swatches.map(([name, hex]) => (
              <div key={name} className="overflow-hidden rounded-lg border border-ad-border">
                <div className="h-20" style={{ background: hex }} />
                <div className="p-3">
                  <div className="text-xs font-medium text-ad-ink">{name}</div>
                  <div className="text-xs text-ad-muted">{hex}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-5 font-heading text-sm font-medium uppercase tracking-[0.18em] text-ad-muted">Typography</h2>
          <div className="space-y-3">
            <p className="font-heading text-5xl font-semibold tracking-tight text-ad-ink">Display heading — Space Grotesk</p>
            <p className="font-heading text-3xl font-semibold tracking-tight text-ad-ink">Section heading</p>
            <p className="max-w-2xl text-lg text-ad-muted">Body copy — Inter. Pre and post-construction condition reports for Australia&apos;s most scrutinised projects.</p>
            <Eyebrow className="text-ad-blue">Eyebrow label</Eyebrow>
          </div>
        </section>

        <section>
          <h2 className="mb-5 font-heading text-sm font-medium uppercase tracking-[0.18em] text-ad-muted">Buttons</h2>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Primary</Button>
            <Button variant="dark">Dark</Button>
            <Button variant="outline">Outline</Button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-ad-ink-deep p-6">
            <Button variant="onDark">On dark</Button>
            <Button variant="onDarkOutline">On dark outline</Button>
          </div>
        </section>

        <section>
          <h2 className="mb-5 font-heading text-sm font-medium uppercase tracking-[0.18em] text-ad-muted">Dark band + blueprint grid</h2>
          <div className="overflow-hidden rounded-xl bg-ad-ink-deep">
            <div className="blueprint-grid p-12 text-center">
              <h3 className="font-heading text-3xl font-semibold text-white">Let&apos;s work together</h3>
              <p className="mt-2 text-ad-on-dark-muted">Get a quote today.</p>
            </div>
          </div>
        </section>
      </Container>
    </div>
  );
}
