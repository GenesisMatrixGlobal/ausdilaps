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
import {
  INSPECTION_LEGEND,
  type CloseoutOpportunity,
  type CouncilAsset,
  type SkippedWorkOrder,
  type UnmappedWorkOrder,
} from "@/lib/closeout-markup/types";
import type { CloseoutProperty, CloseoutSiteLot, ResolvedCloseoutSite } from "@/lib/closeout-markup/types";
import { buildCloseoutFile, parseCloseoutFile } from "@/lib/closeout-markup/file";
import { diagnoseCloseout, generateBlockedReason } from "@/lib/closeout-markup/diagnose";
import { MARKUP_STYLES } from "@/lib/kml/standard-markup/style";
import type { LatLng } from "@/lib/kml/types";
import { CLOSEOUT_SHAPE_PALETTE, DrawByHand } from "./draw-by-hand";
import { CannotDraw } from "./cannot-draw";
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

/** ⚠️ "Project Site" reuses the label Building Markup's key already has baked glyphs for
 *  (overlay-paths.ts is GENERATED and regenerating it would change every existing markup's
 *  legend), and saying the same thing the same way across the two tools is the better answer
 *  anyway. Drawn as a hollow ring, because MARKUP_STYLES.site has no fill. */
const SITE_LEGEND_ROW = { color: "site", label: "Project Site" } as const;

/** What to tell the operator about the site: nothing when it all resolved, otherwise which
 *  parts didn't and why, so they can draw those by hand. */
function siteNoteFor(site: ResolvedCloseoutSite): string | null {
  if (site.unresolved.length === 0) return null;
  const parts = site.unresolved.map((u) => `${u.address} — ${u.reason.toLowerCase()}`);
  return site.lots.length === 0
    ? `Project site couldn't be placed: ${parts.join("; ")}. Draw it by hand with the Project site colour.`
    // ⚠️ "separately", and the hint, because a consolidated site usually already contains the
    // address that failed — 12 Sturt Street is inside the 9,102 m² lot its two neighbours
    // resolved to. Saying only "couldn't be placed" invites drawing a second outline over it.
    : `${parts.join("; ")} — not placed separately; check it isn't already inside the outline.`;
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "closeout";
}

