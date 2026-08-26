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
  setKnowledgePublished,
  knowledgeDownloadUrl,
  type ActionResult,
} from "./actions";

/**
 * Three modes rather than one form with conditional fields, because the three things
 * people actually upload need different inputs — and a video without a transcript is a
 * dead end the form should refuse up front rather than accept and index as nothing.
 */
const MODES = [
  { kind: "document", label: "Upload a file", blurb: "PDF, Markdown or plain text." },
  { kind: "video", label: "Add a video", blurb: "A link plus its transcript." },
  { kind: "note", label: "Paste a note", blurb: "Straight into the box." },
] as const;

type Mode = (typeof MODES)[number]["kind"];

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
  const [mode, setMode] = useState<Mode>("document");
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
              key={m.kind}
              type="button"
              onClick={() => {
                setMode(m.kind);
                setResult(null);
              }}
              className={cn(
                "rounded-lg border px-3 py-2 text-left transition-colors",
                mode === m.kind
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
            fd.set("kind", mode);
            run(addKnowledge, fd, () => formRef.current?.reset());
          }}
        >
          <Field label="Title" hint="What people will see credited under an answer.">
            <input name="title" required className={INPUT} placeholder="Estimator induction" />
          </Field>

          <Field label="Summary" hint="Optional — one line.">
            <input name="summary" className={INPUT} placeholder="How a new estimator gets set up." />
          </Field>

          {mode === "video" && (
            <Field label="Video link" hint="Loom, YouTube or SharePoint. Citations open this at the right timestamp.">
              <input name="url" type="url" required className={INPUT} placeholder="https://www.loom.com/share/…" />
            </Field>
          )}

          {mode !== "note" && (
            <Field
              label={mode === "video" ? "Transcript file" : "File"}
              hint={
                mode === "video"
                  ? `A .vtt or .srt keeps the timestamps, so answers can link to the exact moment. Or paste it below.`
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
          )}

          <Field
            label={mode === "note" ? "The note" : "Or paste the text"}
            hint={mode === "note" ? "Markdown headings help — they become jump links in answers." : undefined}
          >
            <textarea
              name="text"
              rows={mode === "note" ? 8 : 4}
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
            body={`Once you add something here, ${departmentLabel} can find it from the search bar at the top of the page.`}
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
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  tone?: "danger";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
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
