"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import type { SizingResult } from "@/lib/property-sizing/types";
import { SitePlanTab } from "./site-plan-tab";

type Mode = "text" | "image" | "site-plan";

async function fileToBase64(file: File): Promise<{ data: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string; // data:<mime>;base64,<data>
      const comma = result.indexOf(",");
      const meta = result.slice(0, comma);
      const data = result.slice(comma + 1);
      const mediaType = meta.match(/data:(.*?);/)?.[1] ?? file.type ?? "image/png";
      resolve({ data, mediaType });
    };
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

function tsv(rows: string[][]): string {
  return rows.map((r) => r.join("\t")).join("\n");
}

const fmtArea = (n: number | null) => (n == null ? "" : n.toLocaleString("en-AU"));

export default function PropertySizingPage() {
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SizingResult[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function chooseFile(f: File | null) {
    setError(null);
    setFile(f);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return f ? URL.createObjectURL(f) : null;
    });
  }

  // Paste an image straight from the clipboard (Ctrl/Cmd+V) anywhere on the page.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const img = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      if (img) {
        const f = img.getAsFile();
        if (f) {
          setMode("image");
          chooseFile(f);
        }
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  async function run() {
    setLoading(true);
    setError(null);
    setResults(null);
    setCopied(null);
    try {
      let body: Record<string, unknown>;
      if (mode === "image") {
        if (!file) {
          setError("Drop or choose a screenshot first.");
          return;
        }
        body = { image: await fileToBase64(file) };
      } else {
        if (!text.trim()) {
          setError("Paste at least one address.");
          return;
        }
        body = { text };
      }
      const res = await fetch("/api/property-sizing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; results?: SizingResult[] };
      if (!json.ok) {
        setError(json.error ?? "Something went wrong.");
        return;
      }
      setResults(json.results ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function copy(what: "full" | "three") {
    if (!results) return;
    const rows =
      what === "three"
        ? [["Street", "Suburb", "Lot Size (m2)"], ...results.map((r) => [r.street, r.suburb, fmtArea(r.lotSizeSqm)])]
        : [
            ["Ref", "Street", "Suburb", "Matched address", "Lot Size (m2)", "Lot/Plan", "Levels", "Levels conf %", "Dwelling Area (m2)", "Dwelling conf %", "Notes"],
            ...results.map((r) => [
              r.id ?? "",
              r.street,
              r.suburb,
              r.matchedAddress ?? "",
              fmtArea(r.lotSizeSqm),
              r.lotPlan ?? "",
              r.levels == null ? "" : String(r.levels),
              r.levelsConfidence == null ? "" : String(r.levelsConfidence),
              fmtArea(r.dwellingAreaSqm),
              r.dwellingAreaConfidence == null ? "" : String(r.dwellingAreaConfidence),
              r.flags.join("; "),
            ]),
          ];
    await navigator.clipboard.writeText(tsv(rows));
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  }

  const resolved = results?.filter((r) => r.status === "ok").length ?? 0;
  const needManual = results ? results.length - resolved : 0;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <p className="text-xs uppercase tracking-[0.15em] text-ad-steel">AusDilaps · Estimating</p>
      <h1 className="mt-1 text-3xl font-semibold text-ad-ink">Property Sizing Tool</h1>
      <p className="mt-2 max-w-2xl text-ad-muted">
        Paste a list of addresses or drop in a screenshot. The tool returns the land/lot size for each
        property from free government cadastre data, ready to copy into your quoting sheet.
      </p>
      <p className="mt-2 text-sm text-ad-muted">
        <span className="font-medium text-ad-ink">Live:</span> QLD, NSW &amp; VIC lot size.{" "}
        <span className="font-medium text-ad-ink">Coming:</span> other states, plus estimated levels and
        dwelling area with confidence scores.
      </p>

      {/* Mode tabs */}
      <div className="mt-6 flex gap-2 border-b border-ad-border">
        {(
          [
            { key: "text", label: "Paste addresses" },
            { key: "image", label: "Upload screenshot" },
            { key: "site-plan", label: "Measure a site plan" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setMode(tab.key)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              mode === tab.key
                ? "border-ad-orange text-ad-ink"
                : "border-transparent text-ad-muted hover:text-ad-ink"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mode === "site-plan" && <SitePlanTab />}

      {mode !== "site-plan" && (
      <>
      {/* Input */}
      <div className="mt-8 rounded-xl border border-ad-border bg-white p-5">
        {mode === "text" ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder={"One address per line, e.g.\n8 Ironwood Ct, Mountain Creek QLD 4557\n15 Carib Ct, Mountain Creek QLD 4557"}
            className="w-full resize-y rounded-lg border border-ad-border p-3 font-mono text-sm text-ad-ink outline-none focus:border-ad-steel"
          />
        ) : (
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragActive(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              const f = e.dataTransfer.files?.[0];
              if (f && f.type.startsWith("image/")) chooseFile(f);
              else setError("That doesn't look like an image file.");
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors",
              dragActive ? "border-ad-orange bg-ad-orange/10" : "border-ad-border hover:bg-ad-surface"
            )}
          >
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
            />
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="screenshot preview" className="max-h-56 rounded-md border border-ad-border" />
            ) : (
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-ad-steel"
                aria-hidden
              >
                <path d="M12 16V4m0 0L7 9m5-5l5 5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            <p className="font-medium text-ad-ink">
              {file ? file.name : dragActive ? "Drop it here" : "Drag & drop your screenshot here"}
            </p>
            <p className="text-sm text-ad-muted">
              {file ? "Click to choose a different image" : "or click to browse · you can also paste with Ctrl+V"}
            </p>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            className={cn(buttonVariants({ variant: "accent", size: "md" }), loading && "opacity-60")}
            onClick={run}
            disabled={loading}
          >
            {loading ? "Looking up…" : "Look up lot sizes"}
          </button>
          {error && <span className="text-sm text-ad-orange">{error}</span>}
        </div>
      </div>

      {/* Results */}
      {results && (
        <div className="mt-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ad-muted">
              <span className="font-semibold text-ad-ink">{resolved}</span> resolved
              {needManual > 0 && (
                <>
                  {" · "}
                  <span className="font-semibold text-ad-orange">{needManual}</span> need a manual check
                </>
              )}{" "}
              of {results.length}
            </p>
            <div className="flex gap-2">
              <button
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                onClick={() => copy("three")}
              >
                {copied === "three" ? "Copied!" : "Copy Street/Suburb/Lot"}
              </button>
              <button
                className={cn(buttonVariants({ variant: "primary", size: "sm" }))}
                onClick={() => copy("full")}
              >
                {copied === "full" ? "Copied!" : "Copy all columns"}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-ad-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-ad-surface text-left text-ad-muted">
                  <th className="px-3 py-2 font-medium">Ref</th>
                  <th className="px-3 py-2 font-medium">Street</th>
                  <th className="px-3 py-2 font-medium">Suburb</th>
                  <th className="px-3 py-2 font-medium">Matched (gov data)</th>
                  <th className="px-3 py-2 text-right font-medium">Lot Size (m²)</th>
                  <th className="px-3 py-2 font-medium">Lot/Plan</th>
                  <th className="px-3 py-2 text-right font-medium">Match</th>
                  <th className="px-3 py-2 text-right font-medium">Levels</th>
                  <th className="px-3 py-2 text-right font-medium">Dwelling (m²)</th>
                  <th className="px-3 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr
                    key={i}
                    className={cn("border-t border-ad-border", r.status !== "ok" && "bg-ad-orange/5")}
                  >
                    <td className="px-3 py-2 text-ad-muted">{r.id ?? ""}</td>
                    <td className="px-3 py-2 text-ad-ink">{r.street}</td>
                    <td className="px-3 py-2 text-ad-ink">{r.suburb}</td>
                    <td className="px-3 py-2 text-xs text-ad-muted">{r.matchedAddress ?? ""}</td>
                    <td className="px-3 py-2 text-right font-semibold text-ad-ink">
                      {r.lotSizeSqm == null ? "—" : fmtArea(r.lotSizeSqm)}
                    </td>
                    <td className="px-3 py-2 text-ad-muted">{r.lotPlan ?? ""}</td>
                    <td className="px-3 py-2 text-right text-ad-muted">
                      {r.matchScore == null ? "" : `${Math.round(r.matchScore)}%`}
                    </td>
                    <td className="px-3 py-2 text-right text-ad-muted">
                      {r.levels ?? "—"}
                      {r.levelsConfidence != null && (
                        <span className="ml-1 text-xs text-ad-muted">{r.levelsConfidence}%</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-ad-muted">
                      {r.dwellingAreaSqm == null ? "—" : fmtArea(r.dwellingAreaSqm)}
                      {r.dwellingAreaConfidence != null && (
                        <span className="ml-1 text-xs text-ad-muted">{r.dwellingAreaConfidence}%</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-ad-muted">{r.flags.join("; ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-ad-muted">
            Check the <span className="font-medium">Matched (gov data)</span> column — if it doesn&apos;t
            match your intended address, the screenshot was mis-read (try a clearer image or the paste-text
            tab). Levels &amp; dwelling area are estimates — footprint + LiDAR roof height where council
            data covers it, else a lot-coverage estimate; the % is confidence, and low-confidence rows
            should be verified in CoreLogic.
          </p>
        </div>
      )}
      </>
      )}
    </main>
  );
}
