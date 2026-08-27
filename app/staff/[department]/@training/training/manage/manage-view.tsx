"use client";

import { useRef, useState, useTransition } from "react";
import { Pill } from "@/components/staff/pill";
import { EmptyState } from "@/components/staff/empty-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ACCEPTED_EXTENSIONS } from "@/lib/knowledge/formats";
import type { KnowledgeSource } from "@/lib/knowledge/ingest";
import type { DepartmentSlug } from "@/lib/departments";
import {
  addKnowledge,
  reindexKnowledge,
  removeKnowledge,
  updateContextAndSignal,
  setKnowledgePublished,
  knowledgeDownloadUrl,
  type ActionResult,
} from "./actions";

/**
 * One question: is this a video?
 *
 * There were three modes. "Paste a note" was the third, and it was only ever "upload a
 * file" with the file input removed — that form already had a paste box under it. Whether
 * the content arrived as a file or a paste is something the server can see for itself, so
 * it derives document vs note rather than asking.
 *
 * Video stays separate because it genuinely needs different things: a link for the
 * citation to open, and a transcript with timestamps as its searchable content.
 */
const MODES = [
  { mode: "content", label: "Document or note", blurb: "Upload a file, or paste the text." },
  { mode: "video", label: "Video", blurb: "A link plus its transcript." },
] as const;

type Mode = (typeof MODES)[number]["mode"];

function statusOf(s: KnowledgeSource): { tone: "ok" | "warn" | "muted"; label: string } {
  if (s.index_error) return { tone: "warn", label: "Failed" };
  if (!s.indexed_at) return { tone: "muted", label: "Indexing…" };
  if (!s.is_published) return { tone: "muted", label: "Draft" };
  return { tone: "ok", label: "Live" };
}

