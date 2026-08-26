"use client";

import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { downloadBlob } from "@/components/tools/shared/download";
import { CSV_COLUMNS, toCsv, toRows, toTsv } from "@/lib/road-survey/csv";
import { isDividedCarriageway } from "@/lib/road-survey/lanes";
import { DEFAULT_LANES, RATES, SHORT_SEGMENT_KM, laneKm, priceSegment, rateCodeFor } from "@/lib/road-survey/pricing";
import type { EnrichedSegment, RoadSegment, SegmentEnrichment } from "@/lib/road-survey/types";

interface ParseResponse {
  ok: boolean;
  error?: string;
  segments?: RoadSegment[];
  documentName?: string | null;
  colours?: { colourHex: string; folder: string; count: number; totalKm: number }[];
}

interface EnrichResponse {
  ok: boolean;
  error?: string;
  enrichment?: Record<string, SegmentEnrichment>;
  warnings?: string[];
  stats?: { osmMatched: number; osmTagged: number; geocoded: number; tiles: number };
}

const UNENRICHED: SegmentEnrichment = {
  lanes: DEFAULT_LANES,
  lanesSource: "assumed",
  lanesMin: null,
  lanesMax: null,
  osmHighwayClass: null,
  osmSurface: null,
  oneway: null,
  locality: null,
  lga: null,
  postcode: null,
};

const money = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });
}

