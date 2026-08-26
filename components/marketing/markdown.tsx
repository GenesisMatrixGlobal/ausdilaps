import type { ReactNode } from "react";
import { createHeadingSlugger } from "@/lib/slug";

/**
 * Minimal, dependency-free Markdown renderer for the insights articles.
 * Supports the subset we author: h2/h3 headings, paragraphs, ordered and
 * unordered lists, bold and links. No build-time compilation, so it deploys
 * anywhere. (Replaces next-mdx-remote, which failed Vercel's build.)
 *
 * Headings carry an `id` from lib/slug.ts. That is not decoration: knowledge-base
 * citations deep-link to `#<slug>`, and lib/knowledge/chunk.ts derives a chunk's anchor
 * from the SAME function. Change the slug rule in one place or links break silently.
 */
export function Markdown({ source }: { source: string }) {
  return <>{renderBlocks(source)}</>;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /(\*\*([^*]+)\*\*)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1]) {
      nodes.push(
        <strong key={key++} className="font-semibold text-ad-ink">
          {m[2]}
        </strong>
      );
    } else if (m[3]) {
      const external = /^https?:\/\//.test(m[5]);
      nodes.push(
        <a
          key={key++}
          href={m[5]}
          className="font-medium text-ad-accent underline hover:brightness-90"
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
          {m[4]}
        </a>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderBlocks(source: string): ReactNode[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: string[] = [];
  let listOrdered = false;
  let key = 0;
  // Per-document, so a repeated heading gets `-1` rather than a duplicate id. The chunker
  // runs the identical slugger over the identical heading sequence.
  const slug = createHeadingSlugger();

  const flushPara = () => {
    if (para.length) {
      blocks.push(
        <p key={key++} className="mt-5 leading-relaxed text-ad-muted">
          {renderInline(para.join(" "))}
        </p>
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      const items = list.map((li, i) => (
        <li key={i} className="leading-relaxed">
          {renderInline(li)}
        </li>
      ));
      blocks.push(
        listOrdered ? (
          <ol key={key++} className="mt-5 list-decimal space-y-2 pl-5 text-ad-muted">
            {items}
          </ol>
        ) : (
          <ul key={key++} className="mt-5 list-disc space-y-2 pl-5 text-ad-muted marker:text-ad-accent">
            {items}
          </ul>
        )
      );
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const ul = /^[-*]\s+(.*)$/.exec(line);
    const ol = /^\d+\.\s+(.*)$/.exec(line);

    if (h) {
      flushPara();
      flushList();
      const level = h[1].length;
      const text = renderInline(h[2]);
      const id = slug(h[2]);
      // scroll-mt keeps the target clear of the sticky header when a citation jumps here.
      if (level === 1) {
        blocks.push(
          <h2 key={key++} id={id} className="mt-12 scroll-mt-24 font-heading text-3xl font-semibold tracking-tight text-ad-ink">
            {text}
          </h2>
        );
      } else if (level === 2) {
        blocks.push(
          <h2 key={key++} id={id} className="mt-12 scroll-mt-24 font-heading text-2xl font-semibold tracking-tight text-ad-ink">
            {text}
          </h2>
        );
      } else {
        blocks.push(
          <h3 key={key++} id={id} className="mt-8 scroll-mt-24 font-heading text-xl font-semibold text-ad-ink">
            {text}
          </h3>
        );
      }
    } else if (ul) {
      flushPara();
      if (listOrdered) flushList();
      listOrdered = false;
      list.push(ul[1]);
    } else if (ol) {
      flushPara();
      if (!listOrdered) flushList();
      listOrdered = true;
      list.push(ol[1]);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}
