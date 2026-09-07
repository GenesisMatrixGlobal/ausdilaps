import { NextRequest, NextResponse } from "next/server";
import { isStaff } from "@/lib/auth/is-staff";
import { parseGoogleMapsUrl, type GoogleMapsTarget } from "@/lib/maps/parse-google-maps-url";

export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * Turns a maps.app.goo.gl share link into coordinates.
 *
 * Server-side because only a redirect knows where a short link points, and the browser
 * can't read a cross-origin Location header. The Measure tab's only server dependency.
 *
 * This is a fetch-a-URL-the-client-supplied route, so it is written as an allowlist, not a
 * blocklist — the same reasoning as the Tender Watch RSS adapter using code-owned URLs:
 *  - the FIRST hop may only be one of Google's own short-link hosts;
 *  - redirects are followed manually, one hop at a time, and every hop must land on a
 *    google.* host before we'll fetch it;
 *  - the response BODY is never read or returned. Only a lat/lng parsed out of the final
 *    URL leaves this route, so it can't be used to read anything back out of our network.
 */

const SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl", "www.goo.gl"]);
const MAX_HOPS = 4;

function isGoogleHost(hostname: string): boolean {
  return /(^|\.)google\.[a-z.]+$/i.test(hostname) || SHORT_HOSTS.has(hostname);
}

export async function POST(req: NextRequest) {
  if (!(await isStaff("KML_STANDARD_MARKUP_ALLOW_UNAUTHED"))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  let current: URL;
  try {
    current = new URL((body.url ?? "").trim());
  } catch {
    return NextResponse.json({ ok: false, error: "That isn't a URL." }, { status: 400 });
  }

  if (current.protocol !== "https:" || !SHORT_HOSTS.has(current.hostname)) {
    return NextResponse.json(
      { ok: false, error: "Only Google Maps share links (maps.app.goo.gl) can be resolved." },
      { status: 400 }
    );
  }

  try {
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
        // Google serves the short link a bare redirect for a normal browser UA and an
        // interstitial for an unrecognised one.
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "accept-language": "en-AU,en;q=0.9",
        },
      });

      const location = res.headers.get("location");
      if (!location) break;

      const next = new URL(location, current);
      if (next.protocol !== "https:" || !isGoogleHost(next.hostname)) {
        return NextResponse.json(
          { ok: false, error: "That link redirects off Google — not following it." },
          { status: 400 }
        );
      }

      // Parse each hop as we go: the coordinates usually appear on the first redirect, so
      // there is no need to keep fetching once we have them.
      const hit = parseGoogleMapsUrl(next.toString());
      if (hit && hit.kind !== "shortlink") {
        return NextResponse.json({ ok: true, target: hit satisfies GoogleMapsTarget });
      }
      current = next;
    }

    return NextResponse.json({
      ok: false,
      error:
        "Couldn't read a location out of that share link — open it in Google Maps, then copy the URL from the address bar.",
    });
  } catch (e) {
    const message = (e as Error).name === "TimeoutError" ? "Google didn't respond in time." : (e as Error).message;
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
