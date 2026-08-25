import type { ServiceKey } from "./profile";

/** A tender as the source published it, normalised. Nothing here is model-written. */
export type RawItem = {
  sourceSlug: string;
  /**
   * The dedupe key. Always prefixed with how it was derived ('atm:' / 'guid:' / 'link:' /
   * 'msg:' / 'sha:') so improving the extractor creates NEW rows rather than silently
   * colliding with rows keyed the old way. See lib/tenders/dedupe.ts.
   */
  externalRef: string;
  title: string;
  url?: string | null;
  agency?: string | null;
  jurisdiction?: string | null;
  publishedAt?: string | null; // ISO
  closesAt?: string | null; // ISO
  /** Plain text, already tag-stripped and capped — exactly what the classifier will see. */
  excerpt: string;
  contentHash?: string | null;
  // email sources only
  emailMessageId?: string | null;
  emailFrom?: string | null;
  authResults?: string | null;
  senderTrusted?: boolean;
};

export type FetchResult = {
  /**
   * Stored to tender_scan_runs.raw_payload BEFORE any parsing is trusted. If a portal
   * changes format and the parser yields nothing, the evidence is already in the database
   * and a fixed parser can be replayed over it — no tenders lost during the outage.
   */
  raw: unknown;
  items: RawItem[];
};

export type SourceDefinition = {
  slug: string;
  label: string;
  kind: "rss" | "email";
  /** False when the source's env config is blank — the scan skips it without erroring. */
  configured: () => boolean;
  fetch: (sinceIso: string) => Promise<FetchResult>;
};

/** Validated model output. Every field here started as untrusted text. */
export type Classification = {
  relevance: "match" | "maybe" | "no_match";
  confidence: number; // 0–1
  services: ServiceKey[];
  summary: string;
  reasoning: string;
  injectionSuspected: boolean;
};

export type SourceRunSummary = {
  runId: string;
  sourceSlug: string;
  label: string;
  status: "succeeded" | "partial" | "failed" | "skipped";
  itemsFetched: number;
  itemsNew: number;
  itemsDuplicate: number;
  error?: string | null;
};

export type ScanSummary = {
  runGroupId: string;
  status: "succeeded" | "partial" | "failed" | "skipped";
  sources: SourceRunSummary[];
  itemsClassified: number;
  itemsMatched: number;
  itemsForwarded: number;
  itemsErrored: number;
  pendingRemaining: number;
  notified: boolean;
  error?: string;
};
