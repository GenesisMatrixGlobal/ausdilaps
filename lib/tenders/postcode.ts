import { recordApiCall } from "@/lib/api-usage";

/**
 * Suburb + state -> postcode, for pre-filling an Opportunity's address.
 *
 * ── Why this is not geocodeViaGoogle ─────────────────────────────────────────────────────
 *
 * That function REJECTS a suburb-level hit on purpose — it exists to find a rooftop for a
 * street address, and a locality result there means the address needs checking. Here a
 * locality is the only acceptable answer, so reusing it would mean inverting its one rule.
 *
 * ── Why only suburbs ─────────────────────────────────────────────────────────────────────
 *
 * ⚠️ NEVER call this for a council area. Stonnington covers Prahran, South Yarra, Malvern,
 * Toorak, Windsor and Armadale; Google will happily return ONE postcode for it, and that
 * specific wrong answer on an Opportunity is worse than the blank it replaced, because a
 * blank prompts someone to check and a plausible number does not. `siteAddressFrom().isLga`
 * is what gates this, and the caller must honour it.
 *
 * A genuine suburb is different in kind: where it spans more than one postcode they are
 * adjacent and the difference rarely changes anything an estimator does.
 */

const URL_BASE = "https://maps.googleapis.com/maps/api/geocode/json";

/** The postcode, or null. Never throws — a missing postcode is the status quo, not a fault. */
export async function lookupPostcode(
  suburb: string | null,
  state: string | null,
  timeoutMs = 6000
): Promise<string | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key || !suburb || !state) return null;

  // COMPONENT filtering rather than a free-text address: it pins the search to a locality in
  // the right state, so a suburb name that is also a street name somewhere cannot drift into
  // a street result. Free text does exactly that for names like "Richmond".
  const params = new URLSearchParams({
    components: `country:AU|locality:${suburb}|administrative_area:${state}`,
    key,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${URL_BASE}?${params}`, { signal: controller.signal, cache: "no-store" });
    void recordApiCall({ provider: "google", api: "geocoding" });
    if (!res.ok) return null;

    const body = (await res.json()) as {
      status?: string;
      results?: {
        types?: string[];
        geometry?: { location?: { lat?: number; lng?: number } };
        address_components?: { long_name?: string; types?: string[] }[];
      }[];
    };
    if (body.status !== "OK" || !body.results?.length) return null;

    const top = body.results[0];
    // Must BE a locality. A result typed administrative_area_* is a council or a region —
    // precisely the case this must not answer, even when the caller forgot to check isLga.
    const isLocality = (top.types ?? []).some((t) => t === "locality" || t === "postal_town");
    if (!isLocality) return null;

    const postcode = (top.address_components ?? []).find((c) => (c.types ?? []).includes("postal_code"))
      ?.long_name;
    if (/^\d{4}$/.test(postcode ?? "")) return postcode!;

    // ⚠️ Google omits postal_code entirely for many metro suburbs — measured on Aspley and
    // Chermside, which return only the name and "Brisbane City", while Goondiwindi includes
    // 4390. Brisbane is a large share of our work, so the gap is worth a second call: reverse
    // geocode the suburb's own centre asking specifically for the postcode area containing
    // it. Safe for a SUBURB (its centre is solidly inside its own postcode) and still never
    // reached for a council area, which is refused above.
    const at = top.geometry?.location;
    if (typeof at?.lat !== "number" || typeof at?.lng !== "number") return null;
    return await postcodeAt(at.lat, at.lng, key, timeoutMs);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The postcode area containing a point. Separate call, same no-throw contract. */
async function postcodeAt(lat: number, lng: number, key: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const params = new URLSearchParams({ latlng: `${lat},${lng}`, result_type: "postal_code", key });
    const res = await fetch(`${URL_BASE}?${params}`, { signal: controller.signal, cache: "no-store" });
    void recordApiCall({ provider: "google", api: "geocoding" });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      status?: string;
      results?: { address_components?: { long_name?: string; types?: string[] }[] }[];
    };
    if (body.status !== "OK") return null;
    const code = (body.results?.[0]?.address_components ?? []).find((c) =>
      (c.types ?? []).includes("postal_code")
    )?.long_name;
    return /^\d{4}$/.test(code ?? "") ? code! : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
