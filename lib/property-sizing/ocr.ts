// Screenshot -> structured addresses, via Claude vision (Anthropic Messages API).
// Called over plain fetch to match the repo's integration style (no SDK dependency).
// Env-gated: no ANTHROPIC_API_KEY -> the tool still works from pasted text.

import type { ParsedAddress } from "./types";
import { normalizeState, parseAddressLine } from "./parse";
import { recordApiCall, type AnthropicUsage } from "@/lib/api-usage";

const OCR_MODEL = process.env.ANTHROPIC_OCR_MODEL ?? "claude-haiku-4-5-20251001";

export function ocrConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

const PROMPT = `You are extracting a list of Australian property addresses from a screenshot (usually a spreadsheet/table).
Return ONLY a JSON array. Each element must be:
{"id": string|null, "raw": string, "street": string, "suburb": string, "state": string|null, "postcode": string|null, "unit": string|null}
- "id" = any reference/ID shown beside the address (else null).
- "raw" = the full address text exactly as written.
- "street" = street number + name only (e.g. "8 Ironwood Ct").
- "suburb" = the suburb/locality only.
- "state" = one of QLD, NSW, VIC, SA, WA, TAS, ACT, NT (else null).
- "unit" = the unit/strata number if it is a unit address (else null).
Include EVERY row, even rows that are not real titled properties (e.g. a bridge or road) — put the text in "street" and fill the rest as best you can. Never invent or auto-complete addresses. Output the JSON array only, no prose.`;

interface OcrRow {
  id?: string | null;
  raw?: string;
  street?: string;
  suburb?: string;
  state?: string | null;
  postcode?: string | null;
  unit?: string | null;
}

export async function extractAddressesFromImage(
  base64: string,
  mediaType: string
): Promise<ParsedAddress[]> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: OCR_MODEL,
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: AnthropicUsage };
  void recordApiCall({ provider: "anthropic", api: "messages", model: OCR_MODEL, usage: data.usage });
  const text =
    data.content
      ?.filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("") ?? "";

  return parseJsonArray(text)
    .map(normalizeRow)
    .filter((a): a is ParsedAddress => !!a);
}

/** Tolerate code fences / prose around the JSON array. */
function parseJsonArray(text: string): OcrRow[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? (parsed as OcrRow[]) : [];
  } catch {
    return [];
  }
}

function normalizeRow(r: OcrRow): ParsedAddress | null {
  const raw = (r.raw ?? "").trim();
  const street = (r.street ?? "").trim();
  if (!raw && !street) return null;

  if (street) {
    return {
      id: r.id ?? undefined,
      raw: raw || street,
      street,
      suburb: (r.suburb ?? "").trim(),
      state: normalizeState(r.state),
      postcode: r.postcode ?? undefined,
      unit: r.unit ?? undefined,
    };
  }
  return parseAddressLine(raw, r.id ?? undefined);
}
