"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { downloadBlob } from "@/components/tools/shared/download";
import { buildKmz, buildRoadSurveyKml } from "@/lib/road-survey/build-kml";
import { parseEditedSheet, SheetParseError } from "@/lib/road-survey/parse-csv";
import { reconcile, type Reconciliation } from "@/lib/road-survey/reconcile";
import type { RoadSegment } from "@/lib/road-survey/types";

interface Props {
  segments: RoadSegment[];
  fingerprint: string;
  documentName: string | null;
  sourceFileName: string | null;
}

/**
 * The return leg of the round trip: the client deleted rows from the exported sheet, and
 * this turns what came back into a map.
 *
 * Runs entirely in the browser — parsing the sheet, matching it against the already-loaded
 * source geometry, writing the KML and zipping it are all pure work with no secrets in it,
 * so there is nothing for a server round-trip to add.
 */
export function RebuildMap({ segments, fingerprint, documentName, sourceFileName }: Props) {
  const [result, setResult] = useState<Reconciliation | null>(null);
  const [sheetName, setSheetName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function load(file: File | null) {
    setError(null);
    setResult(null);
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      setError("That needs to be the .csv the client sent back.");
      return;
    }
    setSheetName(file.name);
    try {
      const sheet = parseEditedSheet(await file.text());
      setResult(reconcile(segments, sheet, fingerprint));
    } catch (e) {
      // A SheetParseError is a bad file; anything else is a mismatched source file, which
      // reconcile() throws deliberately rather than quietly building the wrong map.
      setError(e instanceof SheetParseError ? e.message : (e as Error).message);
      setSheetName(null);
    }
  }

  function download(kind: "kmz" | "kml") {
    if (!result || result.matched.length === 0) return;
    const stem = (sourceFileName ?? "road-survey").replace(/\.(kmz|kml)$/i, "");
    const kml = buildRoadSurveyKml(result.matched, `${documentName ?? stem} — revised`);
    if (kind === "kml") {
      downloadBlob(kml, `${stem}-revised.kml`, "application/vnd.google-earth.kml+xml");
    } else {
      downloadBlob(
        buildKmz(kml) as unknown as BlobPart,
        `${stem}-revised.kmz`,
        "application/vnd.google-earth.kmz"
      );
    }
  }

  const matched = result?.matched.length ?? 0;

  return (
    <div className="mt-8 rounded-xl border border-ad-border bg-white p-5">
      <h3 className="font-heading text-base font-semibold text-ad-ink">Rebuild the map from an edited sheet</h3>
      <p className="mt-1 text-sm text-ad-muted">
        Send the client the CSV, let them delete the roads that aren&apos;t in scope, then drop their
        version back here. You&apos;ll get a map of just the roads they kept, with their real shapes and
        the original colours — ready to open in Google Earth.
      </p>

      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
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
          void load(e.dataTransfer.files?.[0] ?? null);
        }}
        className={cn(
          "mt-4 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
          dragActive ? "border-ad-orange bg-ad-orange/10" : "border-ad-border hover:bg-ad-surface"
        )}
      >
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => void load(e.target.files?.[0] ?? null)}
        />
        <p className="text-sm font-medium text-ad-ink">
          {sheetName ?? (dragActive ? "Drop it here" : "Drop the client's edited .csv here")}
        </p>
        <p className="text-xs text-ad-muted">{sheetName ? "Click to choose a different sheet" : "or click to browse"}</p>
      </div>

      {error && <p className="mt-3 text-sm text-ad-orange">{error}</p>}

      {result && (
        <>
          <p className="mt-4 text-sm text-ad-ink">
            <span className="font-semibold">{matched}</span> of {segments.length} roads matched
            {result.removed.length > 0 && (
              <>
                {" · "}
                <span className="font-semibold">{result.removed.length}</span> removed by the client
              </>
            )}
            {result.unmatchedRows.length > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-ad-orange">{result.unmatchedRows.length}</span> couldn&apos;t be
                matched
              </>
            )}
          </p>

          {result.warnings.map((w, i) => (
            <p key={i} className="mt-2 rounded-lg border border-ad-orange/40 bg-ad-orange/5 p-3 text-sm text-ad-muted">
              {w}
            </p>
          ))}

          {result.unmatchedRows.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm text-ad-muted">
              {result.unmatchedRows.slice(0, 8).map((u, i) => (
                <li key={i}>
                  Row {u.row.line}
                  {u.row.values["road_name"] ? ` (${u.row.values["road_name"]})` : ""} — {u.reason}
                </li>
              ))}
              {result.unmatchedRows.length > 8 && <li>…and {result.unmatchedRows.length - 8} more</li>}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              className={cn(buttonVariants({ variant: "accent", size: "md" }), matched === 0 && "opacity-50")}
              onClick={() => download("kmz")}
              disabled={matched === 0}
            >
              Download .kmz
            </button>
            <button
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), matched === 0 && "opacity-50")}
              onClick={() => download("kml")}
              disabled={matched === 0}
            >
              .kml instead
            </button>
            <span className="text-xs text-ad-muted">
              .kmz is the same map, zipped — smaller to email. Both open the same way.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