export function CloseoutMarkupTool() {
  const [opportunity, setOpportunity] = useState<CloseoutOpportunity | null>(null);
  const [properties, setProperties] = useState<CloseoutProperty[]>([]);
  const [unmapped, setUnmapped] = useState<UnmappedWorkOrder[]>([]);
  const [skipped, setSkipped] = useState<SkippedWorkOrder[]>([]);
  const [councilAssets, setCouncilAssets] = useState<CouncilAsset[]>([]);
  const [workOrderCount, setWorkOrderCount] = useState(0);
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [parcels, setParcels] = useState<Map<string, ResolvedParcel>>(new Map());
  // The project site — resolved at Generate, because it costs a geocode. `siteNote` is what
  // could NOT be placed, which on a quarter of opportunities is everything (the field holds a
  // project name rather than an address on 25% of them).
  const [siteLots, setSiteLots] = useState<CloseoutSiteLot[]>([]);
  const [siteNote, setSiteNote] = useState<string | null>(null);
  // The inspection summary below the drawing, and with it the numbered pins ON the drawing.
  // ⚠️ ONE switch for both, because a pin's number means nothing without the list it indexes —
  // a client handed a drawing of numbered teardrops and no summary has no way to read it
  // (Rhys, 2026-09-18). Rides in the save file so a reopened drawing exports the same way.
  const [includeSummary, setIncludeSummary] = useState(true);
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
  // ⚠️ A COUNTER, not the clock. A fit key only has to differ from the last one, and calling an
  // impure function inside code the React compiler treats as render-reachable is something it
  // rejects outright — it only began reporting once the diagnose useMemo below let it analyse
  // this component further, but the smell was already there.
  const fitSeq = useRef(0);

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
  // What the DRAWING shows — the live map and the export read this, the sheet keeps its own
  // numbering either way (it is the operator's index, not the client's cross-reference).
  const drawnNumbers = useMemo(
    () => (includeSummary ? numbers : new Map<string, number>()),
    [includeSummary, numbers]
  );
  const selectedRows = rows.filter((r) => r.selected);
  const overCap = selectedRows.length > MAX_CLOSEOUT_LOTS;

  const lots = useMemo(
    () => [
      // The project site FIRST, so it sits under the inspected properties where they overlap it.
      // Colour `site`, not `red`: an unfilled outline, because red on this drawing already means
      // "closed, not inspected" and the site is the works rather than a property with a status.
      // It carries no number — `numbers` is keyed off the sheet's ticked rows and the site is
      // not one of them, so MarkupMap draws no badge for it.
      ...siteLots.map((l) => ({ id: l.id, ring: l.ring, color: "site" as const })),
      ...rows
        .filter((r) => r.selected && r.ring)
        .map((r) => ({ id: r.property.key, ring: r.ring!, color: r.property.color })),
    ],
    [rows, siteLots]
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
    setSiteLots([]);
    setSiteNote(null);
    setGenerated(false);
    setError(null);
    setFitRequest(null);
  }, []);

  const onResolved = useCallback(
    (data: {
      opportunity: CloseoutOpportunity;
      properties: CloseoutProperty[];
      unmapped: UnmappedWorkOrder[];
      skipped: SkippedWorkOrder[];
      councilAssets: CouncilAsset[];
      workOrderCount: number;
    }) => {
      reset();
      setOpportunity(data.opportunity);
      setProperties(data.properties);
      setUnmapped(data.unmapped);
      setSkipped(data.skipped);
      setCouncilAssets(data.councilAssets);
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
          // The works. Null on the 3% of opportunities with no site address at all, and the
          // route reports back whatever it could not place rather than guessing.
          site: opportunity.siteAddress,
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
        | { ok: boolean; parcels?: ResolvedParcel[]; site?: ResolvedCloseoutSite; error?: string }
        | null;
      if (!res.ok || !json?.parcels) throw new Error(json?.error ?? "Couldn't look up the boundaries.");
      if (run !== runRef.current) return;

      const map = new Map(json.parcels.map((p) => [p.key, p]));
      setParcels(map);
      const site = json.site ?? { lots: [], unresolved: [] };
      setSiteLots(site.lots);
      setSiteNote(siteNoteFor(site));
      setGenerated(true);
      // The site is framed WITH the properties: it is usually in the middle of them, but on a
      // job where the works sit at one end, leaving it out would frame it off the edge.
      frameFrom([...json.parcels, ...site.lots.map((l) => ({ ring: l.ring, point: l.point }))], `${opportunity.id}:${++fitSeq.current}`);
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
        neighbours: [
          // The project site, drawn first so the inspected properties sit over it. `label: ""`
          // means no badge: the numbers are quote-style item numbers over the sheet's ticked
          // rows, and the site is not one of them.
          ...siteLots.map((l) => ({
            id: l.id,
            ring: l.ring,
            areaSqm: l.areaSqm,
            label: "",
            street: l.address,
            suburb: opportunity?.siteAddress?.suburb ?? null,
            color: "site" as const,
          })),
          ...rows
            .filter((r) => r.selected && r.ring)
            .map((r) => ({
              id: r.property.key,
              ring: r.ring!,
              areaSqm: r.areaSqm,
              label: String(drawnNumbers.get(r.property.key) ?? ""),
              street: r.property.street,
              suburb: r.property.suburb,
              color: r.property.color,
            })),
        ],
        points: rows
          .filter((r) => r.selected && !r.ring)
          .map((r) => ({
            id: r.property.key,
            at: r.point,
            label: String(drawnNumbers.get(r.property.key) ?? ""),
            color: r.property.color,
          })),
        // The site row is added only when a site is actually drawn — the renderer filters the
        // key to colours on the drawing anyway, but keeping the caller honest costs nothing.
        legend: siteLots.length > 0 ? [...CLOSEOUT_LEGEND, SITE_LEGEND_ROW] : CLOSEOUT_LEGEND,
        // ⚠️ TRUE whether or not there is a summary. The key belongs below the drawing either
        // way; inferring the band from the schedule is what let it drift back over a property.
        keyInBand: true,
        // The summary below the drawing: what a client needs to read it. Numbers come from the
        // SAME derivation as the pins and the sheet, and the colour is the property's own, so a
        // row, a pin and an outline can never disagree about which property is item 12.
        //
        // Row order, which is the sheet's order (suburb then street, numeric-aware), so the list
        // reads like a walk down the job rather than like Salesforce's record order.
        //
        // Empty when the operator turned it off — and `drawnNumbers` is empty in step, so the
        // pins go with it.
        schedule: includeSummary
          ? rows
              .filter((r) => r.selected)
              .map((r) => ({
                label: String(numbers.get(r.property.key) ?? ""),
                street: r.property.suburb ? `${r.property.street}, ${r.property.suburb}` : r.property.street,
                color: r.property.color,
              }))
          : [],
        scheduleTitle: "Inspection summary",
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
        councilAssets,
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
        siteLots,
        includeSummary,
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
    // Not stored: a billing line is not part of a drawing, so a reopened file has nothing to
    // say about one. `unmapped` IS stored — those are real inspections missing from the picture.
    setSkipped([]);
    setCouncilAssets(parsed.file.councilAssets);
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
    // Restored, never re-resolved: re-geocoding on open would spend a call AND could hand back
    // a different parcel from the one that was signed off. Files saved before the project site
    // existed simply have none, and open exactly as they did.
    setSiteLots(parsed.file.siteLots);
    setSiteNote(null);
    setIncludeSummary(parsed.file.includeSummary);
    // The hand-drawn shapes. ⚠️ They were saved and then dropped here — nothing restored them —
    // so a council asset or a hand-drawn project site vanished on reopen.
    shapes.replaceAll(parsed.file.shapes);
    setGenerated(true);
    frameFrom(
      [...parsed.file.properties, ...parsed.file.siteLots.map((l) => ({ ring: l.ring, point: l.point }))],
      `open:${++fitSeq.current}`
    );
    if (parsed.skipped > 0) {
      setError(`${parsed.skipped} propert${parsed.skipped === 1 ? "y" : "ies"} in that file couldn't be read and were skipped.`);
    }
  }

  const counts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const r of rows) acc[r.property.color] = (acc[r.property.color] ?? 0) + 1;
    return acc;
  }, [rows]);

  // Why there is no drawing, when there is no drawing. Null the moment there is one property to
  // draw — at which point the sheet and its own per-row notes take over.
  const blocker = useMemo(
    () =>
      opportunity
        ? diagnoseCloseout({
            opportunityName: opportunity.name,
            workOrderCount,
            propertyCount: properties.length,
            skipped,
            unmapped,
            councilAssets,
          })
        : null,
    [opportunity, workOrderCount, properties.length, skipped, unmapped, councilAssets]
  );

  // A disabled button with no reason reads as a broken tool.
  const blockedReason = generateBlockedReason(selectedRows.length, rows.length, MAX_CLOSEOUT_LOTS);

  return (
    <div>
      <OpportunityCard onResolved={onResolved} onReset={reset} opportunity={opportunity} workOrderCount={workOrderCount} />

      {blocker && <CannotDraw blocker={blocker} opportunityUrl={opportunity?.url ?? null} />}

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
            {/* One switch, two things — the numbered pins are only readable against this list, so
                they come off with it. Said on the label so nobody has to discover it. */}
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-ad-ink">
              <input
                type="checkbox"
                checked={includeSummary}
                onChange={(e) => setIncludeSummary(e.target.checked)}
                className="size-4 shrink-0 accent-ad-steel"
              />
              Inspection summary <span className="text-ad-muted">(and numbered pins)</span>
            </label>
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
            {!error && blockedReason && <span className="text-sm text-ad-orange">{blockedReason}</span>}
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
            {councilAssets.length > 0 && (
              <>
                {" · "}
                <span className="font-medium">{councilAssets.length}</span> council asset
                {councilAssets.length === 1 ? "" : "s"}
              </>
            )}
          </p>

          {/* The exceptions, muted and only when there are any. Two different things: a skipped
              row was never an inspection, an unplaced one was. Reading them as one number would
              make a clean job look like it had problems. */}
          {(skipped.length > 0 || unmapped.length > 0) && (
            <p className="mt-1 text-xs text-ad-muted">
              {skipped.length > 0 && (
                <>{`${skipped.length} billing or admin work order${skipped.length === 1 ? "" : "s"} skipped`}</>
              )}
              {skipped.length > 0 && unmapped.length > 0 && " · "}
              {/* Template literals, not JSX text: JSX drops the space between an expression and
                  text that follows it across a line break, which is how "1couldn't be placed"
                  shipped once already. */}
              {unmapped.length > 0 && (
                <span className="text-ad-orange">{`${unmapped.length} couldn't be placed`}</span>
              )}
            </p>
          )}

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

          {/* The project site, said out loud. It is the one outline on the drawing with no number
              and no sheet row, so without this line there is nothing to explain the red edge —
              and when it could NOT be placed (a quarter of opportunities carry a project name in
              that field rather than an address) that is the only place it is reported. */}
          {generated && (siteLots.length > 0 || siteNote) && (
            <p className={cn("mt-1.5 text-sm", siteNote ? "text-ad-orange" : "text-ad-muted")}>
              <span aria-hidden className="mr-1.5 inline-block size-2.5 rounded-full border-2 align-middle" style={{ borderColor: `#${MARKUP_STYLES.site.stroke}` }} />
              {siteLots.length > 0
                ? `Project site: ${siteLots.map((l) => l.address).join(", ")}`
                : "Project site"}
              {siteNote ? ` · ${siteNote}` : null}
            </p>
          )}

          {generated && (
            <div className={cn("mt-6 flex flex-col gap-4 xl:flex-row xl:items-start", BREAKOUT_XL)}>
              <div className="relative w-full min-w-0 xl:flex-1">
                {/* Panning away from the framing is easy and the export takes whatever the map
                    is left on, so there has to be a way back to it. Ticking rows changes what
                    is drawn WITHOUT moving the camera — yanking it while someone works through
                    a 39-row sheet would be worse — so this is how the frame catches up. */}
                <button
                  type="button"
                  onClick={() => frameFrom(rows.filter((r) => r.selected), `fit:${++fitSeq.current}`)}
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
                  numbers={
                    // ⚠️ drawnNumbers, not numbers. With the summary off the export carries no
                    // pins, so the preview must not show any either — an operator who frames a
                    // drawing with pins visible and downloads one without them has been misled.
                    drawnNumbers
                  }
                  pickMode={false}
                  onPick={() => {}}
                  fitRequest={fitRequest}
                />
              </div>
              <div className="w-full space-y-4 xl:w-80 xl:shrink-0">
                <ShapePanel shapes={shapes} commands={mapRef} palette={CLOSEOUT_SHAPE_PALETTE} />
              </div>
            </div>
          )}

          <StatusTable
            rows={rows}
            onToggle={toggle}
            onToggleAll={toggleAll}
            onExport={() => downloadBlob(closeoutCsv(rows), `${filenameStem}.csv`, "text/csv;charset=utf-8")}
            capped={overCap}
            max={MAX_CLOSEOUT_LOTS}
          />
        </>
      )}

      {/* ⚠️ OUTSIDE the properties check. Everything the automatic pass could not draw, with the
          reference image for each — and a job whose work orders are ALL council assets needs these
          more than any other, while having no properties at all. They were behind the same gate as
          the toolbar, so on exactly that job the links the operator was told to open did not
          render. Never folded away either: hiding them would let a closeout look complete when it
          is not. */}
      {(councilAssets.length > 0 || unmapped.length > 0) && (
        <DrawByHand councilAssets={councilAssets} unmapped={unmapped} />
      )}
    </div>
  );
}
