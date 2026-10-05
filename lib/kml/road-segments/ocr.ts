// Screenshot -> structured road segments, via Claude vision (Anthropic Messages API).
// Called over plain fetch to match the repo's integration style (no SDK dependency).
// Env-gated: no ANTHROPIC_API_KEY -> the tool still works from a manually entered row.

import type { RoadSegmentInput } from "./types";
import { anthropicConfigured, callAnthropic, imageBlock, parseJsonArray, textFrom } from "@/lib/anthropic";

const OCR_MODEL = process.env.ANTHROPIC_OCR_MODEL ?? "claude-haiku-4-5-20251001";

export const ocrConfigured = anthropicConfigured;

const PROMPT = `You are extracting rows from a screenshot of a council road/footpath asset register (a spreadsheet/table).
Return ONLY a JSON array. Each element must be:
{"zone": string|null, "location": string, "roadNo": string|null, "roadName": string, "fromDesc": string, "toDesc": string, "footpathLengthKm": number|null}
- "zone" = the ZONE column value, if present (else null).
- "location" = the suburb/locality column (e.g. "Kuraby").
- "roadNo" = the ROAD_NO column, if present (else null).
- "roadName" = the road name column (e.g. "Beenleigh Rd").
- "fromDesc" = the FROM DESC column — the cross-street/landmark the segment starts at.
- "toDesc" = the TO DESC column — the cross-street/landmark the segment ends at.
- "footpathLengthKm" = the footpath length column as a plain number in kilometres (convert from metres if the column looks like metres). If the cell says "N/A", is blank, or isn't a number, use null.
Include EVERY data row, even ones with blank/N/A cells — fill what you can and use null for the rest. Never invent values that aren't in the image. Output the JSON array only, no prose.`;

interface OcrRow {
  zone?: string | null;
  location?: string;
  roadNo?: string | null;
  roadName?: string;
  fromDesc?: string;
  toDesc?: string;
  footpathLengthKm?: number | null;
}

export async function extractRoadSegmentsFromImage(
  base64: string,
  mediaType: string
): Promise<RoadSegmentInput[]> {
  const res = await callAnthropic({
    model: OCR_MODEL,
    max_tokens: 8192,
    messages: [{ role: "user", content: [imageBlock(base64, mediaType), { type: "text", text: PROMPT }] }],
  });
  return parseJsonArray<OcrRow>(textFrom(res))
    .map(normalizeRow)
    .filter((r): r is RoadSegmentInput => !!r);
}

function normalizeRow(r: OcrRow): RoadSegmentInput | null {
  const roadName = (r.roadName ?? "").trim();
  const location = (r.location ?? "").trim();
  if (!roadName || !location) return null;

  return {
    zone: r.zone ?? undefined,
    location,
    roadNo: r.roadNo ?? undefined,
    roadName,
    fromDesc: (r.fromDesc ?? "").trim(),
    toDesc: (r.toDesc ?? "").trim(),
    footpathLengthKm: typeof r.footpathLengthKm === "number" ? r.footpathLengthKm : null,
  };
}
