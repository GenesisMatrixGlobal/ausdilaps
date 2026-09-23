// The shape of a Box file link. Pure — box-source.ts (server-only) and check:transcript both read it.

export type BoxFileLink = { kind: "file"; fileId: string } | { kind: "shared"; url: string };

/**
 * The two shapes a Box file link takes. Pure.
 *   https://ausdilaps.app.box.com/file/1234567890            → a file id
 *   https://ausdilaps.app.box.com/s/abcd…  (a shared link)   → resolved through /shared_items
 * A FOLDER link is deliberately not accepted — this transcribes one recording.
 */
export function parseBoxFileLink(input: string): BoxFileLink | null {
  const url = input.trim();
  const file = /box\.com\/(?:[^/?#]+\/)*file\/(\d+)/i.exec(url);
  if (file) return { kind: "file", fileId: file[1] };
  if (/^https:\/\/[a-z0-9.-]*box\.com\/s\/[A-Za-z0-9]+/i.test(url)) return { kind: "shared", url: url.split(/[?#]/)[0] };
  return null;
}

