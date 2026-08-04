import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/marketing/container";
import { Eyebrow } from "@/components/marketing/eyebrow";
import { Breadcrumbs } from "@/components/marketing/breadcrumbs";
import { Markdown } from "@/components/marketing/markdown";
import { CtaBand } from "@/components/marketing/cta-band";
import { JsonLd } from "@/components/seo/json-ld";
import { getAllInsights, getInsight, getInsightSlugs, formatInsightDate } from "@/lib/insights";
import { articleSchema, breadcrumbSchema } from "@/lib/seo";

export function generateStaticParams() {
  return getInsightSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getInsight(slug);
  if (!post) return {};
  return {
    title: `${post.title} | AusDilaps Insights`,
    description: post.excerpt,
    alternates: { canonical: `/insights/${post.slug}` },
  };
}

export default async function InsightPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getInsight(slug);
  if (!post) notFound();

  const path = `/insights/${post.slug}`;
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Insights", path: "/insights" },
    { name: post.title, path },
  ];
  const related = getAllInsights()
    .filter((i) => i.category === post.category && i.slug !== post.slug)
    .slice(0, 2);

  return (
    <>
      <JsonLd
        data={[
          articleSchema({
            headline: post.title,
            description: post.excerpt,
            path,
            datePublished: post.date,
            author: post.author === "AusDilaps" ? undefined : post.author,
            image: post.image,
          }),
          breadcrumbSchema(crumbs),
        ]}
      />

      <article>
        <header className="border-b border-ad-border py-12 lg:py-16">
          <Container className="max-w-3xl">
            <Breadcrumbs crumbs={crumbs} />
            <Eyebrow className="mt-6 text-ad-accent">{post.category}</Eyebrow>
            <h1 className="mt-5 text-balance font-heading text-4xl font-semibold leading-[1.1] tracking-tight text-ad-ink sm:text-5xl">
              {post.title}
            </h1>
            <p className="mt-5 text-sm text-ad-muted">
              {formatInsightDate(post.date)} · {post.author}
            </p>
          </Container>
        </header>

        <div className="py-12 lg:py-16">
          <Container className="max-w-3xl">
            <div className="text-[1.05rem]">
              <Markdown source={post.content} />
            </div>

            <div className="rule-hairline my-12" />
            <Link href="/insights" className="text-sm font-medium text-ad-accent hover:brightness-90">
              ← All insights
            </Link>
          </Container>
        </div>
      </article>

      {related.length > 0 && (
        <section className="bg-ad-surface py-16 lg:py-20">
          <Container className="max-w-3xl">
            <Eyebrow className="text-ad-accent">More on this</Eyebrow>
            <div className="mt-6 space-y-4">
              {related.map((r) => (
                <Link
                  key={r.slug}
                  href={`/insights/${r.slug}`}
                  className="group flex flex-col rounded-xl border border-ad-border bg-white p-6 transition-colors hover:border-ad-accent/40"
                >
                  <span className="text-xs font-medium uppercase tracking-wider text-ad-accent">
                    {r.category}
                  </span>
                  <span className="mt-2 font-heading text-base font-semibold text-ad-ink group-hover:text-ad-accent">
                    {r.title}
                  </span>
                </Link>
              ))}
            </div>
          </Container>
        </section>
      )}

      <CtaBand
        heading="Need a dilapidation report scoped?"
        subhead="Tell us the project, location and adjoining properties — we'll scope it."
        secondary={false}
        size="md"
      />
    </>
  );
}
