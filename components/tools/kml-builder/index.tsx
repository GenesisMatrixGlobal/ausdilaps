"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { parseKmlCsv, SAMPLE_CSV, type CsvParseError } from "@/lib/kml/csv";
import { buildKml } from "@/lib/kml/build";
import type { KmlPathInput } from "@/lib/kml/types";
import { RoadSegmentsTab } from "./road-segments-tab";

interface Row {
  id: number;
  name: string;
  startLat: string;
  startLng: string;
  endLat: string;
  endLng: string;
}

let nextId = 1;
function emptyRow(): Row {
  return { id: nextId++, name: "", startLat: "", startLng: "", endLat: "", endLng: "" };
}

function rowError(row: Row): string | null {
  if (!row.name.trim()) return "Missing label";
  for (const [key, val] of [
    ["startLat", row.startLat],
    ["startLng", row.startLng],
    ["endLat", row.endLat],
    ["endLng", row.endLng],
  ] as const) {
    if (val.trim() === "" || Number.isNaN(Number(val))) return `"${key}" is not a number`;
  }
  const startLat = Number(row.startLat);
  const endLat = Number(row.endLat);
  const startLng = Number(row.startLng);
  const endLng = Number(row.endLng);
  if (Math.abs(startLat) > 90 || Math.abs(endLat) > 90) return "Latitude must be between -90 and 90";
  if (Math.abs(startLng) > 180 || Math.abs(endLng) > 180) return "Longitude must be between -180 and 180";
  return null;
}

function rowToPath(row: Row): KmlPathInput {
  return {
    name: row.name.trim(),
    coordinates: [
      { lat: Number(row.startLat), lng: Number(row.startLng) },
      { lat: Number(row.endLat), lng: Number(row.endLng) },
    ],
  };
}

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "paths"
  );
}

