"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { SyncToSalesforce } from "@/components/tools/shared/sync-to-salesforce";
import { downloadBlob } from "@/components/tools/shared/download";
import { fileToBase64 } from "@/components/tools/shared/file-to-base64";
import {
  buildBuildingMarkupFile,
  parseBuildingMarkupFile,
  type BuildingMarkupFile,
} from "@/lib/maps/building-markup-file";
import { AddressSearch, type PlaceSelection } from "@/components/tools/shared/address-search";
import { parseGoogleMapsUrl, type GoogleMapsTarget } from "@/lib/maps/parse-google-maps-url";
import { mapPool } from "@/lib/util/map-pool";
import { ShapePanel } from "./shape-panel";
import {
  useShapes,
  MIN_POINTS,
  MAX_SHAPE_POINTS,
  MAX_SHAPE_WIDTH_M,
  MIN_SHAPE_WIDTH_M,
} from "./shapes";
import { MarkupMap, type MarkupMapCommands } from "./markup-map";
import { SITE_RED, markupColor, type MarkupColorKey } from "@/lib/kml/standard-markup/style";
import { LineItemsTable } from "@/components/tools/shared/quote-lines/line-items-table";
import { BREAKOUT_XL } from "@/components/tools/shared/quote-lines/styles";
import { StreetViewLink } from "./street-view-link";
import { SUBJECT_KEY, layerAnchor, layersFrom, lotKey, shapeKey } from "@/lib/markup-layers/plan";
import { initialDeselected, itemNumbers, rowsFrom, type LineItemDraft, type LineItemDrafts } from "@/lib/markup-layers/line-items";
import { sourcesFromLayers } from "@/lib/markup-layers/sources/from-layers";
import { applyCell, toggleDeselected } from "@/lib/markup-layers/drafts";
import type { MarkupLayer } from "@/lib/markup-layers/types";
import { formatArea } from "@/lib/kml/standard-markup/measure";
import type { StoreyResult } from "@/lib/storeys/street-view-storeys";
import { lotPlanFromId } from "@/lib/kml/standard-markup/parcels/parcel-id";
import { pointInRing } from "@/lib/kml/standard-markup/geometry";

const STATES = [
  { key: "QLD", label: "QLD", disabled: false },
  { key: "NSW", label: "NSW", disabled: false },
  { key: "VIC", label: "VIC", disabled: false },
  { key: "SA", label: "SA", disabled: true },
  { key: "WA", label: "WA", disabled: true },
  { key: "TAS", label: "TAS", disabled: true },
  { key: "ACT", label: "ACT", disabled: true },
  { key: "NT", label: "NT", disabled: true },
] as const;

type SupportedState = "QLD" | "NSW" | "VIC";
type MapType = "satellite" | "hybrid" | "roadmap";

const MAP_TYPE: MapType = "hybrid";

interface LatLng {
  lat: number;
  lng: number;
}

interface Neighbour {
  id: string;
  ring: LatLng[];
  areaSqm: number | null;
  /** Red for the address a multi-property markup was searched from; absent = blue. */
  color?: MarkupColorKey;
  /** From the state's address layer — see lib/kml/standard-markup/parcels/addresses.ts.
   *  Null when the layer had nothing for this lot, or the lookup failed. */
  street?: string | null;
  suburb?: string | null;
  /** From the Street View storeys check (DEV). Null until checked or when it found nothing. */
  storeys?: number | null;
}

interface GenerateResponse {
  subjectRing: LatLng[];
  /** The subject parcel's own lot/plan and area. Optional because a markup restored from a
   *  version-1 save file predates them. */
  subjectLotPlan?: string | null;
  subjectAreaSqm?: number | null;
  neighbours: Neighbour[];
  matchedAddress: string | null;
  mapType: MapType;
  flags: string[];
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "standard-markup"
  );
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const bytes = atob(base64);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type: mimeType });
}

/**
 * "single" is Building Markup: one address, its lot in red, the cadastre's adjoining lots in
 * blue. "multi" is the *DEV* tab's multi-property markup: a pasted list of addresses, every one
 * a blue lot, no red project site. Same component, same map, same sheet, same export — the
 * mode changes how lots are found and what the form asks for, and nothing else.
 */
export type MarkupMode = "single" | "multi";

/** More listed addresses than this and the job is a spreadsheet, not a drawing — the sheet is
 *  the work and the map is in the way (and a billed Dynamic Maps load nobody looks at). */
const MANY_ADDRESSES = 10;

