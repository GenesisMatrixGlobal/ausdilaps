"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { downloadBlob } from "@/components/tools/shared/download";
import { SyncToSalesforce } from "@/components/tools/shared/sync-to-salesforce";
import { MIN_POINTS } from "@/lib/kml/standard-markup/measure";
import { buildMeasureFile, parseMeasureFile } from "@/lib/maps/measure-file";
import {
  MAX_MEASUREMENTS,
  MAX_POINTS,
  MAX_WIDTH_M,
  MIN_WIDTH_M,
} from "./measure-shapes";
import { parseGoogleMapsUrl } from "@/lib/maps/parse-google-maps-url";
import type { GoogleMapsTarget } from "@/lib/maps/parse-google-maps-url";
import { AddressSearch, type PlaceSelection } from "./address-search";
import { MeasureMap, type MapCommands } from "./measure-map";
import { MeasurePanel } from "./measure-panel";
import { useMeasurements } from "./measure-shapes";

/**
 * Measure — a live map, two tools, and a number.
 *
 * The Residential Mark Up tab next door is a static Google Static Maps PNG with an SVG
 * overlay: no panning, and zoom re-fetches the image. That is right for producing a fixed
 * export, and wrong for measuring, which needs to roam. So this tab is a real Google Maps
 * JS map, and everything Residential carries for the sake of its export — cadastre lots,
 * legend colours, Generate/Regenerate, the PNG itself — is deliberately absent.
 *
 * Layout: the map takes the full width and most of the height, with the measurement list
 * floating over it. On a measuring tool the map IS the interface.
 */
