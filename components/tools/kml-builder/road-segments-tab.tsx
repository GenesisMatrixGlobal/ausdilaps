"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { buildKml } from "@/lib/kml/build";
import type { KmlPathInput } from "@/lib/kml/types";
import type { RoadSegmentInput, RoadTraceResult, MapsLinkResult } from "@/lib/kml/road-segments/types";

interface Row {
  id: number;
  zone: string;
  location: string;
  roadNo: string;
  roadName: string;
  fromDesc: string;
  toDesc: string;
  footpathLengthKm: string;
}

let nextId = 1;
function emptyRow(): Row {
  return { id: nextId++, zone: "", location: "", roadNo: "", roadName: "", fromDesc: "", toDesc: "", footpathLengthKm: "" };
}

function rowIssue(row: Row): string | null {
  if (!row.location.trim()) return "Missing location/suburb";
  if (!row.roadName.trim()) return "Missing road name";
  if (!row.fromDesc.trim()) return "Missing from-description";
  if (!row.toDesc.trim()) return "Missing to-description";
  return null;
}

function rowToInput(row: Row): RoadSegmentInput {
  const km = row.footpathLengthKm.trim();
  const parsed = km === "" || km.toUpperCase() === "N/A" ? null : Number(km);
  return {
    id: String(row.id),
    zone: row.zone.trim() || undefined,
    location: row.location.trim(),
    roadNo: row.roadNo.trim() || undefined,
    roadName: row.roadName.trim(),
    fromDesc: row.fromDesc.trim(),
    toDesc: row.toDesc.trim(),
    footpathLengthKm: parsed != null && !Number.isNaN(parsed) ? parsed : null,
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
      .replace(/(^-|-$)/g, "") || "road-paths"
  );
}

async function fileToBase64(file: File): Promise<{ data: string; mediaType: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const [prefix, data] = dataUrl.split(",", 2);
  const mediaType = prefix.match(/data:(.*);base64/)?.[1] ?? file.type ?? "image/png";
  return { data, mediaType };
}

const STATUS_LABEL: Record<RoadTraceResult["status"], string> = {
  ok: "Traced",
  geocode_failed: "Couldn't locate",
  route_failed: "Couldn't trace",
  error: "Error",
};