export function RoadSurveyEstimatorTool() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileB64, setFileB64] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [documentName, setDocumentName] = useState<string | null>(null);
  const [segments, setSegments] = useState<RoadSegment[] | null>(null);
  const [colours, setColours] = useState<ParseResponse["colours"]>([]);
  const [enrichment, setEnrichment] = useState<Record<string, SegmentEnrichment>>({});
  const [laneOverrides, setLaneOverrides] = useState<Record<string, number>>({});
  const [provisional, setProvisional] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [enriched, setEnriched] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  /** Segments with enrichment and any hand-typed lane override folded in. */
  const rows: EnrichedSegment[] = useMemo(
    () =>
      (segments ?? []).map((s) => {
        const base = enrichment[s.id] ?? UNENRICHED;
        const override = laneOverrides[s.id];
        return {
          ...s,
          enrichment: override ? { ...base, lanes: override, lanesSource: "manual" } : base,
        };
      }),
    [segments, enrichment, laneOverrides]
  );

  const totals = useMemo(() => {
    const provisionalSet = new Set(provisional.map((c) => c.toLowerCase()));
    let km = 0, lkm = 0, pre = 0, post = 0, provKm = 0, provPre = 0;
    for (const r of rows) {
      const lanes = r.enrichment.lanes ?? DEFAULT_LANES;
      const p = priceSegment(r.lengthKmGeometry, lanes, "pre");
      km += r.lengthKmGeometry;
      lkm += laneKm(r.lengthKmGeometry, lanes);
      pre += p;
      post += priceSegment(r.lengthKmGeometry, lanes, "post");
      if (provisionalSet.has(r.colourHex.toLowerCase())) {
        provKm += r.lengthKmGeometry;
        provPre += p;
      }
    }
    return { km, lkm, pre, post, provKm, provPre, firmPre: pre - provPre };
  }, [rows, provisional]);

  async function choose(file: File | null) {
    setError(null);
    if (!file) return;
    if (!/\.(kmz|kml)$/i.test(file.name)) {
      setError("That needs to be a .kmz or .kml file.");
      return;
    }
    setFileName(file.name);
    setSegments(null);
    setEnrichment({});
    setLaneOverrides({});
    setProvisional([]);
    setWarnings([]);
    setEnriched(false);
    setLoading(true);
    try {
      const data = await readFileBase64(file);
      setFileB64(data);
      const res = await fetch("/api/road-survey/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: { data, name: file.name } }),
      });
      const json = (await res.json()) as ParseResponse;
      if (!json.ok) {
        setError(json.error ?? "Couldn't read that file.");
        return;
      }
      setSegments(json.segments ?? []);
      setColours(json.colours ?? []);
      setDocumentName(json.documentName ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function enrich() {
    if (!fileB64) return;
    setEnriching(true);
    setError(null);
    try {
      const res = await fetch("/api/road-survey/enrich", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: { data: fileB64 } }),
      });
      const json = (await res.json()) as EnrichResponse;
      if (!json.ok) {
        setError(json.error ?? "Lookup failed — the priced rows below are still good.");
        return;
      }
      setEnrichment(json.enrichment ?? {});
      setWarnings(json.warnings ?? []);
      setEnriched(true);
    } catch (e) {
      setError(`Lookup failed (${(e as Error).message}) — the priced rows below are still good.`);
    } finally {
      setEnriching(false);
    }
  }

  const csvRows = useMemo(() => toRows(rows, provisional), [rows, provisional]);

  async function copyForExcel() {
    await navigator.clipboard.writeText(toTsv(csvRows));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function download() {
    const stem = (fileName ?? "road-survey").replace(/\.(kmz|kml)$/i, "");
    downloadBlob(toCsv(csvRows), `${stem}-quote.csv`, "text/csv;charset=utf-8");
  }

  const flagged = rows.filter((r) => r.lengthVarianceFlag || r.classMismatch);
  const assumedLanes = rows.filter((r) => r.enrichment.lanesSource === "assumed").length;
  const vu5Count = rows.filter((r) => rateCodeFor(r.lengthKmGeometry) === "VU5").length;
  const divided = rows.filter((r) => isDividedCarriageway(r.enrichment));
  const dividedKm = divided.reduce((a, r) => a + r.lengthKmGeometry, 0);

  return (
    <div>
      <p className="mt-2 text-sm text-ad-muted">
        Drop in the client&apos;s road network and get a priced, per-segment quoting sheet. Lengths are
        measured from the file&apos;s own geometry; lanes come from OpenStreetMap where it has them.
        Priced on the roadway-video rate card — {money(RATES.VU5.pre)}/lane flat up to {SHORT_SEGMENT_KM}km,
        then {money(RATES.VO5.pre)}/km/lane.
      </p>

      {/* Upload */}
      <div className="mt-6 rounded-xl border border-ad-border bg-white p-5">
        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInput.current?.click()}
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
            void choose(e.dataTransfer.files?.[0] ?? null);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-colors",
            dragActive ? "border-ad-orange bg-ad-orange/10" : "border-ad-border hover:bg-ad-surface"
          )}
        >
          <input
            ref={fileInput}
            type="file"
            accept=".kmz,.kml"
            className="hidden"
            onChange={(e) => void choose(e.target.files?.[0] ?? null)}
          />
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ad-steel" aria-hidden>
            <path d="M12 16V4m0 0L7 9m5-5l5 5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="font-medium text-ad-ink">
            {loading ? "Reading…" : fileName ? fileName : dragActive ? "Drop it here" : "Drag & drop the .kmz here"}
          </p>
          <p className="text-sm text-ad-muted">{fileName ? "Click to choose a different file" : "or click to browse · .kmz or .kml"}</p>
        </div>
        {error && <p className="mt-4 text-sm text-ad-orange">{error}</p>}
      </div>

      {segments && (
        <>
          {/* Summary */}
          <div className="mt-8 rounded-xl border border-ad-border bg-ad-surface p-5">
            {documentName && <p className="text-xs uppercase tracking-wide text-ad-muted">{documentName}</p>}
            <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Segments" value={segments.length.toLocaleString("en-AU")} />
              <Stat label="Centreline" value={`${totals.km.toFixed(1)} km`} />
              <Stat label="Lane-km" value={totals.lkm.toFixed(0)} />
              <Stat label="Pre-con total" value={money(totals.pre)} />
            </div>
            <p className="mt-3 text-xs text-ad-muted">
              Post-construction round: <span className="font-medium text-ad-ink">{money(totals.post)}</span>
              {" · "}
              {plural(vu5Count, "segment")} on the flat VU5 rate, {rows.length - vu5Count} on per-km VO5.
              {assumedLanes > 0 &&
                ` · ${plural(assumedLanes, "segment")} still on assumed ${DEFAULT_LANES} lanes.`}
            </p>
          </div>

          {/* Provisional selection */}
          <div className="mt-6 rounded-xl border border-ad-border bg-white p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-heading text-base font-semibold text-ad-ink">Which colours are provisional?</h3>
              <p className="text-xs text-ad-muted">Nothing is provisional until you say so.</p>
            </div>
            <p className="mt-1 text-sm text-ad-muted">
              Client briefs name a colour (&ldquo;the roads in blue are provisional&rdquo;) that often
              doesn&apos;t literally appear in the file. Tick what they meant — confirm with them if it
              isn&apos;t obvious, because it moves real money between firm and provisional scope.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {colours?.map((c) => {
                const on = provisional.includes(c.colourHex);
                return (
                  <button
                    key={`${c.colourHex}-${c.folder}`}
                    type="button"
                    onClick={() =>
                      setProvisional((prev) => (on ? prev.filter((x) => x !== c.colourHex) : [...prev, c.colourHex]))
                    }
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                      on ? "border-ad-orange bg-ad-orange/10 text-ad-ink" : "border-ad-border text-ad-muted hover:bg-ad-surface"
                    )}
                  >
                    <span className="h-3 w-3 shrink-0 rounded-full border border-ad-border" style={{ background: c.colourHex }} />
                    <span className="font-medium text-ad-ink">{c.folder || "(no folder)"}</span>
                    <span>{c.count} seg · {c.totalKm.toFixed(0)} km</span>
                  </button>
                );
              })}
            </div>
            {provisional.length > 0 && (
              <p className="mt-3 text-sm text-ad-ink">
                Firm <span className="font-semibold">{money(totals.firmPre)}</span> · provisional{" "}
                <span className="font-semibold">{money(totals.provPre)}</span> ({totals.provKm.toFixed(0)} km)
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button
              className={cn(buttonVariants({ variant: "primary", size: "md" }), enriching && "opacity-60")}
              onClick={enrich}
              disabled={enriching}
            >
              {enriching ? "Looking up lanes & localities…" : enriched ? "Re-run lookup" : "Look up lanes & localities"}
            </button>
            <button className={cn(buttonVariants({ variant: "outline", size: "md" }))} onClick={copyForExcel}>
              {copied ? "Copied!" : "Copy for Excel"}
            </button>
            <button className={cn(buttonVariants({ variant: "accent", size: "md" }))} onClick={download}>
              Download CSV
            </button>
            <span className="text-xs text-ad-muted">{CSV_COLUMNS.length} columns · {plural(rows.length, "row")}</span>
          </div>
          {enriching && (
            <p className="mt-2 text-xs text-ad-muted">
              Querying OpenStreetMap tile by tile — takes a minute or two on a big network. The rows below
              are already priced and stay usable if the lookup comes back empty.
            </p>
          )}

          {warnings.length > 0 && (
            <div className="mt-4 rounded-xl border border-ad-orange/40 bg-ad-orange/5 p-4">
              <p className="text-sm font-medium text-ad-ink">Lookup was incomplete</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-ad-muted">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {divided.length > 0 && (
            <div className="mt-4 rounded-xl border border-ad-steel/40 bg-ad-steel/5 p-4">
              <p className="text-sm font-medium text-ad-ink">
                {plural(divided.length, "segment")} ({dividedKm.toFixed(0)} km) look like divided carriageway
              </p>
              <p className="mt-1 text-sm text-ad-muted">
                OpenStreetMap counts lanes <span className="font-medium">per carriageway</span> on a divided
                road, so these are priced on one side only. If the survey has to drive both, double the lane
                count on those rows — the tool won&apos;t assume it for you.
              </p>
            </div>
          )}

          {flagged.length > 0 && (
            <div className="mt-4 rounded-xl border border-ad-border bg-white p-4">
              <p className="text-sm font-medium text-ad-ink">{plural(flagged.length, "row")} worth an eyeball</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-ad-muted">
                {flagged.map((r) => (
                  <li key={r.id}>
                    <span className="font-medium text-ad-ink">{r.roadName}</span>
                    {r.lengthVarianceFlag && ` — ${r.lengthVarianceFlag}`}
                    {r.classMismatch && ` — sits in "${r.folder}" but the file labels it "${r.classificAttr}"`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Table */}
          <div className="mt-6 overflow-x-auto rounded-xl border border-ad-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-ad-surface text-left text-ad-muted">
                  <th className="px-3 py-2 font-medium">Road</th>
                  <th className="px-3 py-2 font-medium">Class</th>
                  <th className="px-3 py-2 text-right font-medium">Length (km)</th>
                  <th className="px-3 py-2 text-right font-medium">Lanes</th>
                  <th className="px-3 py-2 font-medium">Surface</th>
                  <th className="px-3 py-2 font-medium">Locality</th>
                  <th className="px-3 py-2 font-medium">Rate</th>
                  <th className="px-3 py-2 text-right font-medium">Pre-con</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const e = r.enrichment;
                  const lanes = e.lanes ?? DEFAULT_LANES;
                  const varies = e.lanesMin != null && e.lanesMax != null && e.lanesMin !== e.lanesMax;
                  return (
                    <tr key={r.id} className={cn("border-t border-ad-border", r.lengthVarianceFlag && "bg-ad-orange/5")}>
                      <td className="px-3 py-2 text-ad-ink">
                        <span className="mr-2 inline-block h-2 w-2 rounded-full align-middle" style={{ background: r.colourHex }} />
                        {r.roadName}
                        {r.segmentParts > 1 && <span className="ml-1 text-xs text-ad-muted">({r.segmentParts} parts)</span>}
                      </td>
                      <td className="px-3 py-2 text-ad-muted">{r.folder}</td>
                      <td className="px-3 py-2 text-right text-ad-ink">{r.lengthKmGeometry.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={1}
                          max={12}
                          value={lanes}
                          onChange={(ev) => {
                            const v = Number(ev.target.value);
                            setLaneOverrides((prev) => ({ ...prev, [r.id]: v }));
                          }}
                          className="w-14 rounded border border-ad-border px-2 py-1 text-right text-sm text-ad-ink outline-none focus:border-ad-steel"
                        />
                        <span className="ml-2 text-xs text-ad-muted">
                          {e.lanesSource === "osm" ? "osm" : e.lanesSource === "osm-inferred" ? "inferred" : e.lanesSource === "manual" ? "manual" : "assumed"}
                          {varies && ` ${e.lanesMin}–${e.lanesMax}`}
                          {isDividedCarriageway(e) && (
                            <span className="ml-1 text-ad-steel" title="Divided carriageway — OSM lanes are per carriageway">
                              ÷
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-ad-muted">
                        {e.osmSurface ?? "—"}
                        {e.osmHighwayClass === "track" && <span className="ml-1 text-ad-orange">track</span>}
                      </td>
                      <td className="px-3 py-2 text-ad-muted">
                        {e.locality ?? "—"}
                        {e.postcode && <span className="ml-1 text-xs">{e.postcode}</span>}
                      </td>
                      <td className="px-3 py-2 text-ad-muted">{rateCodeFor(r.lengthKmGeometry)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-ad-ink">
                        {money(priceSegment(r.lengthKmGeometry, lanes, "pre"))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-ad-muted">
            Lengths are centreline, measured from the file&apos;s geometry rather than trusting its own length
            attribute — flagged rows are where the two disagree. Lane counts drive the fee directly, so check
            the ones marked <span className="font-medium">assumed</span> before quoting. Mobilisation, traffic
            control and travel are not in these figures.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-ad-muted">{label}</p>
      <p className="font-heading text-xl font-semibold text-ad-ink">{value}</p>
    </div>
  );
}
