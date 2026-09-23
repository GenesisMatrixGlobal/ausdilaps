import { renderInline } from "./markdown";
import type { TermsClause, TermsItem, TermsSection } from "@/data/terms";

/**
 * Numbered legal clauses with hanging numbers — 4.5, then (a), then (1). The Markdown
 * renderer only does single-level bullet lists, which can't carry clause numbering.
 * Each section gets an id (#clause-13) so a quote or email can link straight to it.
 */
export function LegalClauses({ sections }: { sections: TermsSection[] }) {
  return (
    <>
      {sections.map((s) => (
        <section key={s.number} id={`clause-${s.number}`} className="mt-12 scroll-mt-24">
          <h2 className="font-heading text-2xl font-semibold tracking-tight text-ad-ink">
            {s.number}. {s.title}
          </h2>
          <div className="rule-accent mt-3 w-12" />
          <div className="mt-6 space-y-5">
            {s.clauses.map((c, i) => (
              <Clause key={c.number ?? i} clause={c} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function Clause({ clause }: { clause: TermsClause }) {
  const body = (
    <div>
      {clause.text && <p className="leading-relaxed text-ad-muted">{renderInline(clause.text)}</p>}
      {clause.items && <Items items={clause.items} />}
      {clause.after && <p className="mt-3 leading-relaxed text-ad-muted">{renderInline(clause.after)}</p>}
    </div>
  );
  if (!clause.number) return body;
  return (
    <div className="grid grid-cols-[3.25rem_1fr] gap-x-2">
      <span className="font-medium leading-relaxed text-ad-ink">{clause.number}</span>
      {body}
    </div>
  );
}

function Items({ items }: { items: TermsItem[] }) {
  return (
    <ol className="mt-3 list-none space-y-2.5">
      {items.map((it) => (
        <li key={it.label} className="grid grid-cols-[2.25rem_1fr] gap-x-1">
          <span className="leading-relaxed text-ad-muted">{it.label}</span>
          <div>
            <p className="leading-relaxed text-ad-muted">{renderInline(it.text)}</p>
            {it.items && <Items items={it.items} />}
          </div>
        </li>
      ))}
    </ol>
  );
}
