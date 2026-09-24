import Image from "next/image";
import { Container } from "@/components/marketing/container";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { CLIENTS, type Client } from "@/data/clients";
import styles from "./client-logo-bar.module.css";

/* Continuous logo marquee, pure CSS (client-logo-bar.module.css). Pauses on
   hover; stands still and wraps under prefers-reduced-motion. */
export function ClientLogoBar() {
  if (CLIENTS.length === 0) return null;
  return (
    <section aria-labelledby="clients-heading" className="border-b border-ad-border py-12">
      <Container>
        <Eyebrow className="text-ad-accent">
          <span id="clients-heading">Clients we&apos;ve worked with</span>
        </Eyebrow>
      </Container>
      <div className={`${styles.marquee} mt-8`}>
        <div className={styles.track}>
          <LogoSet clients={CLIENTS} />
          <LogoSet clients={CLIENTS} hidden />
        </div>
      </div>
    </section>
  );
}

/* Logo shapes run from the waratah (taller than wide) to Bennett + Bennett (9:1),
   so one fixed height makes one tiny and the other huge. Sizing each to the same
   AREA gives them the same visual weight; the clamp stops the extremes running away. */
const LOGO_AREA = 7000; // px² at 1x
const MIN_HEIGHT = 24;
const MAX_HEIGHT = 56;

function logoSize(width: number, height: number) {
  const aspect = width / height;
  const h = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.sqrt(LOGO_AREA / aspect)));
  return { width: Math.round(h * aspect), height: Math.round(h) };
}

function LogoSet({ clients, hidden = false }: { clients: Client[]; hidden?: boolean }) {
  return (
    <ul className={styles.set} aria-hidden={hidden || undefined}>
      {clients.map((c) => (
        <li key={c.name} className="flex h-14 shrink-0 items-center">
          {c.logo ? (
            // Shown in the client's own colours: brand rules (NSW Government's among
            // them) don't allow the marks to be greyed or recoloured.
            <Image src={c.logo.src} alt={hidden ? "" : c.name} {...logoSize(c.logo.width, c.logo.height)} />
          ) : (
            <span className="whitespace-nowrap font-heading text-lg font-semibold tracking-tight text-ad-muted">
              {c.name}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
