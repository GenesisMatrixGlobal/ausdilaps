/**
 * The one Anthropic Messages call. Every model call in the repo goes through here — until the
 * 2026-10-05 redundancy sweep there were eight copies of the same headers, fetch, error text,
 * usage recording and text join (the knowledge module had a wrapper nobody else used).
 *
 * Raw fetch, no SDK, on purpose: that is the house style and it keeps this importable from
 * tsx scripts and the cron as well as route handlers. ⚠️ No `server-only` import here for the
 * same reason lib/api-usage.ts has none — lib/tenders/classify.ts and lib/knowledge/ai.ts run
 * under tsx and would break on it.
 *
 * Throws `AnthropicError` on anything short of a 2xx. Callers that must not throw (the
 * tender classifier, the knowledge indexer, the transcript clean-up) catch and degrade, and
 * `error.status` is there for the ones that need to decide whether a retry is worth it.
 */
import { recordApiCall, type AnthropicUsage } from "@/lib/api-usage";

export type AnthropicContentBlock = {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
};

export type AnthropicResponse = {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
  usage?: AnthropicUsage;
};

export class AnthropicError extends Error {
  /** HTTP status, or undefined when the request never got an answer (network, timeout, no key). */
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "AnthropicError";
    this.status = status;
  }
}

export function anthropicConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export type CallAnthropicOptions = {
  /** Abort after this long. Omit for no client-side timeout (the route's own clock applies). */
  timeoutMs?: number;
  /** Which tool to bill on /admin/usage when there is no staff page behind the call (cron,
   *  postbuild). Route handlers leave it off and are attributed from the Referer. */
  tool?: string;
};

export async function callAnthropic(
  body: Record<string, unknown>,
  { timeoutMs, tool }: CallAnthropicOptions = {}
): Promise<AnthropicResponse> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AnthropicError("ANTHROPIC_API_KEY not configured");

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new AnthropicError((e as Error).message);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new AnthropicError(`Anthropic ${res.status}: ${detail.slice(0, 300)}`, res.status);
  }
  const data = (await res.json()) as AnthropicResponse;
  void recordApiCall({ provider: "anthropic", api: "messages", model: String(body.model ?? ""), usage: data.usage, ...(tool ? { tool } : {}) });
  return data;
}

/** Every text block, joined. */
export function textFrom(res: AnthropicResponse): string {
  return (res.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim();
}

/** The `tool_use` block for a forced tool call. Throws when the model answered in prose. */
export function toolInputFrom(res: AnthropicResponse, toolName: string): unknown {
  const block = (res.content ?? []).find((b) => b.type === "tool_use" && b.name === toolName);
  if (!block?.input) {
    throw new AnthropicError(`No tool_use block (stop_reason: ${res.stop_reason ?? "unknown"})`);
  }
  return block.input;
}

/** A base64 image as a user-turn content block. */
export function imageBlock(base64: string, mediaType: string) {
  return { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } } as const;
}

/** The first JSON array in a reply, tolerating code fences and prose around it. `[]` when
 *  there isn't one or it doesn't parse. */
export function parseJsonArray<T = unknown>(text: string): T[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
