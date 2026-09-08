/**
 * Loads the Google Maps JavaScript API exactly once per page, whatever calls it and
 * however many times.
 *
 * The module-scope promise is the whole trick. React 19 StrictMode (on by default in the
 * App Router) mounts every effect twice in development, and any loader that keys off "is
 * the script tag there yet?" races itself and injects two <script>s — which Google answers
 * with "You have included the Google Maps JavaScript API multiple times" and a map that
 * only half-initialises. Both mounts awaiting one promise is immune by construction.
 *
 * Hand-rolled rather than taking @vis.gl/react-google-maps: that library ships no Polygon
 * or Polyline component, so every overlay in the Measure tab would be this same imperative
 * code inside useMap() — we'd carry three runtime dependencies for the loader below.
 */

/** The release channel. `quarterly`, deliberately NOT `weekly`.
 *
 *  The Measure tab leans on the behaviour of Google's editable-overlay UI — the vertex
 *  handles, the midpoint ghost handles, and the point at which a vertex drag is committed
 *  into the path. None of that is contractual, so take the slowest channel and find out
 *  about a change on our own schedule rather than on a Tuesday. */
const VERSION = "quarterly";

const CALLBACK = "__ausdilapsMapsReady";

/** Mirrors GoogleMapsConfigError in lib/kml/site-markup/static-map.ts: a missing key is a
 *  setup problem with one specific fix, not a runtime failure to log and shrug at. The
 *  Measure tab shows its message verbatim, so it names the variable. */
export class MapsKeyMissingError extends Error {
  constructor() {
    super(
      "Google Maps isn't configured — NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY is missing. " +
        "It's a separate, browser-restricted key from the server-side GOOGLE_MAPS_API_KEY."
    );
    this.name = "MapsKeyMissingError";
  }
}

/**
 * What to show when Google rejects the key for this page's URL.
 *
 * This failure is invisible without special handling, which is why it gets its own path: the
 * SCRIPT loads fine (main.js, poly.js and overlay.js all arrive, and `google.maps` exists), so
 * loadGoogleMaps() resolves and `new google.maps.Map()` returns an object — and then the map
 * simply never paints. All you get is a console error and a blank grey box. Google's only hook
 * for it is the `gm_authFailure` global, below.
 */
export const MAPS_AUTH_FAILURE_MESSAGE =
  "Google rejected the Maps key for this address. Add this page's origin to the key's HTTP " +
  "referrer list in Google Cloud Console (Credentials → the browser key → Application " +
  "restrictions) — the browser console names the exact URL to authorise.";

let authFailed = false;
const authListeners = new Set<() => void>();

/** True once Google has rejected the key. Sticky: the failure is a configuration fact, not a
 *  transient one, and a component mounting later still needs to know. */
export function mapsAuthFailed(): boolean {
  return authFailed;
}

/** Subscribe to the rejection. Needed as a subscription rather than a rejected promise
 *  because the failure arrives AFTER the loader has already resolved. */
export function onMapsAuthFailure(listener: () => void): () => void {
  authListeners.add(listener);
  return () => {
    authListeners.delete(listener);
  };
}

/** Google calls this global — it is the documented and only hook for a key rejection. */
function installAuthFailureHook(w: Record<string, unknown>) {
  if (typeof w.gm_authFailure === "function") return;
  w.gm_authFailure = () => {
    authFailed = true;
    for (const listener of authListeners) listener();
  };
}

let loading: Promise<typeof google.maps> | null = null;

export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (loading) return loading;

  loading = new Promise<typeof google.maps>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("loadGoogleMaps() is browser-only."));
      return;
    }
    installAuthFailureHook(window as unknown as Record<string, unknown>);

    if (window.google?.maps) {
      resolve(window.google.maps);
      return;
    }

    // Read as a full static member expression — that's the form Next inlines at build time.
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
    if (!key) {
      // Left null so a later attempt re-reads rather than caching this rejection forever.
      loading = null;
      reject(new MapsKeyMissingError());
      return;
    }

    const w = window as unknown as Record<string, unknown>;
    w[CALLBACK] = () => {
      delete w[CALLBACK];
      resolve(window.google!.maps!);
    };

    const script = document.createElement("script");
    // No `libraries=` at all, deliberately. `geometry` would hand us
    // spherical.computeArea/computeLength, and we specifically do NOT want them: every
    // number this tool prints has to come from ringAreaSqm/bufferLineToPolygon so a
    // Measure figure and a Residential exported markup agree to the square metre.
    //
    // loading=async stops Google logging "loaded without loading=async" and lets it fetch
    // its sub-bundles in parallel. It requires a callback, hence the global above.
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
      `&v=${VERSION}&loading=async&callback=${CALLBACK}`;
    script.async = true;
    script.onerror = () => {
      // Null the singleton so a later retry (the operator reopening the tab once their
      // wifi is back) gets a fresh attempt rather than the cached rejection.
      loading = null;
      delete w[CALLBACK];
      reject(
        new Error(
          "Couldn't load Google Maps — check the network, and the API key's HTTP referrer restrictions."
        )
      );
    };
    document.head.appendChild(script);
  });

  return loading;
}
