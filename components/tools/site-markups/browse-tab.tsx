"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { pointInRing } from "@/lib/kml/standard-markup/geometry";
import { parseGoogleMapsUrl } from "@/lib/maps/parse-google-maps-url";
import type { GoogleMapsTarget } from "@/lib/maps/parse-google-maps-url";
import type { LatLng } from "@/lib/kml/types";
import { AddressSearch, type PlaceSelection } from "@/components/tools/shared/address-search";
import { MeasureMap, type MapCommands } from "./measure-map";
import { MeasurePanel } from "./measure-panel";
import { MAX_MEASUREMENTS, useMeasurements } from "./measure-shapes";
import { StreetViewLink } from "./street-view-link";

/**
 * Browse — the Google Maps replacement (Rhys, 2026-09-29; was the Measure tab).
 *
 * A live map, a search box, Street View, and a measuring tool: draw a line or an area, or
 * press Lot and click a property to measure its cadastre boundary. That is ALL it is, on
 * purpose — no Save/Open, no PNG, no Salesforce sync, no numbered pins, no Generate. Those
 * belong to the Assets tab, which produces a quote; this one is for looking and measuring,
 * and nothing it draws is kept.
 *
 * The map takes the full width and most of the height, with the measurement list floating
 * over it. On a browsing tool the map IS the interface.
 */
export function BrowseTab({ active }: { active: boolean }) {
  const state = useMeasurements();
  const commands = useRef<MapCommands | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [lotOn, setLotOn] = useState(false);
  const [lotBusy, setLotBusy] = useState(0);
  const [lotNote, setLotNote] = useState<string | null>(null);

  // --------------------------------------------------------------------------- Go to

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

      // maps.app.goo.gl — only a redirect knows where it points, and the browser can't read a
      // cross-origin Location header, so this needs the server.
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
    // A street address lands ON the house. Google's viewport for one is a whole block or
    // more, which is right for a suburb or a park and wrong for looking at a property.
    if (place.street && place.location && !place.place) {
      commands.current?.goTo({ lat: place.location.lat, lng: place.location.lng, zoom: 19 });
      return;
    }
    if (place.viewport) {
      commands.current?.fit(place.viewport);
      return;
    }
    if (place.location) commands.current?.goTo({ lat: place.location.lat, lng: place.location.lng });
  }, []);

  // ---------------------------------------------------------------------- Street View

  /** Street View opens on the middle of the map, AIMED at it — unaimed, Google looks due
   *  north (see lib/maps/street-view.ts). The heading comes from the free metadata endpoint
   *  once the view has sat still for a moment, and is stored with the point it was measured
   *  from, so a stale heading can never be paired with a new centre. A plain link, not a
   *  window.open after a fetch: that is a pop-up to a browser, and gets blocked. */
  const [centre, setCentre] = useState<LatLng | null>(null);
  const [aim, setAim] = useState<{ key: string; heading: number } | null>(null);
  const centreKey = centre ? `${centre.lat.toFixed(6)},${centre.lng.toFixed(6)}` : null;

  useEffect(() => {
    if (!centreKey) return;
    let live = true;
    const timer = setTimeout(() => {
      const [lat, lng] = centreKey.split(",").map(Number);
      void fetch("/api/maps/street-view", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lat, lng }),
      })
        .then((r) => r.json())
        .then((j: { ok?: boolean; heading?: number | null }) => {
          if (live && j?.ok && typeof j.heading === "number") setAim({ key: centreKey, heading: j.heading });
        })
        // Silent: an unaimed Street View link still works.
        .catch(() => {});
    }, 700);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [centreKey]);

  // ------------------------------------------------------------------------------ Lot

  /** Click a property, get its boundary as an area measurement. Reads the live list
   *  (listRef), never the render's, because the mode stays on and two clicks can be in
   *  flight at once. */
  async function pickLot(point: LatLng) {
    if (state.listRef.current.some((m) => m.lot && pointInRing(point, m.points))) {
      setLotNote("That lot is already measured.");
      return;
    }
    if (state.listRef.current.length >= MAX_MEASUREMENTS) {
      setLotNote(`That's the maximum of ${MAX_MEASUREMENTS} measurements — remove one first.`);
      return;
    }
    setLotBusy((n) => n + 1);
    setLotNote("Looking that lot up…");
    try {
      const res = await fetch("/api/kml/standard-markup/parcel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // No state: the route asks all three cadastres (QLD, NSW, VIC).
        body: JSON.stringify({ lat: point.lat, lng: point.lng }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; parcel?: { ring: LatLng[]; kind: "lot" | "road" | "other" } | null; error?: string }
        | null;
      if (!res.ok || !json?.ok) {
        setLotNote(json?.error ?? "Couldn't look that lot up — try again.");
        return;
      }
      if (!json.parcel) {
        setLotNote("No titled lot there. Lots are found in QLD, NSW and VIC — elsewhere, draw an area.");
        return;
      }
      if (json.parcel.kind !== "lot") {
        setLotNote(
          json.parcel.kind === "road"
            ? "That's a road reserve, not a lot — draw a line or area for it."
            : "That's an easement or interest, not a titled lot."
        );
        return;
      }
      if (!state.addLot(json.parcel.ring)) {
        setLotNote(`That's the maximum of ${MAX_MEASUREMENTS} measurements — remove one first.`);
        return;
      }
      setLotNote("Added. Keep clicking lots, or press Done.");
    } catch (e) {
      setLotNote((e as Error).message);
    } finally {
      setLotBusy((n) => n - 1);
    }
  }

  function toggleLot() {
    const next = !lotOn;
    setLotOn(next);
    // Starting a pick must not extend whatever shape was selected.
    if (next) state.select(null);
    setLotNote(next ? "Click a property on the map to measure its boundary." : null);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[18rem] flex-1">
          <AddressSearch
            onSelect={handleSelect}
            onPastedLocation={handlePaste}
            // Only a coordinate is needed to move a map, so a suburb, a park or a road
            // with no street number is a perfectly good destination here.
            requireAddress={false}
            placeholder="Search an address or place, or paste a Google Maps link…"
          />
        </div>
        <StreetViewLink
          at={centre}
          heading={aim && aim.key === centreKey ? aim.heading : null}
          label="the centre of the map"
          className={cn(buttonVariants({ variant: "outline", size: "md" }), "gap-1.5")}
          iconSize={15}
        >
          Street View
        </StreetViewLink>
      </div>
      {note && <p className="mt-2 text-xs text-ad-orange">{note}</p>}

      {/* Tall and full width. The map's own fullscreen button is there for when it isn't
          enough. */}
      <div className="relative mt-3 h-[75vh] min-h-[480px] w-full">
        <MeasureMap
          ref={commands}
          shapes={state}
          active={active}
          pickMode={lotOn}
          onPick={(p) => void pickLot(p)}
          onCentre={setCentre}
        />
        {/* pointer-events-none so only the card itself takes clicks — everywhere else in
            this overlay has to fall through to the map. Left-anchored below the map-type
            control, which Google puts at the top left. */}
        <div className="pointer-events-none absolute bottom-3 left-3 top-16 flex flex-col items-start">
          <MeasurePanel
            state={state}
            commands={commands}
            lot={{ on: lotOn, busy: lotBusy > 0, toggle: toggleLot, note: lotNote }}
          />
        </div>
      </div>
    </div>
  );
}
