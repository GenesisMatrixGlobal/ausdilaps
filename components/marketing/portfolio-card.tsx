import Link from "next/link";
import Image from "next/image";
import type { PortfolioItem } from "@/data/portfolio";

/**
 * Portfolio card. Renders an image card where real imagery exists, and a
 * branded text-forward panel (no broken-image placeholder) where it doesn't —
 * surfacing the project value instead. Honest either way.
 */
export function PortfolioCard({ project }: { project: PortfolioItem }) {
  const href = `/portfolio/${project.slug}`;
  return (
    <Link
      href={href}
      className="group flex flex-col overflow-hidden rounded-xl border border-ad-border bg-white transition-colors hover:border-ad-accent/40"
    >
      {project.image ? (
        <div className="relative aspect-[3/2] overflow-hidden">
          <Image
            src={project.image}
            alt={project.imageAlt ?? project.name}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
          {project.isCaseStudy && (
            <span className="absolute left-3 top-3 rounded-full bg-ad-orange px-2.5 py-1 text-[0.7rem] font-semibold uppercase tracking-wide text-white">
              Case study
            </span>
          )}
        </div>
      ) : (
        <div className="relative flex aspect-[3/2] items-center justify-center bg-ad-navy">
          <div className="blueprint-grid absolute inset-0" />
          <div className="relative px-6 text-center">
            {project.value ? (
              <>
                <div className="font-heading text-3xl font-bold text-white">{project.value}</div>
                <div className="mt-1 text-xs uppercase tracking-wider text-ad-on-dark-muted">
                  project value
                </div>
              </>
            ) : (
              <div className="font-heading text-lg font-semibold text-white">{project.sector}</div>
            )}
          </div>
          {project.isCaseStudy && (
            <span className="absolute left-3 top-3 rounded-full bg-ad-orange px-2.5 py-1 text-[0.7rem] font-semibold uppercase tracking-wide text-white">
              Case study
            </span>
          )}
        </div>
      )}
      <div className="flex flex-1 flex-col p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium uppercase tracking-wider text-ad-accent">
            {project.sector}
          </span>
          {project.image && project.value && (
            <span className="font-heading text-sm font-bold text-ad-ink">{project.value}</span>
          )}
        </div>
        <h3 className="mt-2 font-heading text-lg font-semibold text-ad-ink group-hover:text-ad-accent">
          {project.name}
        </h3>
        <p className="mt-2 line-clamp-2 flex-1 text-sm leading-relaxed text-ad-muted">
          {project.blurb}
        </p>
        <span className="mt-4 text-sm text-ad-muted">{project.location}</span>
      </div>
    </Link>
  );
}
