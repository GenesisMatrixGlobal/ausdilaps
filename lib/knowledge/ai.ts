import "server-only";

import { randomUUID } from "node:crypto";

/** Shared Anthropic plumbing for knowledge ingest.
 *
 *  Follows lib/tenders/classify.ts, which is the house pattern and already hardened:
 *  raw fetch (three modules here call the API this way — no SDK), env-gated, model
 *  from env with a default, instructions in `system` with content in the user turn,
 *  and content fenced inside a random-id tag with forged delimiters scrubbed first.
 *
 *  EVERY caller must treat failure as non-fatal. An uploaded document that the model
 *  cannot read is still a document worth storing and searching on its extracted text;
 *  a knowledge base that refuses uploads when an API key expires is worse than one
 *  with slightly weaker indexing. */

export const KNOWLEDGE_MODEL = process.env.KNOWLEDGE_MODEL ?? "claude-opus-5";

/** Anthropic's own ceiling is 32MB for the whole request. Base64 inflates by ~4/3, so
 *  a 25MB PDF (our upload cap) would arrive as ~34MB and be rejected. Stop earlier and
 *  fall back to text extraction rather than spend a minute encoding a doomed request. */
export const MAX_PDF_BYTES_FOR_VISION = 20 * 1024 * 1024;

const TIMEOUT_MS = 240_000;

export function aiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/** Wraps untrusted content in a tag the model is told to treat as data, after removing
 *  any forged copy of that tag from the content itself — which closes the
 *  forge-the-delimiter attack outright rather than hoping the model notices.
 *
 *  An uploaded PDF is untrusted: staff upload it, but it can have come from a client,
 *  a subcontractor, or the internet. */
export function fenced(tag: string, text: string): string {
  const id = randomUUID();
  const scrubbed = text.replace(new RegExp(`</?${tag}\\b[^>]*>`, "gi"), "[removed]");
  return `<${tag} id="${id}">\n${scrubbed}\n</${tag}>`;
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "document"; source: { type: "base64"; media_type: string; data: string } };

type AnthropicResponse = {
  content?: { type: string; text?: string; name?: string; input?: unknown }[];
  stop_reason?: string;
};

/** One call. Throws on any failure — callers catch and degrade. */
export async function callAnthropic(body: Record<string, unknown>): Promise<AnthropicResponse> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as AnthropicResponse;
}

export function textFrom(res: AnthropicResponse): string {
  return (res.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim();
}

export function toolInputFrom(res: AnthropicResponse, toolName: string): unknown {
  const block = (res.content ?? []).find((b) => b.type === "tool_use" && b.name === toolName);
  if (!block?.input) {
    throw new Error(`No tool_use block (stop_reason: ${res.stop_reason ?? "unknown"})`);
  }
  return block.input;
}

export type { ContentBlock };
