"use client";

import { useEffect, useRef, useState } from "react";
import type { LatLng } from "@/lib/kml/types";
import { looksLikeMapsPaste } from "@/lib/maps/parse-google-maps-url";

export interface PlaceSuggestion {
  placeId: string;
  text: string;
}

export interface ParsedAddress {
  street: string;
  suburb: string;
  postcode: string;
  state: string;
}

export interface LatLngBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Everything /api/places/details returns. Widening the onSelect parameter to this is
 *  contravariant, so residential-tab.tsx's existing `(parsed: ParsedAddress) => void`
 *  stays assignable and that file needs no change. */
export interface PlaceSelection extends ParsedAddress {
  formattedAddress: string | null;
  location: LatLng | null;
  viewport: LatLngBounds | null;
}

/** Google-style type-ahead address search — proxies through our own server-side routes
 *  (which hold the Places API key) rather than loading the Maps JS library client-side, so
 *  the autocomplete needs no publicly-exposed key. (The Measure tab does load Maps JS, on
 *  a separate browser-restricted key, but only for the map itself.) Reuses one session
 *  token per search (reset after a selection) so Google bills the whole
 *  autocomplete-to-details flow as one cheaper session instead of per-keystroke. */
export function AddressSearch({
  onSelect,
  requireAddress = true,
  placeholder = "Start typing an address…",
  onPastedLocation,
}: {
  onSelect: (place: PlaceSelection) => void;
  /** Residential needs a parseable street address because the cadastre lookup does.
   *  Measure only needs a coordinate, so it passes false and a suburb, park or road with
   *  no street number works. */
  requireAddress?: boolean;
  placeholder?: string;
  /** Lets the host handle a pasted URL or coordinate pair itself. Return true for
   *  "handled — don't send this to Places", or a string to swap the box's contents for
   *  that and search it instead (a /maps/place/Story+Bridge link carries a name, not a
   *  coordinate). Keeps link-pasting and address search in one box without the
   *  Residential tab having to know link-pasting exists. */
  onPastedLocation?: (text: string) => boolean | string | Promise<boolean | string>;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionToken = useRef(crypto.randomUUID());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  // Set right before select() calls setQuery() to display the chosen address — query is
  // also the search effect's trigger, so without this a selection's own text update
  // would re-fire the search 300ms later and pop the dropdown back open.
  const suppressNextSearch = useRef(false);
  // Kept in a ref so the search effect below doesn't re-run (and re-debounce) every time
  // the host re-renders with a fresh closure. Assigned in an effect rather than during
  // render because writing a ref during render is what react-hooks/react-compiler flags —
  // and an effect is early enough here, since it's only read inside a 300ms debounce.
  const pasteHandler = useRef(onPastedLocation);
  useEffect(() => {
    pasteHandler.current = onPastedLocation;
  }, [onPastedLocation]);

  // Closes on an actual outside click, rather than the input's own onBlur — blur fires
  // before a click on the dropdown registers, which needs a fragile setTimeout race to
  // work around and was closing the dropdown before the click landed.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (suppressNextSearch.current) {
      suppressNextSearch.current = false;
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (query.trim().length < 3) {
        setSuggestions([]);
        return;
      }
      // A pasted URL or coordinate pair is not a search term — Places would return
      // nothing for it, and the host can turn it into a point without a round trip.
      if (pasteHandler.current && looksLikeMapsPaste(query)) {
        setOpen(false);
        setSuggestions([]);
        setError(null);
        setLoading(true);
        try {
          const handled = await pasteHandler.current(query);
          if (typeof handled === "string") {
            // Re-enters this effect with the extracted name, which no longer looks like a
            // paste, so it goes to Places on the next pass rather than looping.
            setQuery(handled);
            return;
          }
          if (handled) return;
        } finally {
          setLoading(false);
        }
      }
      setLoading(true);
      try {
        const res = await fetch("/api/places/autocomplete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input: query, sessionToken: sessionToken.current }),
        });
        const json = (await res.json().catch(() => null)) as { ok: boolean; suggestions?: PlaceSuggestion[] } | null;
        setSuggestions(json?.ok ? (json.suggestions ?? []) : []);
        setOpen(true);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  async function select(suggestion: PlaceSuggestion) {
    suppressNextSearch.current = true;
    setOpen(false);
    setQuery(suggestion.text);
    setError(null);
    try {
      const res = await fetch("/api/places/details", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          placeId: suggestion.placeId,
          sessionToken: sessionToken.current,
          requireAddress,
        }),
      });
      const json = (await res.json().catch(() => null)) as (PlaceSelection & { ok: boolean; error?: string }) | null;
      sessionToken.current = crypto.randomUUID();
      if (!json?.ok) {
        setError(json?.error ?? "Couldn't read that address — try entering it manually.");
        return;
      }
      onSelect({
        street: json.street,
        suburb: json.suburb,
        postcode: json.postcode,
        state: json.state,
        formattedAddress: json.formattedAddress ?? null,
        location: json.location ?? null,
        viewport: json.viewport ?? null,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
      />
      {loading && <p className="mt-1 text-xs text-ad-muted">Searching…</p>}
      {error && <p className="mt-1 text-xs text-ad-orange">{error}</p>}
      {open && suggestions.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded-lg border border-ad-border bg-white py-1 shadow-lg">
          {suggestions.map((s) => (
            <li key={s.placeId}>
              <button
                type="button"
                onClick={() => select(s)}
                className="block w-full px-3 py-2 text-left text-sm text-ad-ink hover:bg-ad-surface"
              >
                {s.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
