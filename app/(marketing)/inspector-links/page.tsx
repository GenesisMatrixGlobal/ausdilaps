import type { Metadata } from "next";
import { Container } from "@/components/marketing/container";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Breadcrumbs } from "@/components/marketing/breadcrumbs";

const CRUMBS = [
  { name: "Home", path: "/" },
  { name: "Inspector Links", path: "/inspector-links" },
];

// Internal staff resource page — unlisted (no nav link, no sitemap entry) and
// kept out of search results. Not a marketing page.
export const metadata: Metadata = {
  title: "Inspector Links",
  robots: { index: false, follow: false },
};

type LinkGroup = { id: string; title: string; items: { name: string; desc: string; href: string }[] };

const GROUPS: LinkGroup[] = [
  {
    id: "documents",
    title: "Documents & templates",
    items: [
      {
        name: "Documents & Templates",
        desc: "Company documents, report templates and forms — shared Box folder.",
        href: "https://ausdilaps.box.com/s/9mhiw5a924even2qe69gpspsccr9tjyq",
      },
    ],
  },
  {
    id: "trainual",
    title: "Trainual training",
    items: [
      {
        name: "Trainual — Full",
        desc: "The complete AusDilaps training curriculum.",
        href: "https://app.trainual.com/405d1db7-bb1a-42e1-91f0-3ca79e1a5665/curriculums/825282",
      },
      {
        name: "Trainual — Western Harbour Tunnel",
        desc: "Training curriculum specific to the Western Harbour Tunnel project.",
        href: "https://app.trainual.com/405d1db7-bb1a-42e1-91f0-3ca79e1a5665/curriculums/1026656",
      },
      {
        name: "Trainual — Reports Training",
        desc: "How to complete and submit dilapidation reports.",
        href: "https://app.trainual.com/405d1db7-bb1a-42e1-91f0-3ca79e1a5665/curriculums/1262972",
      },
      {
        name: "Trainual — Other modules",
        desc: "Additional training curricula.",
        href: "https://app.trainual.com/405d1db7-bb1a-42e1-91f0-3ca79e1a5665/curriculums/1171887",
      },
    ],
  },
];

export default function InspectorLinksPage() {
  return (
    <>
      <section className="border-b border-ad-border py-12 lg:py-16">
        <Container className="max-w-3xl">
          <Breadcrumbs crumbs={CRUMBS} />
          <Eyebrow className="mt-6 text-ad-accent">Staff Resources</Eyebrow>
          <h1 className="mt-5 text-balance font-heading text-4xl font-semibold leading-[1.08] tracking-tight text-ad-ink sm:text-5xl">
            Inspector links.
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-ad-muted">
            Quick access to the documents, templates and training every AusDilaps inspector needs in
            the field.
          </p>
        </Container>
      </section>

      <section className="py-16 lg:py-20">
        <Container className="max-w-3xl space-y-14">
          {GROUPS.map((group) => (
            <div key={group.id}>
              <Eyebrow className="text-ad-accent">{group.title}</Eyebrow>
              <div className="mt-6 divide-y divide-ad-border rounded-xl border border-ad-border bg-white">
                {group.items.map((item) => (
                  <a
                    key={item.name}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-ad-surface sm:px-6"
                  >
                    <div>
                      <h2 className="font-heading text-[0.95rem] font-semibold text-ad-ink group-hover:text-ad-accent">
                        {item.name}
                      </h2>
                      <p className="mt-0.5 text-sm leading-relaxed text-ad-muted">{item.desc}</p>
                    </div>
                    <span className="shrink-0 text-sm font-medium text-ad-accent">Open →</span>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </Container>
      </section>
    </>
  );
}
