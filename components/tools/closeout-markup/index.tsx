"use client";

// Closeout Markup — a job's progress on one drawing.
//
// Paste the opportunity, the tool reads its work orders out of Salesforce, collapses them into
// the properties they name, and colours each by how its inspections went. The drawing is what
// goes out with the closeout letter, and its Box link is written to Opportunity.Closeout_Markup__c.
//
// Read-only against Salesforce apart from that one field. Nothing here changes a work order.
//
// Reuses the markup engine rather than forking it: MarkupMap and useShapes are the same
// components Building Markup draws with, and the export goes through the same
// /api/kml/standard-markup/render route, which now takes the colours and legend labels a
// closeout needs. The address card and the quote sheet are what a Salesforce-driven source does
// not want, and those are the only parts written fresh.

import { useCallback, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { downloadBlob } from "@/components/tools/shared/download";
import { BREAKOUT_XL } from "@/components/tools/shared/quote-lines/styles";
import { MarkupMap, type MarkupMapCommands } from "@/components/tools/site-markups/markup-map";
import { ShapePanel } from "@/components/tools/site-markups/shape-panel";
import { MIN_POINTS, useShapes } from "@/components/tools/site-markups/shapes";
import { MAX_CLOSEOUT_LOTS } from "@/lib/closeout-markup/limits";
import { closeoutCsv, numberRows, rowNumbers, type CloseoutRow } from "@/lib/closeout-markup/rows";
import { INSPECTION_LEGEND, type CloseoutOpportunity, type UnmappedWorkOrder } from "@/lib/closeout-markup/types";
import type { CloseoutProperty } from "@/lib/closeout-markup/types";
import { buildCloseoutFile, parseCloseoutFile } from "@/lib/closeout-markup/file";
import { MARKUP_STYLES } from "@/lib/kml/standard-markup/style";
import type { LatLng } from "@/lib/kml/types";
import { MapLegend } from "./map-legend";
import { OpportunityCard } from "./opportunity-card";
import { StatusTable } from "./status-table";
import { FileToSalesforce } from "./file-to-salesforce";

interface ResolvedParcel {
  key: string;
  ring: LatLng[] | null;
  areaSqm: number | null;
  lotPlan: string | null;
  point: LatLng;
  note: string | null;
}

/** The legend a closeout drawing carries — colours mean inspection status here, not what the
 *  lot IS. Sent with every render; the server filters it to the colours actually drawn. */
const CLOSEOUT_LEGEND = (["green", "red", "orange", "partial"] as const).map((color) => ({
  color,
  label: INSPECTION_LEGEND[color],
}));

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "closeout";
}