export function ResidentialMarkupTab({ mode = "single", dev = false }: { mode?: MarkupMode; dev?: boolean }) {
  const multi = mode === "multi";
  /** The pasted address list — multi mode only. */
  const [addressBlock, setAddressBlock] = useState("");
  /** Multi mode: an address added from the SEARCH bar also brings its adjoining lots, the way
   *  Building Markup's "Detected lots" do. Written into the list as a leading "+" so the two
   *  kinds of line — a job site with its neighbours, a listed property on its own — sit in one
   *  box and the server can tell them apart. A pasted list never gets the marker. */
  const [preselectSurrounding, setPreselectSurrounding] = useState(true);
  /** Multi mode: the address card folds away to one line once a markup exists — most jobs are
   *  a single address, and the list is in the way while the quote is being worked. */
  const [addressesOpen, setAddressesOpen] = useState(true);
  /** Multi mode: the screenshot drop zone's state. */
  const [shotBusy, setShotBusy] = useState(false);
  const [shotDrag, setShotDrag] = useState(false);
  const [shotNote, setShotNote] = useState<string | null>(null);
  const shotInput = useRef<HTMLInputElement>(null);
  const [street, setStreet] = useState("");
  const [suburb, setSuburb] = useState("");
  const [postcode, setPostcode] = useState("");
  const [state, setState] = useState<SupportedState>("QLD");
  const [manualEntry, setManualEntry] = useState(false);
  const [parsedSummary, setParsedSummary] = useState<string | null>(null);
  const [addressPoint, setAddressPoint] = useState<LatLng | null>(null);
  /** Progress and advice for a pasted link. Separate from addressError, which is orange and
   *  disables Generate — neither is right for "following that share link…". */
  const [addressNote, setAddressNote] = useState<string | null>(null);
  /** A heading is only meaningful for the point it was measured from, so it is stored WITH that
   *  point's key and matched during render. That makes a stale heading structurally impossible —
   *  change address and the old key no longer matches, so it is ignored rather than having to be
   *  cleared. Which also keeps the effect free of a synchronous setState, the thing the React
   *  compiler lint rejects. */
  const [siteHeadingFor, setSiteHeadingFor] = useState<{ key: string; heading: number } | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flags, setFlags] = useState<string[]>([]);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  /** Coordinate lines in the address list with no titled parcel under them (a community centre,
   *  a reserve — places Google has no street address for). The map is centred on them and the
   *  site is drawn by hand. Not in the save file: the shapes drawn there are, and reopening
   *  frames those instead. */
  const [centres, setCentres] = useState<{ point: LatLng; label: string }[]>([]);
  /** "Line items only, no map" — offered when the list is long (MANY_ADDRESSES), on by default.
   *  `lineItemsOnly` is the checkbox; `mapHidden` is what Generate did with it, so editing the
   *  list afterwards doesn't pop the map in and out under the sheet. DEV tab only for now. */
  const [lineItemsOnly, setLineItemsOnly] = useState(true);
  const [mapHidden, setMapHidden] = useState(false);

  /** Writes the address list and, past MANY_ADDRESSES, unticks "Pre-select surrounding assets".
   *  The checkbox only ever affects a search-bar pick, so on a long pasted list it does nothing —
   *  but a ticked box beside 100 rows reads as a promise about them (Rhys, 2026-09-14). Called
   *  from the paste box and the screenshot drop; a single search-bar pick is one line and is
   *  left alone. */
  function setAddressList(next: string) {
    setAddressBlock(next);
    if (dev && next.split(/\r?\n/).filter((l) => l.trim()).length > MANY_ADDRESSES) setPreselectSurrounding(false);
  }
  /** Addresses that resolved to nothing, for the "Map hidden" bar — the flags box that would
   *  otherwise carry them is off in multi mode, and a row that isn't there is invisible. */
  const [unresolved, setUnresolved] = useState<{ raw: string; reason: string }[]>([]);
  /** The Street View storeys check (DEV): progress while it runs, a summary when it is done.
   *  `storeysRun` is bumped by every Generate / Open so a slow batch from the previous markup
   *  cannot write into this one. */
  const [storeysNote, setStoreysNote] = useState<string | null>(null);
  const storeysRun = useRef(0);
  /** "Resolving addresses… 50/120" while a long list is paged through. */
  const [progress, setProgress] = useState<string | null>(null);
  /** Google's own viewport for each place added from the search, keyed by the coordinate text
   *  written into the list — so Generate can open the map on the view Google Maps showed. A
   *  ref, not state: nothing renders from it, and it is read once per Generate. Lost on reload,
   *  in which case the centre is framed by a small box instead. */
  const placeViews = useRef(new Map<string, { south: number; west: number; north: number; east: number }>());
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  // Matches the excludedIds convention: state records what's been REMOVED, so a fresh
  // snapshot starts with everything the lookup found.
  const [hideSubject, setHideSubject] = useState(false);
  // The live map. A ref, not state: the only things the tab asks of it are "give me the
  // camera" (at export time) and "frame this geometry" (after a resolve).
  const mapRef = useRef<MarkupMapCommands>(null);
  // "Frame this geometry, once." See MarkupMap's fitRequest prop.
  const [fitRequest, setFitRequest] = useState<{ key: string; rings: LatLng[][] } | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickBusy, setPickBusy] = useState(false);
  const [pickMessage, setPickMessage] = useState<string | null>(null);
  /** How many lots this run of pick mode has added, for the "3 added" note. */
  const [pickedCount, setPickedCount] = useState(0);
  /** The live result, for handlePick. Pick mode STAYS ON, so two lots can be in flight at
   *  once and a handler closing over `result` would add the second to a list that predates
   *  the first — dropping it silently. */
  const resultRef = useRef(result);
  useEffect(() => {
    resultRef.current = result;
  });
  const shapes = useShapes();
  const fileInput = useRef<HTMLInputElement>(null);
  // The sheet's cells. Sparse — see lib/markup-layers/line-items.ts.
  const [lineDrafts, setLineDrafts] = useState<LineItemDrafts>({});
  // Which rows are NOT going to sync. Records what was de-selected rather than what was
  // selected, so a newly drawn shape arrives ticked without anything having to remember it —
  // the same convention as excludedIds and hideSubject above.
  const [deselected, setDeselected] = useState<Set<string>>(new Set());

  /** How a row in the Detected lots list reads. formatArea() rather than a local template so
   *  the sidebar, the sheet and the exported legend can't quote the same lot differently. */
  function lotRowText(name: string, areaSqm: number | null): string {
    return areaSqm ? `${name} — ${formatArea(areaSqm)}` : name;
  }

  function lotRowLabel(n: Neighbour): string {
    return lotRowText(n.street || lotPlanFromId(n.id) || "Lot", n.areaSqm);
  }

  /** The item number for a layer, or null when it isn't a line item. */
  const numberFor = (key: string) => numbers.get(key) ?? null;

  /** The numbered bubble, or a blank of the same size so the rows below it don't shift.
   *
   *  Nothing without a number gets a bubble — an unticked lot used to keep showing an orange
   *  badge beside its unchecked box, which read as "item 2" for something deliberately left out
   *  of the quote. */
  function rowBadge(key: string, color: string) {
    const n = numberFor(key);
    if (n === null) return <span className="h-5 w-5 shrink-0" aria-hidden />;
    return (
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
        style={{ backgroundColor: color }}
      >
        {n}
      </span>
    );
  }

  /** The project-site row reads the same way as the lots below it — the red swatch and the
   *  top position already say which one it is, so spending the text on "Project site" said
   *  nothing the row wasn't already showing. Uses the TYPED address, not a looked-up one:
   *  it is the address the job is under, and a corner lot has several valid frontages. */
  function subjectRowLabel(): string {
    const name = street.trim() || result?.subjectLotPlan || "Project site";
    return lotRowText(name, result?.subjectAreaSqm ?? null);
  }

  // The sheet's rules (product change clears the asset-type override, and so on) live in
  // lib/markup-layers/drafts.ts, shared with every other tool that hosts the sheet.
  const setLineCell = (key: string, field: keyof LineItemDraft, value: string) =>
    setLineDrafts((prev) => applyCell(prev, key, field, value));

  const toggleRow = (key: string) => setDeselected((prev) => toggleDeselected(prev, key));

  const toggleAllRows = (select: boolean) =>
    setDeselected(select ? new Set() : new Set(sources.filter((s) => s.included).map((s) => s.key)));

  /** base64 of a UTF-8 string — plain btoa() throws on an accented address. */
  function toBase64(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }

  /** The save file: the RESOLVED geometry, not just the address. Re-resolving on open would
   *  hand back whatever the cadastre says today, which is not the drawing that was signed
   *  off — and would re-pay the geocode and ArcGIS lookup. */
  function currentFile(): BuildingMarkupFile | null {
    if (!result) return null;
    return buildBuildingMarkupFile({
      address: { street, suburb, postcode, state },
      matchedAddress: result.matchedAddress,
      mapType: result.mapType,
      subjectRing: result.subjectRing,
      subjectLotPlan: result.subjectLotPlan ?? null,
      subjectAreaSqm: result.subjectAreaSqm ?? null,
      neighbours: result.neighbours,
      excludedIds: Array.from(excludedIds),
      hideSubject,
      // Not payload(): that strips the id, and the id is the join key a re-sync needs to
      // recognise this shape's line item instead of creating a second one.
      shapes: shapes.shapes
        .filter((a) => a.points.length >= MIN_POINTS[a.mode])
        .map(({ id, mode, widthMetres, color, points }) => ({ id, mode, widthMetres, color, points })),
      lineItems: lineDrafts,
      deselected: Array.from(deselected),
    });
  }

  function saveFileJson(): string | null {
    const file = currentFile();
    return file ? JSON.stringify(file, null, 2) : null;
  }

  // The sheet's rows come from the SAME file the tool saves and the offline harness reads, so
  // what an estimator sees on screen and what scripts/dry-run-line-items.ts prints can never
  // be two different mappings.
  const file = currentFile();
  const layers: MarkupLayer[] = file ? layersFrom(file) : [];
  const sources = sourcesFromLayers(layers);
  // ONE numbering, derived once and shared by the sheet, the sidebar badges, the live map and the
  // export payload — so all four can never disagree about what item 2 is.
  const rows = rowsFrom(sources, lineDrafts, deselected);
  const numbers = itemNumbers(rows);

  // Street View's target for the markup as a whole. The resolved parcel wins — it is the actual
  // title boundary rather than a geocoder's guess — but the Places point covers the gap before
  // Generate, so the address can be looked at the moment it is typed.
  const subjectLayer = layers.find((l) => l.kind === "subject");
  // Multi mode has no subject. With exactly ONE address in the list, Street View aims at that
  // property — the red lot if the address brought its neighbours in, else the only lot. With
  // several addresses there is no single place to look, so the button stays greyed out.
  const listedAddresses = multi ? addressBlock.split(/\r?\n/).filter((l) => l.trim()).length : 0;
  const offerNoMap = dev && multi && listedAddresses > MANY_ADDRESSES;
  const singleLot =
    multi && result && listedAddresses === 1
      ? (result.neighbours.find((n) => n.color === "red") ?? result.neighbours[0] ?? null)
      : null;
  const singleLotLayer = singleLot ? layers.find((l) => l.key === lotKey(singleLot.id)) ?? null : null;
  // A lone address with no parcel still has a point — the one the map was centred on.
  const singleCentre = multi && result && listedAddresses === 1 && !singleLot ? (centres[0] ?? null) : null;
  const sitePoint = multi
    ? singleLotLayer
      ? layerAnchor(singleLotLayer)
      : (singleCentre?.point ?? null)
    : ((subjectLayer ? layerAnchor(subjectLayer) : null) ?? addressPoint);
  const streetViewLabel = multi
    ? (singleLot?.street ?? singleCentre?.label ?? "the property")
    : (street.trim() || "the project site");
  // A primitive key, not the object: sitePoint is derived every render, so depending on its
  // identity would refetch forever.
  const sitePointKey = sitePoint ? `${sitePoint.lat.toFixed(6)},${sitePoint.lng.toFixed(6)}` : null;

  // Which way Street View has to look to see the site. One metadata lookup per target, and the
  // button is a working link before it lands — see streetViewUrl for why the heading has to be
  // asked for rather than left to Google.
  useEffect(() => {
    if (!sitePointKey) return;
    let live = true;
    const [lat, lng] = sitePointKey.split(",").map(Number);
    void fetch("/api/maps/street-view", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lat, lng }),
    })
      .then((r) => r.json())
      .then((j: { ok?: boolean; heading?: number | null }) => {
        if (live && j?.ok && typeof j.heading === "number") {
          setSiteHeadingFor({ key: sitePointKey, heading: j.heading });
        }
      })
      // Silent: an unaimed Street View link is a fine outcome, and there is nothing the operator
      // could do about a metadata miss anyway.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [sitePointKey]);

  const siteHeading = siteHeadingFor?.key === sitePointKey ? siteHeadingFor.heading : null;

  function saveJson() {
    const doc = saveFileJson();
    if (!doc) return;
    downloadBlob(
      doc,
      `${slugify(street)}-${slugify(suburb)}-standard-markup.json`,
      "application/json"
    );
  }

  async function openJson(file: File) {
    setError(null);
    const parsed = parseBuildingMarkupFile(await file.text(), {
      maxShapePoints: MAX_SHAPE_POINTS,
      maxRingPoints: 2000,
      minWidth: MIN_SHAPE_WIDTH_M,
      maxWidth: MAX_SHAPE_WIDTH_M,
    });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const f = parsed.file;
    setStreet(f.address.street);
    setSuburb(f.address.suburb);
    setPostcode(f.address.postcode);
    const supported = STATES.find((st) => st.key === f.address.state && !st.disabled);
    if (supported) setState(f.address.state as SupportedState);
    setParsedSummary(f.matchedAddress ?? null);
    setAddressError(null);
    setExcludedIds(new Set(f.excludedIds));
    setHideSubject(f.hideSubject);
    shapes.replaceAll(f.shapes);
    setCentres([]);
    setMapHidden(false);
    storeysRun.current++;
    setStoreysNote(null);
    setLineDrafts(f.lineItems ?? {});
    setDeselected(new Set(f.deselected ?? []));
    setResult({
      subjectRing: f.subjectRing,
      subjectLotPlan: f.subjectLotPlan ?? null,
      subjectAreaSqm: f.subjectAreaSqm ?? null,
      neighbours: f.neighbours,
      matchedAddress: f.matchedAddress,
      mapType: f.mapType,
      flags: [],
    });
    // A saved frame is no longer stored or honoured — the map is live, so the operator points
    // it wherever they want. Frame the geometry the file actually contains instead.
    // Shapes count too: a markup drawn by hand around a place with no parcel has nothing else
    // to frame, and would otherwise reopen on the map's default centre.
    frameGeometry(f.subjectRing, f.neighbours, new Set(f.excludedIds), f.shapes.map((sh) => sh.points));
    setFlags(
      parsed.skippedShapes > 0
        ? [`${parsed.skippedShapes} shape(s) in that file couldn't be read and were skipped`]
        : []
    );
  }

  /** Asks the map to frame the subject plus every included lot.
   *
   *  Called after a resolve and after Open .json — the two moments where new geometry arrives
   *  that the operator hasn't framed themselves. Never on a checkbox or a shape edit: moving
   *  the camera under someone mid-edit is exactly the behaviour a live map exists to avoid.
   *
   *  A keyed REQUEST rather than a direct call, because on the first snapshot the map is still
   *  loading when this runs — see the fitRequest prop. */
  function frameGeometry(subjectRing: LatLng[], neighbours: Neighbour[], excluded: Set<string>, extra: LatLng[][] = []) {
    const rings = [subjectRing, ...neighbours.filter((n) => !excluded.has(n.id)).map((n) => n.ring), ...extra];
    // Two points still frame something — a drawn line, or the box around a centre.
    setFitRequest({ key: crypto.randomUUID(), rings: rings.filter((r) => r.length >= 2) });
  }

  /** The key a place's coordinate is written under — the same text `handleAddressSelect` puts
   *  in the list, so the server's parsed point maps straight back to the viewport. */
  function pointKey(p: LatLng): string {
    return `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
  }

  /** What to frame for a centre: the viewport Google Maps showed for the place, else a ~130 m
   *  box around the point — close enough to start drawing without zooming. */
  function frameFor(p: LatLng): LatLng[] {
    const v = placeViews.current.get(pointKey(p));
    if (v) return [{ lat: v.south, lng: v.west }, { lat: v.north, lng: v.east }];
    return boxAround(p);
  }

  function boxAround(p: LatLng): LatLng[] {
    const dLat = 0.0006;
    const dLng = dLat / Math.cos((p.lat * Math.PI) / 180);
    return [
      { lat: p.lat - dLat, lng: p.lng - dLng },
      { lat: p.lat + dLat, lng: p.lng + dLng },
    ];
  }

  // A callback rather than a plain function because applyTarget below memoises over it — and
  // it now reads `multi`, so it has to be a dependency instead of a closure that could go stale.
  const handleAddressSelect = useCallback((parsed: PlaceSelection) => {
    if (multi) {
      // Multi mode: a searched address joins the list rather than becoming THE address.
      const tail = [parsed.suburb, parsed.state, parsed.postcode].filter(Boolean).join(" ");
      let line: string;
      if (parsed.street && !parsed.place) {
        line = [parsed.street, tail].filter(Boolean).join(", ");
      } else if (parsed.location) {
        // A PLACE, not an address — a community centre, a reserve, a shopping centre; Google's
        // own typing says so (`place`), or it has no street at all. Nothing is looked up for
        // it: the list takes its COORDINATE, labelled with the name the search showed, and
        // Generate opens the map on the view Google Maps had (the viewport remembered here),
        // with nothing pre-selected, for the site to be drawn by hand. So the surrounding-lots
        // checkbox comes off — there is no parcel for neighbours to adjoin.
        const name = (parsed.label ?? "").replace(/,?\s*australia\s*$/i, "").trim();
        line = `${pointKey(parsed.location)} ${name || tail}`.trim();
        if (parsed.viewport) placeViews.current.set(pointKey(parsed.location), parsed.viewport);
        setPreselectSurrounding(false);
        setAddressBlock((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")}\n${line}` : line));
        setAddressError(null);
        setAddressNote(null);
        return;
      } else {
        setAddressError("Google has neither a street address nor a location for that place — try a nearby address.");
        return;
      }
      const entry = preselectSurrounding ? `+ ${line}` : line;
      setAddressBlock((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")}\n${entry}` : entry));
      setAddressError(null);
      setAddressNote(null);
      return;
    }
    // Kept only so Street View can be opened on the typed address before a snapshot exists.
    // Nothing else uses it: the cadastre lookup goes by address text and the map frames itself
    // from the resolved rings, so a Places centroid has no say in either.
    setAddressPoint(parsed.location);
    setAddressNote(null);
    setStreet(parsed.street);
    setSuburb(parsed.suburb);
    setPostcode(parsed.postcode);
    setParsedSummary(
      [parsed.street, parsed.suburb, parsed.postcode, parsed.state].filter(Boolean).join(" · ")
    );
    const supported = STATES.find((s) => s.key === parsed.state && !s.disabled);
    if (supported) {
      setState(parsed.state as SupportedState);
      setAddressError(null);
    } else {
      setAddressError(`This tool doesn't support ${parsed.state || "that state"} yet — enter the address manually.`);
    }
  }, [multi, preselectSurrounding]);

  /**
   * A pasted Google Maps link or `lat, lng` pair, handled the same way the Measure tab handles
   * one — except this tab needs an ADDRESS, not just a coordinate: the cadastre lookup is by
   * street/suburb/state. So a coordinate is reverse-geocoded and then flows through
   * handleAddressSelect exactly as a Places pick would.
   *
   * A place NAME is handed straight back as a string, which tells AddressSearch to search it
   * instead — Places parses the components properly and costs nothing extra.
   *
   * ⚠️ The pasted point is kept for Street View even when the reverse geocode fails. "Look at
   * where this link points" is the one thing a bare coordinate can always deliver, and losing it
   * because Google had no street address for a paddock would be the wrong trade.
   */
  const applyTarget = useCallback(async (target: GoogleMapsTarget): Promise<boolean | string> => {
    if (target.kind === "query") return target.query;

    if (target.kind === "shortlink") {
      // maps.app.goo.gl — only a redirect knows where it points, and the browser can't read a
      // cross-origin Location header. Same server hop the Measure tab makes.
      setAddressNote("Following that share link…");
      const res = await fetch("/api/maps/resolve-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: target.url }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; target?: GoogleMapsTarget; error?: string }
        | null;
      if (!json?.ok || !json.target) {
        setAddressNote(null);
        setAddressError(json?.error ?? "Couldn't resolve that share link.");
        return true;
      }
      return applyTarget(json.target);
    }

    if (multi && target.placeName) {
      // A /maps/place/<name>/@… link says WHAT was copied, so the name goes to the search and
      // Google types it — a place becomes a map centre, an address an address — instead of
      // reverse-geocoding the VIEW centre, which is whatever lot happened to be mid-screen (for
      // the Don Moore Community Centre: the one across the road). The link's own view is kept
      // for the place's point so Generate opens on exactly what was on screen in Google Maps.
      const anchor = target.pin ?? { lat: target.lat, lng: target.lng };
      if (target.spanMetres) {
        const dLat = target.spanMetres / 2 / 111_320;
        const dLng = dLat / Math.cos((anchor.lat * Math.PI) / 180);
        placeViews.current.set(pointKey(anchor), {
          south: target.lat - dLat,
          west: target.lng - dLng,
          north: target.lat + dLat,
          east: target.lng + dLng,
        });
      }
      return target.placeName;
    }

    const point = { lat: target.lat, lng: target.lng };
    setAddressPoint(point);
    setAddressNote("Looking up that location…");
    const res = await fetch("/api/maps/reverse-geocode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(point),
    });
    const json = (await res.json().catch(() => null)) as
      | ({ ok: true } & PlaceSelection)
      | { ok: false; error?: string }
      | null;
    if (!json?.ok) {
      setAddressNote(null);
      setAddressError(
        `${json && "error" in json && json.error ? json.error : "Couldn't read an address from that link."} Street View still works from the pasted location.`
      );
      return true;
    }
    handleAddressSelect(json);
    return true;
  }, [handleAddressSelect, multi]);

  const handlePaste = useCallback(
    async (text: string): Promise<boolean | string> => {
      const target = parseGoogleMapsUrl(text);
      setAddressNote(null);
      setAddressError(null);
      if (!target) {
        setAddressError("That doesn't look like a Google Maps link or a coordinate pair.");
        return true;
      }
      return applyTarget(target);
    },
    [applyTarget]
  );

  async function generate() {
    setError(null);
    setFlags([]);
    if (!street.trim() || !suburb.trim()) {
      setError("Enter the street address and suburb.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/kml/standard-markup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ street, suburb, postcode: postcode || undefined, state, mapType: MAP_TYPE }),
      });
      const json = (await res.json().catch(() => null)) as (GenerateResponse & { ok: boolean; error?: string }) | null;
      if (!res.ok || !json) {
        setError(json?.error ?? "Something went wrong generating the snapshot.");
        return;
      }
      setResult(json);
      setCentres([]);
      setMapHidden(false);
      storeysRun.current++;
      setStoreysNote(null);
      setExcludedIds(new Set());
      setHideSubject(false);
      setLineDrafts({});
      // The site starts unticked — see sourcesFromLayers. Seeded from the same rule the sheet
      // uses, off the freshly resolved geometry, so the two can't disagree.
      setDeselected(
        initialDeselected(
          sourcesFromLayers(
            layersFrom(
              buildBuildingMarkupFile({
                address: { street, suburb, postcode, state },
                matchedAddress: json.matchedAddress,
                mapType: json.mapType,
                subjectRing: json.subjectRing,
                subjectLotPlan: json.subjectLotPlan ?? null,
                subjectAreaSqm: json.subjectAreaSqm ?? null,
                neighbours: json.neighbours,
                excludedIds: [],
                hideSubject: false,
                shapes: [],
              })
            )
          )
        )
      );
      shapes.reset();
      setFlags(json.flags);
      frameGeometry(json.subjectRing, json.neighbours, new Set());
      setPicking(false);
      setPickMessage(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  /** Multi mode: a screenshot of an address list is read by the vision pass and its lines
   *  APPENDED to the paste box — never straight onto the markup, so a misread digit is caught
   *  in the box rather than on the drawing. */
  async function readScreenshot(file: File) {
    if (!file.type.startsWith("image/")) {
      setShotNote("That doesn't look like an image.");
      return;
    }
    setShotBusy(true);
    setShotNote("Reading the screenshot…");
    try {
      const image = await fileToBase64(file);
      const res = await fetch("/api/kml/standard-markup/addresses-from-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image }),
      });
      const json = (await res.json().catch(() => null)) as { ok: boolean; lines?: string[]; error?: string } | null;
      if (!res.ok || !json?.ok || !json.lines) {
        setShotNote(json?.error ?? "Couldn't read that screenshot.");
        return;
      }
      if (json.lines.length === 0) {
        setShotNote("No addresses found in that screenshot.");
        return;
      }
      const block = json.lines.join("\n");
      setAddressList(addressBlock.trim() ? `${addressBlock.replace(/\s+$/, "")}\n${block}` : block);
      setShotNote(`${json.lines.length} address${json.lines.length === 1 ? "" : "es"} read — check them before generating.`);
    } catch (e) {
      setShotNote((e as Error).message);
    } finally {
      setShotBusy(false);
    }
  }

  /** Multi mode's Generate: every pasted address becomes a blue lot, and there is no red site.
   *  The response lands in the same `result` the single-address path fills, so everything
   *  after this point — map, sidebar, sheet, export, save file — is shared code. */
  /** Street View + vision storey count for each lot (lib/storeys, /api/kml/standard-markup/storeys),
   *  in batches of ten with three in flight. A confident verdict (≥ STOREYS_CONFIDENT, facade
   *  visible) is written INTO THE DRAFT, which is what turns the cell's highlight off; an unsure
   *  one only reaches the lot (`storeys`), so the sheet seeds the count but keeps the cell
   *  orange. About a cent a lot; the calls land on /admin/usage under this tool. */
  async function checkStoreys(lots: Neighbour[], run: number) {
    const targets = lots.filter((l) => l.ring.length >= 3);
    if (targets.length === 0) return;
    let done = 0;
    let cleared = 0;
    let unsure = 0;
    let missed = 0;
    setStoreysNote(`Checking storeys on Street View… 0/${targets.length}`);
    const batches: Neighbour[][] = [];
    for (let i = 0; i < targets.length; i += 10) batches.push(targets.slice(i, i + 10));
    await mapPool(batches, 3, async (batch) => {
      try {
        const res = await fetch("/api/kml/standard-markup/storeys", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            lots: batch.map((l) => ({ key: l.id, ring: l.ring, label: [l.street, l.suburb].filter(Boolean).join(", ") })),
          }),
        });
        const json = (await res.json().catch(() => null)) as
          | { ok: boolean; results?: { key: string; result: StoreyResult | { status: "error"; error: string } }[] }
          | null;
        if (run !== storeysRun.current) return;
        if (!res.ok || !json?.ok || !json.results) {
          missed += batch.length;
          return;
        }
        const byKey = new Map(json.results.map((r) => [r.key, r.result]));
        setResult((prev) =>
          prev
            ? {
                ...prev,
                neighbours: prev.neighbours.map((n) => {
                  const r = byKey.get(n.id);
                  return r && r.status === "ok" && r.verdict.storeys ? { ...n, storeys: r.verdict.storeys } : n;
                }),
              }
            : prev
        );
        setLineDrafts((prev) => {
          let next = prev;
          for (const [key, r] of byKey) {
            if (r.status === "ok" && r.verdict.clear && r.verdict.storeys) next = applyCell(next, lotKey(key), "levels", String(r.verdict.storeys));
          }
          return next;
        });
        for (const r of byKey.values()) {
          if (r.status === "ok" && r.verdict.clear) cleared++;
          else if (r.status === "ok") unsure++;
          else missed++;
        }
      } catch {
        missed += batch.length;
      } finally {
        done += batch.length;
        if (run === storeysRun.current) setStoreysNote(`Checking storeys on Street View… ${done}/${targets.length}`);
      }
    });
    if (run !== storeysRun.current) return;
    setStoreysNote(
      `Storeys checked on Street View — ${cleared} confident and filled, ${unsure} filled but highlighted for a look, ${missed} with no usable view.`
    );
  }

  type BulkResponse = {
    ok: boolean;
    error?: string;
    parcels?: Neighbour[];
    address?: { street: string; suburb: string; postcode: string; state: string };
    centres?: { point: LatLng; label: string }[];
    unresolved?: { raw: string; reason: string }[];
    flags?: string[];
    total?: number;
  };

  async function fetchBulk(body: Record<string, unknown>): Promise<BulkResponse> {
    const res = await fetch("/api/kml/standard-markup/bulk-parcels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as BulkResponse | null;
    if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Something went wrong resolving those addresses.");
    return json;
  }

  /** "Line items only": the list is a schedule, not a drawing, so the drawing's cap does not
   *  apply. Resolved in pages of PAGE_SIZE (three in flight — each page is its own function
   *  call, under the 60-second limit), then merged: lot ids made unique across pages the same
   *  way the picker does, flags and unresolved concatenated, the first page's job address. */
  async function fetchBulkPaged(text: string): Promise<BulkResponse> {
    const PAGE_SIZE = 50;
    const first = await fetchBulk({ text, from: 0, to: PAGE_SIZE });
    const total = first.total ?? 0;
    const starts: number[] = [];
    for (let from = PAGE_SIZE; from < total; from += PAGE_SIZE) starts.push(from);
    let done = Math.min(PAGE_SIZE, total);
    setProgress(`${done}/${total}`);
    const rest = await mapPool(starts, 3, async (from) => {
      const page = await fetchBulk({ text, from, to: from + PAGE_SIZE });
      done += Math.min(PAGE_SIZE, total - from);
      setProgress(`${done}/${total}`);
      return page;
    });
    const pages = [first, ...rest];
    const parcels: Neighbour[] = [];
    for (const p of pages) for (const n of p.parcels ?? []) parcels.push({ ...n, id: uniqueLotId(n.id, parcels) });
    const address = pages.find((p) => (p.parcels?.length ?? 0) > 0)?.address ?? first.address;
    return {
      ok: true,
      parcels,
      address,
      centres: pages.flatMap((p) => p.centres ?? []),
      unresolved: pages.flatMap((p) => p.unresolved ?? []),
      flags: pages.flatMap((p) => p.flags ?? []),
      total,
    };
  }

  async function generateBulk() {
    setError(null);
    setFlags([]);
    setUnresolved([]);
    if (!addressBlock.trim()) {
      setError("Paste at least one address.");
      return;
    }
    setLoading(true);
    setProgress(null);
    try {
      const paged = offerNoMap && lineItemsOnly;
      const json = paged ? await fetchBulkPaged(addressBlock) : await fetchBulk({ text: addressBlock });
      if (!json.parcels || !json.address) {
        setError(json.error ?? "Something went wrong resolving those addresses.");
        return;
      }
      if (paged && json.parcels.length === 0 && (json.centres?.length ?? 0) === 0) {
        setError(
          `None of the ${json.total ?? 0} addresses resolved: ${(json.unresolved ?? [])
            .slice(0, 3)
            .map((u) => `${u.raw} (${u.reason})`)
            .join("; ")}${(json.unresolved?.length ?? 0) > 3 ? "…" : ""}`
        );
        return;
      }
      setUnresolved(json.unresolved ?? []);
      // The job's address is the first resolved one: it names the files and the save file, and
      // gives "+ Add lot from map" a state and suburb to look a picked lot up with.
      setStreet(json.address.street);
      setSuburb(json.address.suburb);
      setPostcode(json.address.postcode);
      const supported = STATES.find((st) => st.key === json.address!.state && !st.disabled);
      if (supported) setState(json.address.state as SupportedState);
      setParsedSummary(`${json.parcels.length} properties`);
      setAddressPoint(null);
      const found = json.centres ?? [];
      setCentres(found);
      setMapHidden(offerNoMap && lineItemsOnly);
      setResult({
        subjectRing: [],
        subjectLotPlan: null,
        subjectAreaSqm: null,
        neighbours: json.parcels,
        matchedAddress: null,
        mapType: MAP_TYPE,
        flags: json.flags ?? [],
      });
      setExcludedIds(new Set());
      // No project site on a street survey — and an empty ring must never be drawn.
      setHideSubject(true);
      setLineDrafts({});
      // Red lots — the addresses the operator put in — start unticked; see sourcesFromLayers.
      setDeselected(
        initialDeselected(
          sourcesFromLayers(
            layersFrom(
              buildBuildingMarkupFile({
                address: json.address,
                matchedAddress: null,
                mapType: MAP_TYPE,
                subjectRing: [],
                neighbours: json.parcels,
                excludedIds: [],
                hideSubject: true,
                shapes: [],
              })
            )
          )
        )
      );
      shapes.reset();
      setFlags(json.flags ?? []);
      frameGeometry([], json.parcels, new Set(), found.map((c) => frameFor(c.point)));
      setPicking(false);
      setPickMessage(null);
      setAddressesOpen(false);
      // DEV: count storeys from Street View for every lot, in the background. Confident counts
      // fill the Levels cell and clear its highlight; unsure ones fill it and leave it orange.
      storeysRun.current++;
      setStoreysNote(null);
      if (dev) void checkStoreys(json.parcels, storeysRun.current);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  /** Ids key the exclude-set and the checkboxes, so a duplicate would make two lots
   *  toggle as one — the same rule resolve.ts applies server-side, applied here against
   *  the list as it currently stands. */
  function uniqueLotId(idKey: string, existing: Neighbour[]): string {
    const base = idKey || crypto.randomUUID();
    const used = new Set(existing.map((n) => n.id));
    let id = base;
    for (let dup = 2; used.has(id); dup++) id = `${base}#${dup}`;
    return id;
  }

  /** Pick mode STAYS ON until the operator presses Done — a survey adds lots in a run, and
   *  re-arming between each one was the whole complaint (Rhys, 2026-09-18). Everything below
   *  therefore reads `resultRef`, never the render's `result`. */
  async function handlePick(point: LatLng) {
    const current = resultRef.current;
    if (!current) return;
    setPickMessage(null);

    // Both of these are answered locally — no point paying for a cadastre round trip to
    // be told about a lot we already have.
    if (pointInRing(point, current.subjectRing)) {
      setPickMessage("That's the project site — it's already on the map.");
      return;
    }
    const existing = current.neighbours.find((n) => pointInRing(point, n.ring));
    if (existing) {
      setPickMessage(`${existing.street ?? "That lot"} is already in the list.`);
      return;
    }

    setPickBusy(true);
    try {
      const res = await fetch("/api/kml/standard-markup/parcel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The job's address goes along so the route can look the picked lot's own street up:
        // NSW needs the suburb to split one glued address string, and QLD uses the street to
        // choose between a corner lot's several frontages.
        body: JSON.stringify({ lat: point.lat, lng: point.lng, state, street, suburb }),
      });
      const json = (await res.json().catch(() => null)) as
        | {
            ok: boolean;
            parcel?: {
              idKey: string;
              ring: LatLng[];
              areaSqm: number | null;
              kind: "lot" | "road" | "other";
              street?: string | null;
              suburb?: string | null;
            } | null;
            error?: string;
          }
        | null;
      if (!res.ok || !json?.ok) {
        setPickMessage(json?.error ?? "Couldn't look that lot up — try again.");
        return;
      }
      if (!json.parcel) {
        setPickMessage("No titled parcel there — try clicking inside the lot.");
        return;
      }
      if (json.parcel.kind !== "lot") {
        setPickMessage(
          json.parcel.kind === "road"
            ? "That's a road reserve, not a lot — use a custom shape for road frontage."
            : "That's an easement or interest, not a titled lot."
        );
        return;
      }
      const parcel = json.parcel;
      // Functional, and the id is made unique against the list as it stands INSIDE the
      // update — with pick mode left on, the previous click's lot may have landed since
      // this one's fetch started.
      setResult((prev) => {
        if (!prev) return prev;
        if (prev.neighbours.some((n) => n.id.replace(/#\d+$/, "") === parcel.idKey && pointInRing(point, n.ring))) {
          return prev;
        }
        const added: Neighbour = {
          id: uniqueLotId(parcel.idKey, prev.neighbours),
          ring: parcel.ring,
          areaSqm: parcel.areaSqm,
          street: parcel.street ?? null,
          suburb: parcel.suburb ?? null,
        };
        // No render needed — the overlay draws the new lot and its bubble straight away.
        return { ...prev, neighbours: [...prev.neighbours, added] };
      });
      setPickedCount((n) => n + 1);
    } catch (e) {
      setPickMessage((e as Error).message);
    } finally {
      setPickBusy(false);
    }
  }

  function toggleNeighbour(id: string) {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Re-renders without the numbered neighbour pins — those reference numbers are for staff's
  // own check/uncheck workflow, not something a client needs to see, so the on-screen preview
  // and the exported file are deliberately different.
  //
  // Shared by Download and Sync To Salesforce so the file filed into Box is byte-identical to
  // the one an operator would have downloaded and uploaded by hand.
  async function renderCleanImageBase64(): Promise<string> {
    if (!result) throw new Error("Generate a markup first.");
    // The live map's own viewport — the export re-renders exactly this frame through Static
    // Maps, because Maps JS tiles are cross-origin and the live canvas can never be read
    // back. Bounds rather than centre+zoom: the map's zoom is fractional and Static Maps
    // takes integers only.
    const camera = mapRef.current?.getCamera();
    if (!camera) throw new Error("The map is still loading — try again in a moment.");
    const res = await fetch("/api/kml/standard-markup/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subjectRing: result.subjectRing,
        // The address the operator typed, for the legend's project-site row — it beats
        // anything the address layer could offer for a corner lot with several frontages.
        subjectStreet: street.trim() || null,
        subjectAreaSqm: result.subjectAreaSqm ?? null,
        // Item numbers from the SAME rowsFrom() result the sheet renders, so the PNG's bubbles
        // and legend can't disagree with the sheet. "" means drawn but not a line item.
        subjectLabel: String(numberFor(SUBJECT_KEY) ?? ""),
        neighbours: result.neighbours.map((n) => ({
          ...n,
          label: String(numberFor(lotKey(n.id)) ?? ""),
        })),
        // The map type the operator actually chose, not the one the snapshot was resolved
        // with — they can switch to Satellite on the live map.
        mapType: camera.mapType,
        bounds: camera.bounds,
        excludeIds: Array.from(excludedIds),
        hideSubject,
        // Outlines drawn in the composite, not the tile URL: a 50-lot markup would otherwise
        // be simplified to fit the URL and capped at 12 lots. See render-image.ts.
        overlayOutlines: multi,
        // The export bakes the shapes AND the numbered badges — unlike the live map, a .png has
        // no overlay to draw them. payload() supplies geometry; the numbers are attached here
        // from the same source as everything else.
        shapes: shapes.payload().map((sh) => {
          const key = shapeKey(sh);
          return {
            ...sh,
            label: String(numberFor(key) ?? ""),
            // The Street cell the operator typed for this shape — the legend names it that
            // instead of a generic "Shape".
            name: rows.find((r) => r.key === key)?.values.street ?? "",
          };
        }),
      }),
    });
    const json = (await res.json().catch(() => null)) as { ok: boolean; image?: string; error?: string } | null;
    if (!res.ok || !json?.image) {
      throw new Error(json?.error ?? "Something went wrong rendering the image.");
    }
    return json.image;
  }

  async function download() {
    if (!result) return;
    setError(null);
    setDownloading(true);
    try {
      const image = await renderCleanImageBase64();
      const blob = base64ToBlob(image, "image/png");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slugify(street)}-${slugify(suburb)}-standard-markup.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="mt-8">
      {!multi && (
        <p className="text-ad-muted">
          Snapshot an address with its surrounding lots highlighted in blue, auto-scoped to the property.
        </p>
      )}

      {multi && result && !addressesOpen ? (
        // Folded: one line, and a + to get the list back. The markup and the sheet are the work
        // now; the addresses that made them are a detail.
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-ad-border bg-white px-4 py-2.5">
          {/* The same heading as the open card, so folding changes the size and nothing else. A
              count was tried and read as a claim about the markup, which it could not keep
              (adjoining lots are not lines in the box). */}
          <p className="text-sm font-medium text-ad-ink">Addresses</p>
          <button
            type="button"
            onClick={() => setAddressesOpen(true)}
            aria-label="Add or edit addresses"
            title="Add or edit addresses"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-ad-border text-lg leading-none text-ad-ink hover:bg-ad-surface"
          >
            +
          </button>
        </div>
      ) : multi ? (
        <div className="mt-4 rounded-xl border border-ad-border bg-white p-5">
          {/* One heading and one line of instruction, so the three ways in read as one control.
              The fold button sits at the end of this row — the same spot the + occupies on the
              folded bar, so the two swap in place. */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-ad-ink">Addresses</p>
              <p className="mt-0.5 text-xs text-ad-muted">
                Search one, paste a list, or drop a screenshot. A line starting with <span className="font-mono">+</span> also
                brings in its adjoining lots.
              </p>
            </div>
            {result && (
              <button
                type="button"
                onClick={() => setAddressesOpen(false)}
                aria-label="Hide addresses"
                title="Hide addresses"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ad-border text-lg leading-none text-ad-ink hover:bg-ad-surface"
              >
                −
              </button>
            )}
          </div>
          {/* The same search box as Building Markup, adding to the list instead of filling a
              form. The bar takes three quarters of the row, the switch the rest. */}
          <div className="mt-3 grid items-center gap-3 sm:grid-cols-[3fr_1fr]">
            <div className="-mt-1">
              <AddressSearch
                onSelect={handleAddressSelect}
                onPastedLocation={handlePaste}
                clearOnSelect
                // A place with no street address is still a place — handleAddressSelect turns
                // it into a coordinate line rather than an error.
                requireAddress={false}
                placeholder="Add an address, or paste a Google Maps link…"
              />
            </div>
            {/* A plain checkbox, on by default: the searched address is the property the quote is
                about — drawn red — and it is quoted with its neighbours. Pasted lists are
                unaffected. (Was a hand-rolled switch; it never rendered cleanly.) */}
            <label
              className="flex items-center gap-2 text-sm text-ad-ink"
              title="When on, an address added here is drawn red and brings in the lots adjoining it"
            >
              <input
                type="checkbox"
                checked={preselectSurrounding}
                onChange={(e) => setPreselectSurrounding(e.target.checked)}
                className="h-4 w-4 accent-ad-steel"
              />
              Pre-select surrounding assets
            </label>
          </div>
          {addressNote && <p className="mt-1 text-xs text-ad-muted">{addressNote}</p>}
          {addressError && <p className="mt-1 text-xs text-ad-orange">{addressError}</p>}
          {/* Three ways in, side by side: the search bar above, then a paste box for a list and
              a drop zone for a screenshot of one. Both feed the same box, which is what gets
              generated. */}
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <textarea
              value={addressBlock}
              onChange={(e) => setAddressList(e.target.value)}
              rows={addressBlock.split(/\r?\n/).length > 5 ? 9 : 5}
              aria-label="Addresses"
              placeholder={"Or paste addresses, one per line — straight from Excel."}
              className="w-full resize-y rounded-lg border border-ad-border p-3 font-mono text-sm text-ad-ink outline-none focus:border-ad-steel"
            />
            <div
              role="button"
              tabIndex={0}
              onClick={() => !shotBusy && shotInput.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") shotInput.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setShotDrag(true);
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                setShotDrag(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setShotDrag(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setShotDrag(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void readScreenshot(f);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed p-4 text-center text-sm transition-colors",
                shotDrag ? "border-ad-orange bg-ad-orange/10" : "border-ad-border hover:bg-ad-surface",
                shotBusy && "cursor-wait opacity-70"
              )}
            >
              <input
                ref={shotInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void readScreenshot(f);
                }}
              />
              <span className="font-medium text-ad-ink">
                {shotBusy ? "Reading…" : shotDrag ? "Drop it" : "Or drop a screenshot of the addresses"}
              </span>
              <span className="text-xs text-ad-muted">or click to browse — the addresses it reads are added to the list</span>
              {shotNote && <span className={cn("text-xs", /Couldn|doesn|No addresses|failed/.test(shotNote) ? "text-ad-orange" : "text-ad-muted")}>{shotNote}</span>}
            </div>
          </div>
        </div>
      ) : (
      <div className="mt-4 grid gap-4 rounded-xl border border-ad-border bg-white p-5 sm:grid-cols-2">
        {!manualEntry ? (
          <div className="sm:col-span-2">
            <p className="text-sm font-medium text-ad-ink">Address</p>
            <AddressSearch
              onSelect={handleAddressSelect}
              onPastedLocation={handlePaste}
              placeholder="Start typing an address, or paste a Google Maps link…"
            />
            {parsedSummary && !addressError && (
              <p className="mt-1 text-xs text-ad-muted">{parsedSummary}</p>
            )}
            {addressNote && <p className="mt-1 text-xs text-ad-muted">{addressNote}</p>}
            {addressError && <p className="mt-1 text-xs text-ad-orange">{addressError}</p>}
            <button
              type="button"
              onClick={() => {
                setManualEntry(true);
                setAddressError(null);
              }}
              className="mt-2 text-xs text-ad-steel underline underline-offset-2 hover:text-ad-ink"
            >
              Enter manually instead
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
            <label className="block text-sm font-medium text-ad-ink">
              Street address
              <input
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                placeholder="e.g. 8 Ironwood Ct"
                className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
              />
            </label>
            <label className="block text-sm font-medium text-ad-ink">
              Suburb
              <input
                value={suburb}
                onChange={(e) => setSuburb(e.target.value)}
                placeholder="e.g. Mountain Creek"
                className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
              />
            </label>
            <label className="block text-sm font-medium text-ad-ink">
              Postcode (optional)
              <input
                value={postcode}
                onChange={(e) => setPostcode(e.target.value)}
                placeholder="e.g. 4557"
                className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
              />
            </label>
            <div>
              <p className="text-sm font-medium text-ad-ink">State</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {STATES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    disabled={s.disabled}
                    onClick={() => setState(s.key as SupportedState)}
                    title={s.disabled ? "Not supported yet" : undefined}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-sm",
                      s.disabled
                        ? "cursor-not-allowed border-ad-border text-ad-muted/50"
                        : state === s.key
                          ? "border-ad-steel bg-ad-steel/10 text-ad-ink"
                          : "border-ad-border text-ad-muted hover:text-ad-ink"
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setManualEntry(false)}
              className="text-left text-xs text-ad-steel underline underline-offset-2 hover:text-ad-ink sm:col-span-2"
            >
              Search by address instead
            </button>
          </div>
        )}

      </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          className={cn(buttonVariants({ variant: "primary", size: "md" }), loading && "opacity-60")}
          onClick={multi ? generateBulk : generate}
          disabled={loading || (!multi && !manualEntry && !!addressError)}
        >
          {loading
            ? multi
              ? `Resolving addresses…${progress ? ` ${progress}` : ""}`
              : "Generating snapshot…"
            : `${result ? "Regenerate" : "Generate"} ${multi ? "markup" : "snapshot"}`}
        </button>
        {offerNoMap && (
          // Appears the moment the list passes MANY_ADDRESSES, ticked: a long list is priced on
          // the sheet, not drawn. Untick before Generate to keep the map.
          <label className="flex items-center gap-2 text-sm text-ad-ink">
            <input
              type="checkbox"
              checked={lineItemsOnly}
              onChange={(e) => setLineItemsOnly(e.target.checked)}
              className="h-4 w-4 accent-ad-steel"
            />
            Line items only, no map
          </label>
        )}
        <button
          className={cn(buttonVariants({ variant: "accent", size: "md" }), downloading && "opacity-60")}
          onClick={download}
          disabled={!result || downloading || mapHidden}
          title={mapHidden ? "Show the map to export a PNG" : undefined}
        >
          {downloading ? "Preparing…" : "Download .png"}
        </button>
        <button
          className={cn(buttonVariants({ variant: "outline", size: "md" }))}
          onClick={saveJson}
          disabled={!result}
          title="Save the lots, boundary and shapes so this markup can be reopened and adjusted"
        >
          Save .json
        </button>
        <button
          className={cn(buttonVariants({ variant: "outline", size: "md" }))}
          onClick={() => fileInput.current?.click()}
          title="Reopen a saved markup"
        >
          Open .json
        </button>
        {/* Markup level, for the site itself. Live as soon as an address is picked — the sheet's
            per-row links cover the adjoining lots. */}
        <StreetViewLink
          at={sitePoint}
          heading={siteHeading}
          label={streetViewLabel}
          className={cn(buttonVariants({ variant: "outline", size: "md" }), "gap-1.5")}
          iconSize={15}
        >
          Street View
        </StreetViewLink>
        {/* Cleared after every pick, so choosing the same file twice still fires. */}
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void openJson(file);
          }}
        />
        {/* Files a PNG first, so it needs the map. With the map hidden the sheet's own footer
            (line items only, no image — Bulk Property Sizing's arrangement) takes over. */}
        {!mapHidden && (
        <SyncToSalesforce
          getImageBase64={renderCleanImageBase64}
          // Same stem as the confirmed PNG, so the pair sit together in Box and whoever
          // picks the job up can reopen the markup instead of redrawing from the image.
          getSidecar={async (imageFilename) => {
            const doc = saveFileJson();
            if (!doc) throw new Error("Generate a markup first.");
            return {
              filename: `${imageFilename.replace(/\.(png|jpe?g)$/i, "")}.json`,
              contentBase64: toBase64(doc),
              contentType: "application/json",
            };
          }}
          fallbackName={`${slugify(street)}-${slugify(suburb)}-standard-markup.png`}
          disabled={!result}
          // The ticked sheet rows: the same paste of a Quote files the PNG AND creates the
          // line items, so there is one Sync surface on the page rather than two.
          lineItems={{ rows }}
        />
        )}
        {error && <span className="text-sm text-ad-orange">{error}</span>}
      </div>
      {dev && storeysNote && <p className="mt-2 text-xs text-ad-muted">{storeysNote}</p>}

      {/* Off on the DEV tab for now (Rhys, 2026-09-11): nothing it has said there has been
          worth the space. The per-lot notes still reach the sheet's Notes column. */}
      {!multi && flags.length > 0 && (
        <div className="mt-6 max-w-xl rounded-lg border border-ad-orange/40 bg-ad-orange/5 p-3 text-sm text-ad-ink">
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium">Worth a manual check:</p>
            {/* Dismissable: once the operator has read these they are in the way of the map. The
                per-lot corrections stay in the sheet's Notes either way. */}
            <button
              type="button"
              onClick={() => setFlags([])}
              aria-label="Dismiss"
              title="Dismiss"
              className="-mr-1 -mt-1 rounded p-1 leading-none text-ad-muted hover:bg-ad-orange/10 hover:text-ad-ink"
            >
              ×
            </button>
          </div>
          <ul className="mt-1 list-disc pl-5 text-ad-muted">
            {flags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {result && (
        <>
        {multi && centres.length > 0 && (
          // The flags box is off in multi mode, and a centre has no sheet row to carry a note —
          // so the one thing the operator has to know is said here, above the map.
          <p className="mt-6 text-sm text-ad-muted">
            <span className="font-medium text-ad-ink">{centres.map((c) => c.label).join(", ")}</span>
            {centres.length === 1 ? " is a place, not an address" : " are places, not addresses"} — the map is on it and
            nothing is pre-selected. Draw the site with the shape tools; each shape becomes a line item.
          </p>
        )}
        {mapHidden ? (
          // Line items only: no map, no sidebar (both are about drawing), and no Dynamic Maps
          // load. Show map brings the whole block back, framed on the resolved lots.
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ad-border bg-white px-4 py-3">
            <p className="text-sm text-ad-muted">
              <span className="font-medium text-ad-ink">Map hidden</span> — line items only.{" "}
              {result.neighbours.length} propert{result.neighbours.length === 1 ? "y" : "ies"} on the sheet below
              {unresolved.length > 0 && (
                <>
                  {" · "}
                  <span className="font-medium text-ad-orange">{unresolved.length}</span>
                  {" didn't resolve"}
                </>
              )}
              .
            </p>
            <button
              type="button"
              onClick={() => setMapHidden(false)}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              Show map
            </button>
            {unresolved.length > 0 && (
              // Folded: an address that isn't on the sheet is a line item nobody prices, so the
              // list has to be reachable — but 40 of them above a 100-row sheet is in the way.
              <details className="w-full text-sm text-ad-muted">
                <summary className="cursor-pointer text-ad-steel">Show the {unresolved.length} that didn&apos;t resolve</summary>
                <ul className="mt-2 list-disc pl-5">
                  {unresolved.map((u, i) => (
                    <li key={`${i}-${u.raw}`}>
                      <span className="text-ad-ink">{u.raw}</span> — {u.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ) : (
        <>
        {offerNoMap && (
          // The same bar, with the opposite button, so Show map and Hide map swap in place.
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ad-border bg-white px-4 py-3">
            <p className="text-sm text-ad-muted">
              <span className="font-medium text-ad-ink">Map shown</span> —{" "}
              {result.neighbours.length} propert{result.neighbours.length === 1 ? "y" : "ies"} on the sheet below.
            </p>
            <button
              type="button"
              onClick={() => setMapHidden(true)}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              Hide map
            </button>
          </div>
        )}
        {/* Breaks out of the 1240px Container on wide screens, like the sheet below it, and the
            map takes every pixel the sidebar leaves — it used to be a square capped at 896px,
            which on a 1440px monitor left a third of the row empty. */}
        <div className={cn("flex flex-col gap-4 xl:flex-row xl:items-start", offerNoMap ? "mt-4" : "mt-6", BREAKOUT_XL)}>
          <div className="w-full min-w-0 xl:flex-1">
            <MarkupMap
              ref={mapRef}
              shapes={shapes}
              subjectRing={result.subjectRing}
              hideSubject={hideSubject}
              lots={result.neighbours.filter((n) => !excludedIds.has(n.id))}
              numbers={numbers}
              pickMode={picking}
              onPick={handlePick}
              fitRequest={fitRequest}
            />
          </div>

          <div className="w-full space-y-4 xl:w-80 xl:shrink-0">
            {/* No Zoom control any more. It existed because the basemap was a fixed Static
                Maps image, so changing zoom meant refetching the photo — the map pans and
                zooms directly now, and the export follows whatever frame it is left on. */}

            {/* Always rendered, unlike before — the project site row lives here, and a
                property with no detected neighbours still needs it. */}
            <div className="rounded-xl border border-ad-border bg-white p-4">
              <p className="text-sm font-medium text-ad-ink">{multi ? "Properties" : "Detected lots"}</p>
              <p className="mt-1 text-xs text-ad-muted">
                Uncheck anything that shouldn&apos;t be included.
              </p>
              <ul className="mt-3 space-y-2">
                {/* Keyed on the geometry, not the mode. A multi-property markup generates no
                    subject ring, so this row stays hidden — there is no site, the red lot is
                    just a colour. But a markup SAVED before Building Markup became multi
                    carries a real subjectRing, and the open path restores it, so reopening one
                    here must still offer the checkbox that hides it. `!multi` left that file
                    with a red subject drawn and no way to turn it off. */}
                {result.subjectRing.length > 0 && (
                <li className="flex items-center gap-2 text-sm text-ad-ink">
                  <input
                    type="checkbox"
                    checked={!hideSubject}
                    onChange={() => setHideSubject((h) => !h)}
                    className="h-4 w-4 accent-ad-steel"
                  />
                  <span
                    className="h-4 w-4 shrink-0 rounded-sm border border-black/10"
                    style={{ backgroundColor: `#${SITE_RED}` }}
                  />
                  {rowBadge(SUBJECT_KEY, `#${SITE_RED}`)}
                  <span className="flex-1 truncate" title={subjectRowLabel()}>
                    {subjectRowLabel()}
                  </span>
                </li>
                )}
                {result.neighbours.map((n) => (
                  <li key={n.id} className="flex items-center gap-2 text-sm text-ad-ink">
                    <input
                      type="checkbox"
                      checked={!excludedIds.has(n.id)}
                      onChange={() => toggleNeighbour(n.id)}
                      className="h-4 w-4 accent-ad-steel"
                    />
                    {rowBadge(lotKey(n.id), `#${markupColor(n.color)}`)}
                    {/* The street address, not "Lot 1" — the numbered badge beside it already
                        ties the row to its pin on the image, so repeating the number as the
                        label spent the only line of text in the row on something already on
                        screen. An address is what an estimator recognises. Suburb is left out:
                        every lot is in the job's suburb and it would push the m² off the row.
                        Falls back to the lot/plan. */}
                    <span className="flex-1 truncate" title={lotRowLabel(n)}>
                      {lotRowLabel(n)}
                    </span>
                  </li>
                ))}
              </ul>
              {/* Lives here because it adds a row to the list above — the same
                  relationship "+ Add shape" has to the shape list. Outline, not primary:
                  it only arms a map click, and a solid button beside the others read as
                  though it did the work itself. */}
              <button
                type="button"
                onClick={() => {
                  setPickMessage(null);
                  setPickedCount(0);
                  setPicking((p) => !p);
                }}
                // NOT disabled while a lookup is in flight: pick mode stays on, so this is
                // the only way out and it has to stay pressable.
                aria-pressed={picking}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "mt-3 w-full",
                  picking && "border-ad-steel bg-ad-steel/10 text-ad-ink"
                )}
              >
                {picking
                  ? `Done${pickedCount > 0 ? ` — ${pickedCount} added` : ""}`
                  : "+ Add lot from map"}
              </button>

              {/* While picking, this is the running feedback — it says what the last click
                  did, which is the only signal that a click on a road or an existing lot
                  was heard at all. */}
              {picking ? (
                <p className="mt-2 text-xs text-ad-muted">
                  {pickBusy ? (
                    "Looking that lot up…"
                  ) : pickMessage ? (
                    <span className="text-ad-orange">{pickMessage}</span>
                  ) : (
                    "Keep clicking properties to add them. Press Done when finished."
                  )}
                </p>
              ) : (
                pickMessage && !pickBusy && <p className="mt-2 text-xs text-ad-orange">{pickMessage}</p>
              )}
            </div>
            <ShapePanel shapes={shapes} commands={mapRef} />

            {/* No Regenerate button: every edit in this column is live now. Zoom is the
                only thing that still needs the server, and it refetches itself. */}
          </div>
        </div>
        </>
        )}

        {/* Full width and BELOW the image, not in the column beside it: pricing is read down
            a column across every layer, which a max-w-xs sidebar can't show. */}
        <LineItemsTable
          rows={rows}
          // No tool-specific columns: the colour swatch sits beside the item number, and the
          // lot's address and area are in the sidebar list. A "Layer" column repeated both.
          leading={[]}
          onChange={setLineCell}
          onToggle={toggleRow}
          onToggleAll={toggleAllRows}
          breakout
          emptyText="Nothing included on the markup yet."
          // No footer while the map is up: the toolbar's Sync To Salesforce creates the line
          // items along with the PNG. With the map hidden there is no PNG, so the footer — the
          // same one Bulk Property Sizing uses — creates them on its own.
          sync={mapHidden ? {} : undefined}
          // DEV tab only until Rhys promotes them: the ticked rows as a CSV, and one product
          // onto every ticked row.
          exportCsv={dev}
          bulkEdit={dev}
        />
        </>
      )}
    </div>
  );
}