const MAPS_STATUS_LABEL: Record<MapsLinkResult["status"], string> = {
  ok: "Found",
  not_found: "Couldn't locate",
  error: "Error",
};

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function RoadSegmentsTab() {
  const [documentName, setDocumentName] = useState("AusDilaps Road Paths");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [results, setResults] = useState<Record<number, RoadTraceResult>>({});
  const [mapsResults, setMapsResults] = useState<Record<number, MapsLinkResult>>({});
  const [dragActive, setDragActive] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [tracing, setTracing] = useState(false);
  const [findingLinks, setFindingLinks] = useState(false);
  const [linksCopied, setLinksCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  async function handleImage(file: File) {
    setError(null);
    setExtracting(true);
    try {
      const image = await fileToBase64(file);
      const res = await fetch("/api/kml/road-segments/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image }),
      });
      const json = (await res.json()) as { ok: boolean; segments?: RoadSegmentInput[]; error?: string };
      if (!res.ok || !json.ok || !json.segments) {
        setError(json.error ?? "Couldn't read that screenshot.");
        return;
      }
      const newRows: Row[] = json.segments.map((s) => ({
        id: nextId++,
        zone: s.zone ?? "",
        location: s.location,
        roadNo: s.roadNo ?? "",
        roadName: s.roadName,
        fromDesc: s.fromDesc,
        toDesc: s.toDesc,
        footpathLengthKm: s.footpathLengthKm != null ? String(s.footpathLengthKm) : "",
      }));
      setRows((prev) => {
        const blank = prev.filter((r) => rowIssue(r) !== null && !r.roadName && !r.location);
        const kept = prev.filter((r) => !blank.includes(r));
        return [...kept, ...newRows];
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExtracting(false);
    }
  }

  const rowIssues = rows.map(rowIssue);
  const readyRows = rows.filter((_, i) => rowIssues[i] === null);

  async function traceRoads() {
    setError(null);
    if (readyRows.length === 0) {
      setError("Add at least one complete row first.");
      return;
    }
    setTracing(true);
    try {
      const res = await fetch("/api/kml/road-segments/trace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ segments: readyRows.map(rowToInput) }),
      });
      const json = (await res.json()) as { ok: boolean; results?: RoadTraceResult[]; error?: string };
      if (!res.ok || !json.ok || !json.results) {
        setError(json.error ?? "Something went wrong tracing those roads.");
        return;
      }
      const byId: Record<number, RoadTraceResult> = {};
      readyRows.forEach((row, i) => {
        byId[row.id] = json.results![i];
      });
      setResults(byId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTracing(false);
    }
  }

  async function findMapsLinks() {
    setError(null);
    if (readyRows.length === 0) {
      setError("Add at least one complete row first.");
      return;
    }
    setFindingLinks(true);
    try {
      const res = await fetch("/api/kml/road-segments/maps-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ segments: readyRows.map(rowToInput) }),
      });
      const json = (await res.json()) as { ok: boolean; results?: MapsLinkResult[]; error?: string };
      if (!res.ok || !json.ok || !json.results) {
        setError(json.error ?? "Something went wrong finding Google Maps links.");
        return;
      }
      const byId: Record<number, MapsLinkResult> = {};
      readyRows.forEach((row, i) => {
        byId[row.id] = json.results![i];
      });
      setMapsResults(byId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFindingLinks(false);
    }
  }

  const linkedRows = rows.filter((r) => mapsResults[r.id]?.status === "ok" && mapsResults[r.id]?.mapsUrl);

  function copyAllLinks() {
    setError(null);
    if (linkedRows.length === 0) {
      setError("Find Google Maps links first.");
      return;
    }
    const text = linkedRows
      .map((row) => `${row.roadName}: ${row.fromDesc} to ${row.toDesc} — ${mapsResults[row.id].mapsUrl}`)
      .join("\n");
    void navigator.clipboard.writeText(text);
    setLinksCopied(true);
    setTimeout(() => setLinksCopied(false), 2000);
  }

  function downloadLinksCsv() {
    setError(null);
    if (linkedRows.length === 0) {
      setError("Find Google Maps links first.");
      return;
    }
    const header = "Zone,Location,Road Name,From,To,Google Maps Link";
    const lines = linkedRows.map((row) =>
      [row.zone, row.location, row.roadName, row.fromDesc, row.toDesc, mapsResults[row.id].mapsUrl ?? ""]
        .map(csvField)
        .join(",")
    );
    downloadBlob([header, ...lines].join("\n"), `${slugify(documentName)}-maps-links.csv`, "text/csv");
  }

  const tracedRows = rows.filter((r) => results[r.id]?.status === "ok");

  function generate() {
    setError(null);
    if (tracedRows.length === 0) {
      setError("Trace the roads first, then generate the .kml from the successful rows.");
      return;
    }
    const paths: KmlPathInput[] = tracedRows.map((row) => {
      const result = results[row.id];
      return {
        name: `${row.roadName}: ${row.fromDesc} to ${row.toDesc}`,
        coordinates: result.coordinates!.map((c) => ({ lat: c.lat, lng: c.lng })),
        metadata: {
          Zone: row.zone,
          Location: row.location,
          "Road No": row.roadNo,
          "Footpath length (sheet, km)": row.footpathLengthKm,
          "Traced length (km)": result.tracedLengthKm?.toFixed(2) ?? "",
        },
      };
    });
    downloadBlob(buildKml(paths, documentName), `${slugify(documentName)}.kml`, "application/vnd.google-earth.kml+xml");
  }

  return (
    <div className="mt-8">
      <label className="block text-sm font-medium text-ad-ink">
        Document name
        <input
          value={documentName}
          onChange={(e) => setDocumentName(e.target.value)}
          className="mt-1 w-full max-w-sm rounded-lg border border-ad-border p-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
        />
      </label>

      <div className="mt-4 rounded-xl border border-ad-border bg-white p-5">
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
            if (f) void handleImage(f);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
            dragActive ? "border-ad-orange bg-ad-orange/10" : "border-ad-border hover:bg-ad-surface"
          )}
        >
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImage(f);
              e.target.value = "";
            }}
          />
          <p className="font-medium text-ad-ink">
            {extracting
              ? "Reading the screenshot…"
              : dragActive
                ? "Drop the screenshot here"
                : "Drag & drop a screenshot of the road register, or click to browse"}
          </p>
          <p className="text-sm text-ad-muted">
            Expects columns like Zone, Location, Road Name, From Desc, To Desc, Footpath Length — or
            add/edit rows manually below.
          </p>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-ad-border">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead>
            <tr className="bg-ad-surface text-left text-ad-muted">
              <th className="px-3 py-2 font-medium">Zone</th>
              <th className="px-3 py-2 font-medium">Location</th>
              <th className="px-3 py-2 font-medium">Road name</th>
              <th className="px-3 py-2 font-medium">From</th>
              <th className="px-3 py-2 font-medium">To</th>
              <th className="px-3 py-2 font-medium">Length (km)</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Google Maps</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const issue = rowIssues[i];
              const touched = row.location || row.roadName || row.fromDesc || row.toDesc;
              const result = results[row.id];
              const mapsResult = mapsResults[row.id];
              return (
                <tr key={row.id} className="border-t border-ad-border align-top">
                  <td className="px-3 py-2">
                    <input
                      value={row.zone}
                      onChange={(e) => updateRow(row.id, { zone: e.target.value })}
                      className="w-16 rounded-md border border-ad-border p-1.5 text-ad-ink outline-none focus:border-ad-steel"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={row.location}
                      onChange={(e) => updateRow(row.id, { location: e.target.value })}
                      placeholder="Kuraby"
                      className="w-28 rounded-md border border-ad-border p-1.5 text-ad-ink outline-none focus:border-ad-steel"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={row.roadName}
                      onChange={(e) => updateRow(row.id, { roadName: e.target.value })}
                      placeholder="Beenleigh Rd"
                      className="w-32 rounded-md border border-ad-border p-1.5 text-ad-ink outline-none focus:border-ad-steel"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={row.fromDesc}
                      onChange={(e) => updateRow(row.id, { fromDesc: e.target.value })}
                      placeholder="Donegal St"
                      className="w-32 rounded-md border border-ad-border p-1.5 text-ad-ink outline-none focus:border-ad-steel"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={row.toDesc}
                      onChange={(e) => updateRow(row.id, { toDesc: e.target.value })}
                      placeholder="Logan Rd"
                      className="w-32 rounded-md border border-ad-border p-1.5 text-ad-ink outline-none focus:border-ad-steel"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={row.footpathLengthKm}
                      onChange={(e) => updateRow(row.id, { footpathLengthKm: e.target.value })}
                      placeholder="N/A"
                      className="w-20 rounded-md border border-ad-border p-1.5 text-ad-ink outline-none focus:border-ad-steel"
                    />
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {touched && issue && <p className="text-ad-orange">{issue}</p>}
                    {result && (
                      <div>
                        <p
                          className={cn(
                            "font-medium",
                            result.status === "ok" ? "text-ad-steel" : "text-ad-orange"
                          )}
                        >
                          {STATUS_LABEL[result.status]}
                          {result.status === "ok" && result.tracedLengthKm != null
                            ? ` · ${result.tracedLengthKm.toFixed(2)}km`
                            : ""}
                        </p>
                        {result.flags.map((f, fi) => (
                          <p key={fi} className="text-ad-muted">
                            {f}
                          </p>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {mapsResult && (
                      <div>
                        {mapsResult.status === "ok" && mapsResult.mapsUrl ? (
                          <a
                            href={mapsResult.mapsUrl}
                            target="_blank"
                            rel="noopener"
                            className="font-medium text-ad-steel underline underline-offset-2"
                          >
                            Open ↗
                          </a>
                        ) : (
                          <p className="font-medium text-ad-orange">{MAPS_STATUS_LABEL[mapsResult.status]}</p>
                        )}
                        {mapsResult.flags.map((f, fi) => (
                          <p key={fi} className="text-ad-muted">
                            {f}
                          </p>
                        ))}
                      </div>
                    )}
                  </td>
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
          <span className="font-semibold text-ad-ink">{readyRows.length}</span> row(s) ready to trace
        </span>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-ad-border pt-6">
        <button
          className={cn(buttonVariants({ variant: "primary", size: "md" }), tracing && "opacity-60")}
          onClick={traceRoads}
          disabled={tracing}
        >
          {tracing ? "Tracing roads…" : "Trace roads"}
        </button>
        <button
          className={cn(buttonVariants({ variant: "accent", size: "md" }))}
          onClick={generate}
          disabled={tracedRows.length === 0}
        >
          Generate & download .kml ({tracedRows.length})
        </button>
        {error && <span className="text-sm text-ad-orange">{error}</span>}
      </div>
      <p className="mt-2 text-xs text-ad-muted">
        Traces using Google Maps when it&rsquo;s configured (more reliable), falling back to free
        OpenStreetMap data otherwise.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-ad-border pt-6">
        <button
          className={cn(buttonVariants({ variant: "primary", size: "md" }), findingLinks && "opacity-60")}
          onClick={findMapsLinks}
          disabled={findingLinks}
        >
          {findingLinks ? "Finding links…" : "Find Google Maps links"}
        </button>
        <button
          className={cn(buttonVariants({ variant: "outline", size: "md" }))}
          onClick={copyAllLinks}
          disabled={linkedRows.length === 0}
        >
          {linksCopied ? "Copied!" : `Copy all links (${linkedRows.length})`}
        </button>
        <button
          className={cn(buttonVariants({ variant: "outline", size: "md" }))}
          onClick={downloadLinksCsv}
          disabled={linkedRows.length === 0}
        >
          Download links (CSV)
        </button>
      </div>
    </div>
  );
}
