// The option lists the enquiry form renders — and NOTHING else. This file exists so the
// client bundle can read them without pulling in zod: lib/leads.ts (the schema, the tier
// classifier) imports zod, and importing one constant from it put a 63KB (gz) zod chunk
// on every marketing page via the prefetched / and /quote routes (speed sweep, 2026-10-06).
// Server code keeps importing from lib/leads.ts, which re-exports these.

export const INQUIRY_TYPES = [
  "New Quote",
  "I Received An Access Letter",
  "Report Inquiry",
  "General Inquiry",
] as const;
export type InquiryType = (typeof INQUIRY_TYPES)[number];

export const PROPERTY_ROLES = ["Tenant", "Property Owner", "Property Agent", "Other"] as const;

export const CONTACT_METHODS = ["SMS", "Call", "Email"] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

export const AU_STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"] as const;

export const ASSET_COUNT_RANGES = ["<10", "10-100", "100+"] as const;
export type AssetCountRange = (typeof ASSET_COUNT_RANGES)[number];