export function ManageView({
  department,
  departmentLabel,
  sources,
  assignable,
  canPublishCompanyWide,
}: {
  department: DepartmentSlug;
  departmentLabel: string;
  sources: KnowledgeSource[];
  assignable: { slug: DepartmentSlug; label: string }[];
  canPublishCompanyWide: boolean;
}) {
  const [mode, setMode] = useState<Mode>("content");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const run = (fn: (fd: FormData) => Promise<ActionResult>, fd: FormData, onDone?: () => void) => {
    fd.set("department", department);
    startTransition(async () => {
      setResult(await fn(fd));
      setBusyId(null);
      onDone?.();
    });
  };

  const rowAction = (fn: (fd: FormData) => Promise<ActionResult>, id: string, extra?: Record<string, string>) => {
    const fd = new FormData();
    fd.set("id", id);
    for (const [k, v] of Object.entries(extra ?? {})) fd.set(k, v);
    setBusyId(id);
    run(fn, fd);
  };

  async function download(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("department", department);
    setBusyId(id);
    const res = await knowledgeDownloadUrl(fd);
    setBusyId(null);
    if (res.ok) window.open(res.url, "_blank", "noopener");
    else setResult({ ok: false, error: res.error });
  }

  return (
    <div className="mt-8 space-y-8">
      {result && (
        <div
          className={cn(
            "rounded-xl border px-4 py-3 text-sm",
            result.ok
              ? "border-ad-steel/30 bg-ad-steel/5 text-ad-ink"
              : "border-ad-amber-line bg-ad-amber-tint text-ad-ink"
          )}
          role="status"
        >
          {result.ok ? result.message : result.error}
        </div>
      )}

      {/* ── Add ──────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-ad-border bg-white">
        <div className="flex flex-wrap gap-2 border-b border-ad-border p-4">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              onClick={() => {
                setMode(m.mode);
                setResult(null);
              }}
              className={cn(
                "rounded-lg border px-3 py-2 text-left transition-colors",
                mode === m.mode
                  ? "border-ad-steel bg-ad-steel/5"
                  : "border-ad-border hover:border-ad-steel/50"
              )}
            >
              <span className="block text-sm font-medium text-ad-ink">{m.label}</span>
              <span className="block text-xs text-ad-muted">{m.blurb}</span>
            </button>
          ))}
        </div>

        <form
          ref={formRef}
          className="space-y-4 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set("mode", mode);
            run(addKnowledge, fd, () => formRef.current?.reset());
          }}
        >
          <Field label="Title" hint="What people will see credited under an answer.">
            <input name="title" required className={INPUT} placeholder="Estimator induction" />
          </Field>

          <Field label="Summary" hint="Optional — one line.">
            <input name="summary" className={INPUT} placeholder="How a new estimator gets set up." />
          </Field>

          <fieldset className="rounded-lg border border-ad-border bg-ad-surface/40 p-4">
            <legend className="px-1 text-sm font-medium text-ad-ink">Context</legend>
            <p className="text-xs leading-relaxed text-ad-muted">
              The part a document never says about itself. People search for situations
              (&ldquo;client wants a locked copy&rdquo;) far more than for topics, and that
              only exists in your head until you write it here. Rough notes are fine.
              <span className="mt-1 block">
                Talking is faster than typing — press <strong>fn fn</strong> on a Mac, or{" "}
                <strong>Win + H</strong> on Windows, and dictate into any box below.
              </span>
            </p>

            <div className="mt-3 space-y-3">
              <Field label="What does this cover?">
                <textarea
                  name="context_covers"
                  rows={2}
                  className={INPUT}
                  placeholder="Watermarking a survey as draft and password-protecting the PDF."
                />
              </Field>
              <Field label="When would someone need it?">
                <textarea
                  name="context_when"
                  rows={2}
                  className={INPUT}
                  placeholder="A client asks for a copy of a survey before it's finalised, and it can't be edited or passed on."
                />
              </Field>
              <Field label="What do we call it internally?">
                <textarea
                  name="context_called"
                  rows={2}
                  className={INPUT}
                  placeholder="draft issue, locked survey, watermarked copy"
                />
              </Field>
            </div>
          </fieldset>

          {mode === "video" && (
            <Field label="Video link" hint="Loom, YouTube or SharePoint. Citations open this at the right timestamp.">
              <input name="url" type="url" required className={INPUT} placeholder="https://www.loom.com/share/…" />
            </Field>
          )}

          <Field
            label={mode === "video" ? "Transcript file" : "File"}
            hint={
              mode === "video"
                ? "A .vtt or .srt keeps the timestamps, so answers link to the exact moment. Or paste it below."
                : `Accepted: ${ACCEPTED_EXTENSIONS.join(", ")}. Scanned PDFs won't work — paste the text instead.`
            }
          >
            <input
              name="file"
              type="file"
              accept={ACCEPTED_EXTENSIONS.join(",")}
              className="block w-full text-sm text-ad-muted file:mr-3 file:rounded-lg file:border-0 file:bg-ad-surface file:px-3 file:py-2 file:text-sm file:font-medium file:text-ad-ink hover:file:bg-ad-border/40"
            />
          </Field>

          <Field
            label="Or paste the text"
            hint={
              mode === "video"
                ? undefined
                : "Markdown headings help — they become jump links in answers."
            }
          >
            <textarea
              name="text"
              rows={6}
              className={cn(INPUT, "font-mono text-xs leading-relaxed")}
              placeholder={mode === "video" ? "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nRing the subject lot first." : ""}
            />
          </Field>

          <fieldset>
            <legend className="text-sm font-medium text-ad-ink">Who can be answered from this</legend>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {assignable.map((d) => (
                <label key={d.slug} className="flex items-center gap-2 text-sm text-ad-muted">
                  <input
                    type="checkbox"
                    name="departments"
                    value={d.slug}
                    defaultChecked={d.slug === department}
                    className="size-4 rounded border-ad-border accent-ad-steel"
                  />
                  {d.label}
                </label>
              ))}
            </div>
            {canPublishCompanyWide && (
              <label className="mt-3 flex items-start gap-2 text-sm text-ad-muted">
                <input type="checkbox" name="company_wide" className="mt-0.5 size-4 rounded border-ad-border accent-ad-steel" />
                <span>
                  <span className="font-medium text-ad-ink">Company-wide</span> — everyone, whichever
                  department. Overrides the boxes above. Admins only.
                </span>
              </label>
            )}
          </fieldset>

          <label className="flex items-start gap-2 text-sm text-ad-muted">
            <input type="checkbox" name="publish" defaultChecked className="mt-0.5 size-4 rounded border-ad-border accent-ad-steel" />
            <span>
              <span className="font-medium text-ad-ink">Publish straight away.</span> Untick to save it as
              a draft — drafts are never used in answers.
            </span>
          </label>

          <Button type="submit" variant="accent" disabled={pending}>
            {pending ? "Saving…" : "Save and index"}
          </Button>
        </form>
      </section>

      {/* ── Existing ─────────────────────────────────────────────────── */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-ad-ink">
          In the knowledge base · {sources.length}
        </h3>

        {sources.length === 0 ? (
          <EmptyState
            title="Nothing uploaded yet"
            body={`Once you add something here, ${departmentLabel} can find it from the search bar on the Training tab.`}
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-ad-border bg-white">
            {sources.map((s) => {
              const status = statusOf(s);
              const busy = busyId === s.id && pending;
              return (
                <div key={s.id} className="border-b border-ad-border p-4 last:border-b-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-ad-ink">{s.title}</p>
                        <Pill tone={status.tone}>{status.label}</Pill>
                        <Pill tone="muted">{s.kind}</Pill>
                      </div>
                      {s.summary && <p className="mt-1 text-sm text-ad-muted">{s.summary}</p>}
                      <p className="mt-1.5 text-xs text-ad-muted">
                        {s.departments.length === 0 ? "Company-wide" : s.departments.join(", ")}
                        {" · "}
                        {s.indexed_at ? `${s.chunk_count} chunk${s.chunk_count === 1 ? "" : "s"}` : "not indexed"}
                        {s.url && (
                          <>
                            {" · "}
                            <a
                              href={s.url}
                              // Training modules link to their own page in this app; only a
                              // video kind actually points somewhere external.
                              {...(s.kind === "video"
                                ? { target: "_blank", rel: "noopener noreferrer" }
                                : {})}
                              className="text-ad-steel hover:underline"
                            >
                              {s.kind === "video" ? "watch ↗" : "open"}
                            </a>
                          </>
                        )}
                      </p>
                      {s.index_error && (
                        <p className="mt-1.5 text-xs text-ad-amber">Indexing failed — {s.index_error}</p>
                      )}

                      <IndexSignal source={s} onSave={(fd) => run(updateContextAndSignal, fd)} busy={busy} />
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                      {s.storage_path && (
                        <SmallButton onClick={() => download(s.id)} disabled={busy}>
                          Original
                        </SmallButton>
                      )}
                      <SmallButton onClick={() => rowAction(reindexKnowledge, s.id)} disabled={busy}>
                        Re-index
                      </SmallButton>
                      <SmallButton
                        onClick={() =>
                          rowAction(setKnowledgePublished, s.id, { publish: String(!s.is_published) })
                        }
                        disabled={busy}
                      >
                        {s.is_published ? "Unpublish" : "Publish"}
                      </SmallButton>
                      <SmallButton
                        tone="danger"
                        disabled={busy}
                        onClick={() => {
                          if (confirm(`Delete "${s.title}"? Its chunks go too — this can't be undone.`)) {
                            rowAction(removeKnowledge, s.id);
                          }
                        }}
                      >
                        Delete
                      </SmallButton>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

const INPUT =
  "mt-1 w-full rounded-lg border border-ad-border bg-white px-3 py-2 text-sm text-ad-ink placeholder:text-ad-muted/60 focus:border-ad-steel focus:outline-none focus:ring-1 focus:ring-ad-steel";

/** What the model wrote about a source, and the chance to correct it.
 *
 *  Worth showing rather than hiding: this is what decides whether the document turns
 *  up in a search, and a wrong reading is invisible from the outside — the document
 *  just quietly stops being found. The person who uploaded it is the only one who
 *  would notice. Saving marks it hand-edited so a re-index leaves it alone; clearing
 *  it hands the document back to the model. */
function IndexSignal({
  source,
  onSave,
  busy,
}: {
  source: KnowledgeSource;
  onSave: (fd: FormData) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);

  const hasSignal = !!(source.ai_summary || source.ai_keywords);
  const keywords = (source.ai_keywords ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  return (
    <div className="mt-2.5 rounded-lg border border-ad-border bg-ad-surface/40 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ad-muted">
          Context &amp; search summary {source.ai_summary_edited && "· edited"}
        </p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-medium text-ad-steel hover:underline"
        >
          {open ? "Cancel" : hasSignal ? "Edit" : "Add context"}
        </button>
      </div>

      {open ? (
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set("id", source.id);
            onSave(fd);
            setOpen(false);
          }}
        >
          <Field label="What does this cover?">
            <textarea name="context_covers" rows={2} defaultValue={source.context_covers ?? ""} className={INPUT} />
          </Field>
          <Field label="When would someone need it?">
            <textarea name="context_when" rows={2} defaultValue={source.context_when ?? ""} className={INPUT} />
          </Field>
          <Field label="What do we call it internally?">
            <textarea name="context_called" rows={2} defaultValue={source.context_called ?? ""} className={INPUT} />
          </Field>
          <Field label="Search summary" hint="Leave blank to let the model rewrite it on re-index.">
            <textarea name="ai_summary" rows={3} defaultValue={source.ai_summary ?? ""} className={INPUT} />
          </Field>
          <input
            name="ai_keywords"
            defaultValue={source.ai_keywords ?? ""}
            className={INPUT}
            placeholder="comma, separated, search phrases"
          />
          <SmallButton type="submit" disabled={busy}>
            Save
          </SmallButton>
        </form>
      ) : (
        <>
          <p className="mt-1 text-sm leading-relaxed text-ad-muted">
            {source.ai_summary ?? "No context yet — add it so this can be found by what it's for."}
          </p>
          {keywords.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {keywords.map((k) => (
                <span
                  key={k}
                  className="rounded bg-white px-1.5 py-0.5 text-[0.7rem] text-ad-muted ring-1 ring-ad-border"
                >
                  {k}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ad-ink">{label}</span>
      {hint && <span className="mt-0.5 block text-xs leading-relaxed text-ad-muted">{hint}</span>}
      {children}
    </label>
  );
}

function SmallButton({
  onClick,
  disabled,
  tone,
  type = "button",
  children,
}: {
  type?: "button" | "submit";
  onClick?: () => void;
  disabled?: boolean;
  tone?: "danger";
  children: React.ReactNode;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40",
        tone === "danger"
          ? "border-ad-border text-ad-muted hover:border-ad-amber hover:text-ad-amber"
          : "border-ad-border text-ad-ink hover:border-ad-steel hover:text-ad-steel"
      )}
    >
      {children}
    </button>
  );
}
