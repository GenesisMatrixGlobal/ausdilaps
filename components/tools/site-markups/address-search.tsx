"use client";

import { useEffect, useRef, useState } from "react";

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

/** Google-style type-ahead address search — proxies through our own server-side routes
 *  (which hold the Places API key) rather than loading the Maps JS library client-side,
 *  so no second, publicly-exposed key is needed. Reuses one session token per search
 *  (reset after a selection) so Google bills the whole autocomplete-to-details flow as
 *  one cheaper session instead of per-keystroke. */
export function AddressSearch({ onSelect }: { onSelect: (parsed: ParsedAddress) => void }) {
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
        body: JSON.stringify({ placeId: suggestion.placeId, sessionToken: sessionToken.current }),
      });
      const json = (await res.json().catch(() => null)) as (ParsedAddress & { ok: boolean; error?: string }) | null;
      sessionToken.current = crypto.randomUUID();
      if (!json?.ok) {
        setError(json?.error ?? "Couldn't read that address — try entering it manually.");
        return;
      }
      onSelect({ street: json.street, suburb: json.suburb, postcode: json.postcode, state: json.state });
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
        placeholder="Start typing an address…"
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