export function MeasureTab({ active }: { active: boolean }) {
  const state = useMeasurements();
  const commands = useRef<MapCommands | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // Whatever was last searched, purely to name the downloaded file — a folder of
  // "measure-export.png" is useless a week later.
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);

  const drawn = state.list.filter((m) => m.points.length >= MIN_POINTS[m.mode]).length;
  const fileInput = useRef<HTMLInputElement>(null);

  // Plain functions from here down, not useCallback: they are click handlers with nothing
  // downstream to memoise for, and each reads a ref's .current — which the React compiler
  // will not accept in a dependency array.
  /** Names both the .png and the .json off whatever was last searched. */
  const filenameStem = (fallback: string) =>
    (placeLabel ?? fallback)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "measurements";

  function save() {
    const doc = saveFileJson();
    setNote(null);
    downloadBlob(doc, `${filenameStem("measurements")}.json`, "application/json");
  }

  async function open(file: File) {
      const result = parseMeasureFile(await file.text(), {
        maxMeasurements: MAX_MEASUREMENTS,
        maxPoints: MAX_POINTS,
        minWidth: MIN_WIDTH_M,
        maxWidth: MAX_WIDTH_M,
      });
      if (!result.ok) {
        setNote(result.error);
        return;
      }
      state.replaceAll(result.file.measurements);
      if (result.file.label) setPlaceLabel(result.file.label);
      // Land back on the frame it was drawn on, so the shapes aren't off-screen.
      if (result.file.bounds) commands.current?.fit(result.file.bounds);
    setNote(
      result.skipped > 0
        ? `Opened ${result.file.measurements.length} measurement(s); ${result.skipped} couldn't be read and were skipped.`
        : null
    );
  }

  /** base64 of a UTF-8 string. Not plain btoa(): an address with an accent in it would
   *  throw, and a save file carries the operator's own typing. */
  function toBase64(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }

  function saveFileJson() {
    const camera = commands.current?.getCamera();
    return JSON.stringify(
      buildMeasureFile({
        label: placeLabel,
        bounds: camera?.bounds ?? null,
        mapType: camera?.mapType ?? null,
        measurements: state.listRef.current,
      }),
      null,
      2
    );
  }

  /** The one render path, shared by Download .png and the Salesforce sync — two callers
   *  producing different images for the same measurements would be indefensible. Throws
   *  rather than setting a note, because SyncToSalesforce surfaces its own errors. */
  async function renderPng(): Promise<{ base64: string; fallbackStem: string }> {
    const camera = commands.current?.getCamera();
    if (!camera) throw new Error("The map isn't ready yet.");
    const res = await fetch("/api/maps/measure-export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...camera,
        measurements: state.listRef.current.map(({ id, points, mode, widthMetres }) => ({
          id,
          points,
          mode,
          widthMetres,
        })),
      }),
    });
    const json = (await res.json().catch(() => null)) as
      | { ok: boolean; imageBase64?: string; error?: string }
      | null;
    if (!json?.ok || !json.imageBase64) {
      throw new Error(json?.error ?? "Couldn't render the PNG.");
    }
    // Rough box centre is plenty for a filename.
    const fallback = `${((camera.bounds.north + camera.bounds.south) / 2).toFixed(5)}-${(
      (camera.bounds.east + camera.bounds.west) / 2
    ).toFixed(5)}`;
    return { base64: json.imageBase64, fallbackStem: filenameStem(fallback) };
  }

  async function download() {
    setExporting(true);
    setNote(null);
    try {
      const { base64, fallbackStem } = await renderPng();
      // base64 -> bytes by hand: fetch()ing a data: URL of a multi-megabyte PNG is
      // measurably slower, and atob is exact.
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      downloadBlob(bytes, `${fallbackStem}-measurements.png`, "image/png");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  const goToTarget = useCallback((target: GoogleMapsTarget): boolean | string => {
    if (target.kind === "coords") {
      commands.current?.goTo({ lat: target.lat, lng: target.lng, zoom: target.zoom });
      setNote(null);
      return true;
    }
    if (target.kind === "query") {
      setNote(null);
      // No coordinate in the link — hand the place name back to the address search.
      return target.query;
    }
    return true;
  }, []);

  const handlePaste = useCallback(
    async (text: string): Promise<boolean | string> => {
      const target = parseGoogleMapsUrl(text);
      if (!target) {
        setNote("That doesn't look like a Google Maps link or a coordinate pair.");
        return true;
      }
      if (target.kind !== "shortlink") return goToTarget(target);

      // maps.app.goo.gl — only a redirect knows where it points, and the browser can't
      // read a cross-origin Location header, so this is the tab's one server call.
      setNote("Following that share link…");
      try {
        const res = await fetch("/api/maps/resolve-link", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: target.url }),
        });
        const json = (await res.json().catch(() => null)) as
          | { ok: boolean; target?: GoogleMapsTarget; error?: string }
          | null;
        if (!json?.ok || !json.target) {
          setNote(json?.error ?? "Couldn't resolve that share link.");
          return true;
        }
        return goToTarget(json.target);
      } catch (e) {
        setNote((e as Error).message);
        return true;
      }
    },
    [goToTarget]
  );

  const handleSelect = useCallback((place: PlaceSelection) => {
    setNote(null);
    setPlaceLabel(
      place.street && place.suburb ? `${place.street} ${place.suburb}` : place.formattedAddress
    );
    if (place.viewport) {
      commands.current?.fit(place.viewport);
      return;
    }
    if (place.location) commands.current?.goTo({ lat: place.location.lat, lng: place.location.lng });
  }, []);

  return (
    <div>
      {/* Just the field and the button. The how-to-draw block and the note under the
          download button are gone on purpose — the gestures are discoverable by clicking
          the map, the panel's empty state says so once, and a permanent instruction panel
          was costing a third of the toolbar to say it a second time. */}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 rounded-xl border border-ad-border bg-white p-4">
        <div className="min-w-[18rem] flex-1">
          <label className="block text-sm font-medium text-ad-ink">Go to</label>
          <AddressSearch
            onSelect={handleSelect}
            onPastedLocation={handlePaste}
            // Only a coordinate is needed to move a map, so a suburb, a park or a road
            // with no street number is a perfectly good destination here.
            requireAddress={false}
            placeholder="Address, suburb, or paste a Google Maps link…"
          />
        </div>
        {/* mt-6 clears the label line above the input, so the button's top edge lines up
            with the input's rather than drifting every time AddressSearch shows its own
            "Searching…" line underneath. */}
        <div className="mt-6 flex flex-wrap items-start gap-2">
          <button
            type="button"
            onClick={download}
            disabled={exporting || drawn === 0}
            title={drawn === 0 ? "Draw a measurement first" : "Download the map, shapes and areas as a PNG"}
            className={cn(buttonVariants({ variant: "accent", size: "sm" }))}
          >
            {exporting ? "Rendering…" : "Download .png"}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={state.list.length === 0}
            title="Save the measurements so they can be reopened and adjusted"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Save .json
          </button>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            title="Reopen a saved measurement set"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Open .json
          </button>
          {/* Cleared after every pick, so choosing the same file twice in a row still
              fires a change event. */}
          <SyncToSalesforce
            getImageBase64={async () => (await renderPng()).base64}
            // Same stem as the confirmed PNG name, so the pair sit together in Box.
            getSidecar={async (imageFilename) => ({
              filename: `${imageFilename.replace(/\.(png|jpe?g)$/i, "")}.json`,
              contentBase64: toBase64(saveFileJson()),
              contentType: "application/json",
            })}
            fallbackName="site-measurements.png"
            disabled={drawn === 0}
          />
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void open(file);
            }}
          />
        </div>
      </div>
      {note && <p className="mt-2 text-xs text-ad-orange">{note}</p>}

      {/* Tall and full width. 70vh keeps the toolbar above it on screen at the same time,
          and the map's own fullscreen button is there for when it isn't enough. */}
      <div className="relative mt-4 h-[70vh] min-h-[480px] w-full">
        <MeasureMap ref={commands} shapes={state} active={active} />
        {/* pointer-events-none so only the card itself takes clicks — everywhere else in
            this overlay has to fall through to the map and place a point. Left-anchored
            below the map-type control, which Google puts at the top left. */}
        <div className="pointer-events-none absolute bottom-3 left-3 top-16 flex flex-col items-start">
          <MeasurePanel state={state} commands={commands} />
        </div>
      </div>
    </div>
  );
}