export function CloseoutMarkupTool() {
  const [opportunity, setOpportunity] = useState<CloseoutOpportunity | null>(null);
  const [properties, setProperties] = useState<CloseoutProperty[]>([]);
  const [unmapped, setUnmapped] = useState<UnmappedWorkOrder[]>([]);
  const [workOrderCount, setWorkOrderCount] = useState(0);
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [parcels, setParcels] = useState<Map<string, ResolvedParcel>>(new Map());
  const [generated, setGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fitRequest, setFitRequest] = useState<
    { key: string; rings: LatLng[][]; padding?: "tight" | "context" } | null
  >(null);

  const shapes = useShapes();
  const mapRef = useRef<MarkupMapCommands | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  // Bumped by every resolve and open, so a slow parcel batch from a previous opportunity can
  // never write its results into the one now on screen.
  const runRef = useRef(0);

  // ONE derivation, feeding the sheet, the map badges and the export payload — so all three
  // agree about what item 4 is. Same rule as the quote sheet's: 1..N over the ticked rows in
  // row order, display only.
  const rows: CloseoutRow[] = useMemo(() => {
    const built = properties.map((property) => {
      const parcel = parcels.get(property.key);
      return {
        property,
        selected: !deselected.has(property.key),
        number: null,
        ring: parcel?.ring ?? null,
        areaSqm: parcel?.areaSqm ?? null,
        lotPlan: parcel?.lotPlan ?? null,
        point: parcel?.point ?? property.point,
        note: parcel?.note ?? null,
      };
    });
    return numberRows(built);
  }, [properties, parcels, deselected]);

  const numbers = useMemo(() => rowNumbers(rows), [rows]);
  const selectedRows = rows.filter((r) => r.selected);
  const overCap = selectedRows.length > MAX_CLOSEOUT_LOTS;

  const lots = useMemo(
    () =>
      rows
        .filter((r) => r.selected && r.ring)
        .map((r) => ({ id: r.property.key, ring: r.ring!, color: r.property.color })),
    [rows]
  );
  const points = useMemo(
    () =>
      rows
        .filter((r) => r.selected && !r.ring && generated)
        .map((r) => ({ id: r.property.key, at: r.point, color: r.property.color })),
    [rows, generated]
  );

  /**
   * Frame everything that is DRAWN.
   *
   * A pin has no ring, so it goes in as a degenerate two-point one — the map's fit filter
   * takes those, and a pinned property still has to be inside the frame or the drawing quietly
   * omits it. `padding: "context"` leaves a tenth of the shorter side clear: a closeout is read
   * by someone who was never on site, and properties running to the edge of the image give
   * them nothing to place the job by.
   */
  const frameFrom = useCallback(
    (items: { ring: LatLng[] | null; point: LatLng }[], key: string) => {
      const rings = items.map((i) => i.ring ?? [i.point, i.point]).filter((r) => r.length >= 2);
      if (rings.length === 0) return;
      setFitRequest({ key, rings, padding: "context" });
    },
    []
  );

  const reset = useCallback(() => {
    runRef.current++;
    setParcels(new Map());
    setGenerated(false);
    setError(null);
    setFitRequest(null);
  }, []);

  const onResolved = useCallback(
    (data: {
      opportunity: CloseoutOpportunity;
      properties: CloseoutProperty[];
      unmapped: UnmappedWorkOrder[];
      workOrderCount: number;
    }) => {
      reset();
      setOpportunity(data.opportunity);
      setProperties(data.properties);
      setUnmapped(data.unmapped);
      setWorkOrderCount(data.workOrderCount);
      // ⚠️ Over the cap, NOTHING is pre-ticked. Pre-ticking the first 60 of 700 in street order
      // would be a drawing of one suburb presented as a drawing of the job, and the operator
      // would have to notice. Starting empty makes the choice theirs.
      setDeselected(
        data.properties.length > MAX_CLOSEOUT_LOTS
          ? new Set(data.properties.map((p) => p.key))
          : new Set()
      );
    },
    [reset]
  );

  function toggle(key: string) {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll(selected: boolean) {
    setDeselected(selected ? new Set() : new Set(properties.map((p) => p.key)));
  }

  async function generate() {
    if (!opportunity || overCap || selectedRows.length === 0) return;
    setError(null);
    setGenerating(true);
    const run = ++runRef.current;
    try {
      const res = await fetch("/api/kml/closeout-markup/parcels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          properties: selectedRows.map((r) => ({
            key: r.property.key,
            street: r.property.street,
            suburb: r.property.suburb,
            postcode: r.property.postcode,
            state: r.property.state,
            point: r.property.point,
            precision: r.property.precision,
            sharedPoint: r.property.sharedPoint,
            accuracy: r.property.accuracy,
          })),
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; parcels?: ResolvedParcel[]; error?: string }
        | null;
      if (!res.ok || !json?.parcels) throw new Error(json?.error ?? "Couldn't look up the boundaries.");
      if (run !== runRef.current) return;

      const map = new Map(json.parcels.map((p) => [p.key, p]));
      setParcels(map);
      setGenerated(true);
      frameFrom(json.parcels, `${opportunity.id}:${Date.now()}`);
    } catch (e) {
      if (run === runRef.current) setError((e as Error).message);
    } finally {
      if (run === runRef.current) setGenerating(false);
    }
  }

  async function renderImageBase64(): Promise<string> {
    if (!generated) throw new Error("Generate the markup first.");
    const camera = mapRef.current?.getCamera();
    if (!camera) throw new Error("The map is still loading — try again in a moment.");
    const res = await fetch("/api/kml/standard-markup/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        // No project site on a closeout: every property is one of the job's, coloured by how it
        // went. Same arrangement as a multi-property Building Markup.
        subjectRing: [],
        hideSubject: true,
        neighbours: rows
          .filter((r) => r.selected && r.ring)
          .map((r) => ({
            id: r.property.key,
            ring: r.ring!,
            areaSqm: r.areaSqm,
            label: String(numbers.get(r.property.key) ?? ""),
            street: r.property.street,
            suburb: r.property.suburb,
            color: r.property.color,
          })),
        points: rows
          .filter((r) => r.selected && !r.ring)
          .map((r) => ({
            id: r.property.key,
            at: r.point,
            label: String(numbers.get(r.property.key) ?? ""),
            color: r.property.color,
          })),
        legend: CLOSEOUT_LEGEND,
        mapType: camera.mapType,
        bounds: camera.bounds,
        // Every outline in the SVG composite: a 60-property drawing would otherwise be
        // simplified to fit the tile URL and capped at 12 lots.
        overlayOutlines: true,
        shapes: shapes.payload(),
      }),
    });
    const json = (await res.json().catch(() => null)) as { ok: boolean; image?: string; error?: string } | null;
    if (!res.ok || !json?.image) throw new Error(json?.error ?? "Something went wrong rendering the image.");
    return json.image;
  }

  function saveFileJson(): string | null {
    if (!opportunity || !generated) return null;
    return JSON.stringify(
      buildCloseoutFile({
        opportunity,
        properties: rows.map((r) => ({
          property: r.property,
          selected: r.selected,
          ring: r.ring,
          areaSqm: r.areaSqm,
          lotPlan: r.lotPlan,
          point: r.point,
          note: r.note,
        })),
        unmapped,
        workOrderCount,
        mapType: mapRef.current?.getCamera()?.mapType ?? "hybrid",
        shapes: shapes.shapes
          .filter((a) => a.points.length >= MIN_POINTS[a.mode])
          .map(({ id, mode, widthMetres, color, points: pts }) => ({ id, mode, widthMetres, color, points: pts })),
      }),
      null,
      2
    );
  }

  const filenameStem = opportunity ? `${slugify(opportunity.name)}-closeout-markup` : "closeout-markup";

  async function download() {
    setError(null);
    setDownloading(true);
    try {
      const base64 = await renderImageBase64();
      downloadBlob(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)), `${filenameStem}.png`, "image/png");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  async function openJson(file: File) {
    setError(null);
    const parsed = parseCloseoutFile(await file.text());
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    runRef.current++;
    setOpportunity(parsed.file.opportunity);
    setProperties(parsed.file.properties.map((p) => p.property));
    setUnmapped(parsed.file.unmapped);
    setWorkOrderCount(parsed.file.workOrderCount);
    setDeselected(new Set(parsed.file.properties.filter((p) => !p.selected).map((p) => p.property.key)));
    setParcels(
      new Map(
        parsed.file.properties.map((p) => [
          p.property.key,
          { key: p.property.key, ring: p.ring, areaSqm: p.areaSqm, lotPlan: p.lotPlan, point: p.point, note: p.note },
        ])
      )
    );
    setGenerated(true);
    frameFrom(parsed.file.properties, `open:${Date.now()}`);
    if (parsed.skipped > 0) {
      setError(`${parsed.skipped} propert${parsed.skipped === 1 ? "y" : "ies"} in that file couldn't be read and were skipped.`);
    }
  }

  const drawnColours = useMemo(
    () => new Set(rows.filter((r) => r.selected).map((r) => r.property.color)),
    [rows]
  );

  const counts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const r of rows) acc[r.property.color] = (acc[r.property.color] ?? 0) + 1;
    return acc;
  }, [rows]);

  return (
    <div>
      <OpportunityCard onResolved={onResolved} onReset={reset} opportunity={opportunity} workOrderCount={workOrderCount} />

      {properties.length > 0 && (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void generate()}
              disabled={generating || overCap || selectedRows.length === 0}
              className={cn(buttonVariants({ variant: "primary", size: "md" }))}
            >
              {generating ? "Looking up boundaries…" : generated ? "Regenerate" : "Generate markup"}
            </button>
            <button
              type="button"
              onClick={() => void download()}
              disabled={!generated || downloading}
              className={cn(buttonVariants({ variant: "outline", size: "md" }))}
            >
              {downloading ? "Rendering…" : "Download .png"}
            </button>
            <button
              type="button"
              onClick={() => {
                const doc = saveFileJson();
                if (doc) downloadBlob(doc, `${filenameStem}.json`, "application/json");
              }}
              disabled={!generated}
              className={cn(buttonVariants({ variant: "outline", size: "md" }))}
            >
              Save .json
            </button>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className={cn(buttonVariants({ variant: "outline", size: "md" }))}
            >
              Open .json
            </button>
            {/* Cleared after every pick, so choosing the same file twice still fires. */}
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void openJson(f);
              }}
            />
            {opportunity && (
              <FileToSalesforce
                opportunity={opportunity}
                getImageBase64={renderImageBase64}
                getSidecar={(imageFilename: string) => {
                  const doc = saveFileJson();
                  if (!doc) throw new Error("Generate the markup first.");
                  return {
                    filename: `${imageFilename.replace(/\.(png|jpe?g)$/i, "")}.json`,
                    contentBase64: btoa(unescape(encodeURIComponent(doc))),
                    contentType: "application/json",
                  };
                }}
                fallbackName={`${filenameStem}.png`}
                disabled={!generated}
              />
            )}
            {error && <span className="text-sm text-ad-orange">{error}</span>}
          </div>

          {/* What came out of Salesforce, and what it collapsed to. The collapse is the whole
              point of the tool — work orders are raised per unit, so 257 of them being 39
              addresses is the number an operator wants to see confirmed before drawing. */}
          <p className="mt-4 text-sm text-ad-ink">
            <span className="font-medium">{workOrderCount}</span> work order
            {workOrderCount === 1 ? "" : "s"} assessed
            {" · "}
            <span className="font-medium">{properties.length}</span> unique address
            {properties.length === 1 ? "" : "es"}
            {unmapped.length > 0 && (
              <>
                {" · "}
                <span className="font-medium text-ad-orange">{unmapped.length}</span>
                {/* Explicit: JSX drops the space between a tag and text across a line break. */}
                {" couldn't be placed"}
              </>
            )}
          </p>

          {/* The colour breakdown, in the drawing's own colours. */}
          <p className="mt-1.5 text-sm text-ad-muted">
            {(["green", "red", "orange", "partial"] as const)
              .filter((c) => counts[c])
              .map((c) => (
                <span key={c} className="mr-4 inline-flex items-center gap-1.5">
                  {/* Two-tone, like the legend and the sheet: a plain green dot here read the
                      same as "inspected", which is the one distinction this line exists for. */}
                  <span
                    aria-hidden
                    className="inline-block size-2.5 rounded-full border-2"
                    style={{
                      backgroundColor: `#${MARKUP_STYLES[c].fill}`,
                      borderColor: `#${MARKUP_STYLES[c].stroke}`,
                    }}
                  />
                  {counts[c]} {INSPECTION_LEGEND[c].toLowerCase()}
                </span>
              ))}
          </p>

          {generated && (
            <div className={cn("mt-6 flex flex-col gap-4 xl:flex-row xl:items-start", BREAKOUT_XL)}>
              <div className="relative w-full min-w-0 xl:flex-1">
                <MapLegend present={drawnColours} />
                {/* Panning away from the framing is easy and the export takes whatever the map
                    is left on, so there has to be a way back to it. Ticking rows changes what
                    is drawn WITHOUT moving the camera — yanking it while someone works through
                    a 39-row sheet would be worse — so this is how the frame catches up. */}
                <button
                  type="button"
                  onClick={() => frameFrom(rows.filter((r) => r.selected), `fit:${Date.now()}`)}
                  className="absolute right-3 top-16 z-10 rounded-lg border border-ad-border bg-white/95 px-2.5 py-1.5 text-xs font-medium text-ad-ink shadow-sm backdrop-blur-sm hover:bg-white"
                >
                  Fit to properties
                </button>
                <MarkupMap
                  ref={mapRef}
                  shapes={shapes}
                  subjectRing={[]}
                  hideSubject
                  lots={lots}
                  points={points}
                  numbers={numbers}
                  pickMode={false}
                  onPick={() => {}}
                  fitRequest={fitRequest}
                />
              </div>
              <div className="w-full space-y-4 xl:w-80 xl:shrink-0">
                <ShapePanel shapes={shapes} commands={mapRef} />
              </div>
            </div>
          )}

          <StatusTableSection
            rows={rows}
            onToggle={toggle}
            onToggleAll={toggleAll}
            onExport={() => downloadBlob(closeoutCsv(rows), `${filenameStem}.csv`, "text/csv;charset=utf-8")}
            capped={overCap}
            max={MAX_CLOSEOUT_LOTS}
            unmapped={unmapped}
          />
        </>
      )}
    </div>
  );
}

// Split out only so the tool's own render stays readable.
function StatusTableSection(props: {
  rows: CloseoutRow[];
  onToggle: (key: string) => void;
  onToggleAll: (selected: boolean) => void;
  onExport: () => void;
  capped: boolean;
  max: number;
  unmapped: UnmappedWorkOrder[];
}) {
  const { unmapped, ...table } = props;
  return (
    <>
      <StatusTable {...table} />
      {unmapped.length > 0 && (
        // Folded, but always reachable. These are real work orders with real statuses that no
        // drawing can place — an induction booking, a job named after an asset rather than an
        // address. Dropping them silently would make the closeout look complete when it is not.
        <details className="mt-4 rounded-xl border border-ad-border bg-white px-4 py-3 text-sm">
          <summary className="cursor-pointer text-ad-steel">
            {unmapped.length} work order{unmapped.length === 1 ? "" : "s"} couldn&apos;t be placed on a map
          </summary>
          <ul className="mt-3 space-y-1 text-ad-muted">
            {unmapped.map((u) => (
              <li key={u.id}>
                <span className="text-ad-ink">{u.number ?? u.id}</span>
                {u.street ? ` · ${u.street}` : ""} — {u.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