export function KmlBuilderTool() {
  const [mode, setMode] = useState<"straight-line" | "road-segments">("straight-line");
  const [documentName, setDocumentName] = useState("AusDilaps Survey Paths");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [csvErrors, setCsvErrors] = useState<CsvParseError[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function updateRow(id: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(id: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  }

  async function handleFile(file: File) {
    setError(null);
    const text = await file.text();
    const { paths, errors } = parseKmlCsv(text);
    setCsvErrors(errors);
    if (paths.length > 0) {
      const parsedRows = paths.map((p) => ({
        id: nextId++,
        name: p.name,
        startLat: String(p.coordinates[0].lat),
        startLng: String(p.coordinates[0].lng),
        endLat: String(p.coordinates[1].lat),
        endLng: String(p.coordinates[1].lng),
      }));
      setRows((prev) => {
        const blank = prev.filter((r) => rowError(r) !== null && !r.name && !r.startLat);
        const kept = prev.filter((r) => !blank.includes(r));
        return [...kept, ...parsedRows];
      });
    }
  }

  function downloadSampleCsv() {
    downloadBlob(SAMPLE_CSV, "sample-paths.csv", "text/csv");
  }

  const rowIssues = rows.map((r) => rowError(r));
  const readyPaths = rows.filter((_, i) => rowIssues[i] === null);
  const needAttention = rows.length - readyPaths.length;

  async function generate() {
    setError(null);
    setCopied(false);
    const paths = readyPaths.map(rowToPath);
    if (paths.length === 0) {
      setError("Add at least one valid path first.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/kml", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentName, paths }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(json?.error ?? "Something went wrong generating the KML.");
        return;
      }
      const kml = await res.text();
      downloadBlob(kml, `${slugify(documentName)}.kml`, "application/vnd.google-earth.kml+xml");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function copyKml() {
    const paths = readyPaths.map(rowToPath);
    if (paths.length === 0) {
      setError("Add at least one valid path first.");
      return;
    }
    await navigator.clipboard.writeText(buildKml(paths, documentName));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>

      <div className="mt-6 flex gap-2 border-b border-ad-border">
        {(
          [
            { key: "straight-line", label: "Straight line (lat/lng)" },
            { key: "road-segments", label: "Road segments (trace real roads)" },
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

      {mode === "road-segments" && <RoadSegmentsTab />}

      {mode === "straight-line" && (
      <>
      {/* Document name + CSV upload */}
      <div className="mt-8 rounded-xl border border-ad-border bg-white p-5">
        <label className="block text-sm font-medium text-ad-ink">
          Document name
          <input
            value={documentName}
            onChange={(e) => setDocumentName(e.target.value)}
            className="mt-1 w-full max-w-sm rounded-lg border border-ad-border p-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
          />
        </label>

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
            if (f) void handleFile(f);
          }}
          className={cn(
            "mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
            dragActive ? "border-ad-orange bg-ad-orange/10" : "border-ad-border hover:bg-ad-surface"
          )}
        >
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
          <p className="font-medium text-ad-ink">
            {dragActive ? "Drop the CSV here" : "Drag & drop a CSV here, or click to browse"}
          </p>
          <p className="text-sm text-ad-muted">
            Columns: name, start_lat, start_lng, end_lat, end_lng ·{" "}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                downloadSampleCsv();
              }}
              className="underline underline-offset-2 hover:text-ad-steel"
            >
              download a sample
            </button>
          </p>
        </div>

        {csvErrors.length > 0 && (
          <div className="mt-3 rounded-lg border border-ad-orange/40 bg-ad-orange/5 p-3 text-sm text-ad-ink">
            <p className="font-medium">{csvErrors.length} row(s) in the CSV couldn&apos;t be read:</p>
            <ul className="mt-1 list-disc pl-5 text-ad-muted">
              {csvErrors.slice(0, 10).map((e, i) => (
                <li key={i}>
                  Line {e.line}: {e.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Editable rows */}
      <div className="mt-6 overflow-x-auto rounded-xl border border-ad-border">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="bg-ad-surface text-left text-ad-muted">
              <th className="px-3 py-2 font-medium">Label</th>
              <th className="px-3 py-2 font-medium">Start Lat</th>
              <th className="px-3 py-2 font-medium">Start Lng</th>
              <th className="px-3 py-2 font-medium">End Lat</th>
              <th className="px-3 py-2 font-medium">End Lng</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const issue = rowIssues[i];
              const touched = row.name || row.startLat || row.startLng || row.endLat || row.endLng;
              return (
                <tr key={row.id} className="border-t border-ad-border align-top">
                  <td className="px-3 py-2">
                    <input
                      value={row.name}
                      onChange={(e) => updateRow(row.id, { name: e.target.value })}
                      placeholder="e.g. Site Access Road"
                      className="w-40 rounded-md border border-ad-border p-1.5 text-ad-ink outline-none focus:border-ad-steel"
                    />
                  </td>
                  {(["startLat", "startLng", "endLat", "endLng"] as const).map((field) => (
                    <td key={field} className="px-3 py-2">
                      <input
                        value={row[field]}
                        onChange={(e) => updateRow(row.id, { [field]: e.target.value })}
                        inputMode="decimal"
                        placeholder="0.000000"
                        className="w-28 rounded-md border border-ad-border p-1.5 text-ad-ink outline-none focus:border-ad-steel"
                      />
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      disabled={rows.length === 1}
                      className="text-ad-muted hover:text-ad-orange disabled:opacity-30"
                      aria-label="Remove row"
                    >
                      ✕
                    </button>
                    {touched && issue && <p className="mt-1 text-xs text-ad-orange">{issue}</p>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className={cn(buttonVariants({ variant: "outline", size: "sm" }))} onClick={addRow}>
          + Add row
        </button>
        <span className="text-sm text-ad-muted">
          <span className="font-semibold text-ad-ink">{readyPaths.length}</span> path(s) ready
          {needAttention > 0 && (
            <>
              {" · "}
              <span className="font-semibold text-ad-orange">{needAttention}</span> need attention
            </>
          )}
        </span>
      </div>

      {/* Generate */}
      <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-ad-border pt-6">
        <button
          className={cn(buttonVariants({ variant: "accent", size: "md" }), loading && "opacity-60")}
          onClick={generate}
          disabled={loading}
        >
          {loading ? "Generating…" : "Generate & download .kml"}
        </button>
        <button className={cn(buttonVariants({ variant: "outline", size: "md" }))} onClick={copyKml}>
          {copied ? "Copied!" : "Copy KML to clipboard"}
        </button>
        {error && <span className="text-sm text-ad-orange">{error}</span>}
      </div>
      </>
      )}
    </div>
  );
}
