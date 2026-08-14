// Turns a raw fetch failure into a message that says WHY, not just "aborted" —
// distinguishes a timeout (AbortController firing) from an actual HTTP/network error,
// and includes how long the call ran before it died. Used to tag geocode vs parcel-query
// failures per state so a generic "(This operation was aborted)" becomes something
// actionable like "VIC geocode timed out after 25011ms".
export function describeFetchError(e: unknown, elapsedMs: number): string {
  const err = e as { name?: string; message?: string };
  if (err?.name === "AbortError") return `timed out after ${elapsedMs}ms`;
  return `failed after ${elapsedMs}ms: ${err?.message ?? String(e)}`;
}
