// Which departments may FILE to Box and WRITE to Salesforce through each sync.
//
// Pure constants, imported by BOTH the tool registry and the upload/resolve routes, so a
// tool's card and its API can never disagree about who has access (the Tender Watch
// arrangement in lib/tenders/config.ts). Admins pass everywhere, as usual.

import type { DepartmentSlug } from "@/lib/departments";

/** Markup and Measure (SMK) — the Sync To Salesforce panel and its resolve/upload routes. */
export const MARKUP_SYNC_DEPARTMENTS: readonly DepartmentSlug[] = ["estimators"];

/** Cover Photo Generator (CVR). */
export const COVER_PHOTO_DEPARTMENTS: readonly DepartmentSlug[] = ["reports"];
