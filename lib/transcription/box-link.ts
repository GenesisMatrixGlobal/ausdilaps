// The shapes a Box link takes. Pure — box-source.ts (server-only) and check:transcript both read it.

export type BoxLink =
  | { kind: "file"; fileId: string }
  | { kind: "folder"; folderId: string }
  | { kind: "shared"; url: string };

/**
 *   https://ausdilaps.app.box.com/file/1234567890     → one recording
 *   https://ausdilaps.app.box.com/folder/987654321    → every audio file in the folder
 *   https://ausdilaps.app.box.com/s/abcd…              → a shared link to either; Box says which
 * `/folder/99/file/123` is the FILE (the folder is only the breadcrumb Box puts in the URL).
 */
export function parseBoxLink(input: string): BoxLink | null {
  const url = input.trim();
  const file = /box\.com\/(?:[^/?#]+\/)*file\/(\d+)/i.exec(url);
  if (file) return { kind: "file", fileId: file[1] };
  const folder = /box\.com\/(?:[^/?#]+\/)*folder\/(\d+)/i.exec(url);
  if (folder) return { kind: "folder", folderId: folder[1] };
  if (/^https:\/\/[a-z0-9.-]*box\.com\/s\/[A-Za-z0-9]+/i.test(url)) return { kind: "shared", url: url.split(/[?#]/)[0] };
  return null;
}

/** Every Box link in a pasted block, one per line or run together, in order, deduplicated. */
export function extractBoxLinks(text: string): string[] {
  const found = text.match(/https?:\/\/[a-z0-9.-]*box\.com\/[^\s"'<>]+/gi) ?? [];
  return [...new Set(found.map((u) => u.replace(/[),.;]+$/, "")))];
}
