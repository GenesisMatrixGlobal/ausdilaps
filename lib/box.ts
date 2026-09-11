// Box API client. Two uses:
//   - reading live folder contents for the site (the sample reports library)
//   - uploading a generated site markup into a job's folder (Sync To Salesforce)
//
// The upload path means this is no longer read-only, and the Box app's scopes have to
// match: the Custom App needs "Write all files and folders" re-authorised by a Box admin,
// and the Service Account needs Editor on the JOB folder tree it uploads into. The samples
// folder is different: there it stays Viewer, which is enough to create shared links.
//
// Auth: Client Credentials Grant (server-to-server, no user login). Requires a Box Custom
// App authorised in the Box Admin Console, with its Service Account added as a
// collaborator on any folder it touches. See docs/box-samples-sync.md for the setup.

export type BoxSample = {
  name: string;
  /** Public Box shared-link URL — the site never hosts the file itself. */
  url: string;
  /** Lower-cased, no dot (`pdf`, `mov`). Drives the type icon and label on the page. */
  extension: string;
  /** From Box's `size` field, so a visitor knows what they're opening before they open it. */
  sizeBytes: number;
};

export type BoxCategory = {
  name: string;
  samples: BoxSample[];
};

/** Category label for files sitting loose in the root folder, outside any subfolder. */
const UNCATEGORIZED = "Other";

/**
 * The only file types the samples page will publish. `resolveSamples()` creates a PUBLIC
 * shared link on every file it finds, and several people (including external collaborators)
 * hold Editor on the folder — so a stray spreadsheet or Word document dropped in by mistake
 * must not become a public download on the marketing site. Anything else is logged and left
 * out; the file itself is untouched.
 */
const SAMPLE_EXTENSIONS = new Set(["pdf", "png", "jpg", "jpeg", "mp4", "mov"]);

export function fileExtension(name: string): string {
  const m = name.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "";
}

type BoxTokenResponse = { access_token: string; expires_in: number };

type BoxFileItem = {
  type: "file" | "folder";
  id: string;
  name: string;
  shared_link?: { url: string } | null;
  /** Bytes. Present on files when `size` is requested; folders report the tree total. */
  size?: number;
};

export class BoxConfigError extends Error {}
/** Thrown when a filename is already taken in the destination folder, so callers can offer
 *  a rename instead of reporting a generic failure. */
export class BoxNameConflictError extends Error {}

export async function getAccessToken(): Promise<string> {
  const clientId = process.env.BOX_CLIENT_ID;
  const clientSecret = process.env.BOX_CLIENT_SECRET;
  const enterpriseId = process.env.BOX_ENTERPRISE_ID;
  if (!clientId || !clientSecret || !enterpriseId) {
    throw new BoxConfigError(
      "Box isn't configured — set BOX_CLIENT_ID, BOX_CLIENT_SECRET and BOX_ENTERPRISE_ID."
    );
  }

  const res = await fetch("https://api.box.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      box_subject_type: "enterprise",
      box_subject_id: enterpriseId,
    }),
    // No cache directive on purpose. This is a POST, which Next never caches, so
    // the token is still fetched once per regeneration. Setting `cache: "no-store"`
    // here (as this used to) opts the WHOLE route out of static rendering — the
    // samples page then rendered fully dynamic, every visit hit Box live, and the
    // ISR safety net that makes a Box outage invisible silently did not exist.
  });
  if (!res.ok) throw new Error(`Box token request failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as BoxTokenResponse;
  return data.access_token;
}

/**
 * Ensure a file has a shared link, creating one if missing.
 *
 * `access` matters: "open" is a public, no-login URL — right for the marketing samples
 * library, wrong for a job document. Callers filing work into a client folder pass
 * "company" so the link only resolves for signed-in enterprise users.
 *
 * Note this overwrites any existing link's access level, which is intentional — the caller
 * knows what the file is for better than whatever it was last set to.
 */
export interface BoxSharedLink {
  /** The preview page — `app.box.com/s/{name}`. Opens Box's viewer in a browser, which is
   *  what a person wants when they click through from a record. */
  url: string;
  /** What Box's own UI labels "Direct Link" — `app.box.com/shared/static/{name}.{ext}`.
   *  Serves the file bytes, so it's the one any document-merge or fetch-the-image
   *  consumer needs; `url` hands them an HTML page instead.
   *
   *  Null when Box withholds it (downloads disabled on the link, or a folder rather than
   *  a file). Callers that need bytes should treat null as a failure worth reporting
   *  rather than quietly falling back to the preview page, which is the very bug this
   *  distinction exists to prevent. */
  downloadUrl: string | null;
}

export async function ensureSharedLink(
  fileId: string,
  token: string,
  access: "open" | "company" = "open"
): Promise<BoxSharedLink> {
  const res = await fetch(`https://api.box.com/2.0/files/${fileId}?fields=shared_link`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ shared_link: { access } }),
    // See getAccessToken() — no directive, so this PUT doesn't force the route dynamic.
  });
  if (!res.ok) throw new Error(`Box create shared link failed for ${fileId}: ${res.status}`);
  const data = (await res.json()) as {
    shared_link?: { url: string; download_url?: string | null };
  };
  if (!data.shared_link?.url) throw new Error(`Box returned no shared_link for ${fileId}`);
  return { url: data.shared_link.url, downloadUrl: data.shared_link.download_url ?? null };
}

export async function listFolderItems(folderId: string, token: string): Promise<BoxFileItem[]> {
  const res = await fetch(
    `https://api.box.com/2.0/folders/${folderId}/items?fields=name,type,shared_link,size&limit=200&sort=name&direction=ASC`,
    // Keep in sync with `export const revalidate` in
    // app/(marketing)/dilapidation-reports/samples/page.tsx — this is what lets the
    // page be ISR-cached rather than fully dynamic.
    { headers: { Authorization: `Bearer ${token}` }, next: { revalidate: 1800 } }
  );
  if (!res.ok) throw new Error(`Box list folder failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { entries: BoxFileItem[] };
  return data.entries;
}

async function resolveSamples(files: BoxFileItem[], token: string): Promise<BoxSample[]> {
  const publishable = files.filter((f) => {
    const ok = SAMPLE_EXTENSIONS.has(fileExtension(f.name));
    if (!ok) console.warn(`[box] not a sample file type, left unpublished: "${f.name}"`);
    return ok;
  });

  // allSettled, not all: a single file whose shared-link PUT fails (a file the service
  // account can't see, or a Box hiccup) would otherwise reject the whole call and take
  // the entire samples page down. Drop that row instead. Note the account only needs
  // VIEWER on the samples folder — a Viewer can create shared links (verified 2026-09-11)
  // and cannot delete, which is the least privilege the read-only page should hold.
  const settled = await Promise.allSettled(
    publishable.map(async (f) => ({
      name: f.name,
      // Preview page on purpose: these are sample reports a visitor opens and reads.
      url: f.shared_link?.url ?? (await ensureSharedLink(f.id, token)).url,
      extension: fileExtension(f.name),
      sizeBytes: f.size ?? 0,
    }))
  );
  const samples: BoxSample[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") samples.push(r.value);
    else console.error(`[box] skipped file "${publishable[i].name}":`, r.reason);
  });
  return samples.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Build the samples page's category list from a Box folder: every immediate
 * subfolder becomes a category (named after the subfolder), its files become
 * that category's samples. Files sitting loose in the root, not filed into
 * any subfolder, land in a trailing "Other" category — so nothing silently
 * disappears if it hasn't been sorted yet. One level of subfolders only.
 */
export async function listBoxFolderCategories(folderId: string): Promise<BoxCategory[]> {
  const token = await getAccessToken();
  const rootItems = await listFolderItems(folderId, token);

  const subfolders = rootItems.filter((e) => e.type === "folder");
  const rootFiles = rootItems.filter((e) => e.type === "file");

  const settledCategories = await Promise.allSettled(
    subfolders.map(async (folder) => {
      const items = await listFolderItems(folder.id, token);
      const files = items.filter((e) => e.type === "file");
      return { name: folder.name, samples: await resolveSamples(files, token) };
    })
  );
  const categories: BoxCategory[] = [];
  settledCategories.forEach((r, i) => {
    if (r.status === "fulfilled") categories.push(r.value);
    else console.error(`[box] skipped category "${subfolders[i].name}":`, r.reason);
  });

  const nonEmpty = categories.filter((c) => c.samples.length > 0);

  if (rootFiles.length > 0) {
    nonEmpty.push({ name: UNCATEGORIZED, samples: await resolveSamples(rootFiles, token) });
  }

  return nonEmpty;
}

/**
 * Folder id out of a Box folder URL. Returns null when the URL isn't a Box folder link.
 *
 * Any number of path segments may sit before `folder/`, which matters in practice: the
 * Opportunity's Box Folder Link field holds *embed* URLs
 * (`https://ausdilaps.app.box.com/embed/folder/407915747083?partner_id=219&...`), not the
 * plain `/folder/<id>` form you get from the address bar. A pattern anchored straight after
 * the host silently fails on every real record and sends the operator to the manual-paste
 * fallback each time. Also covers shared-link folders (`/s/<hash>/folder/<id>`).
 */
export function parseBoxFolderId(url: string): string | null {
  const match = url.trim().match(/box\.com\/(?:[^/?#]+\/)*folder\/(\d+)/i);
  return match ? match[1] : null;
}

/** Immediate child folder by name — case-insensitive and trimmed, since folder naming
 *  conventions drift ("2. Estimations" vs "2.  Estimations"). Folders only; a file of the
 *  same name is not a match. */
export async function findChildFolder(
  parentId: string,
  name: string,
  token: string
): Promise<{ id: string; name: string } | null> {
  const wanted = name.trim().toLowerCase();
  const items = await listFolderItems(parentId, token);
  const hit = items.find((e) => e.type === "folder" && e.name.trim().toLowerCase() === wanted);
  return hit ? { id: hit.id, name: hit.name } : null;
}

/** Box rejects these outright in filenames; strip rather than fail so an operator's chosen
 *  name is honoured as closely as possible. */
export function sanitiseBoxFilename(name: string): string {
  return name.replace(/[/\\]/g, "-").replace(/\s+/g, " ").trim().slice(0, 240);
}

export interface BoxUploadResult {
  id: string;
  name: string;
}

/** Uploads a new file. Throws BoxNameConflictError on 409 so the caller can offer a rename
 *  rather than silently creating a second version or an auto-suffixed duplicate. */
export async function uploadFile(opts: {
  folderId: string;
  filename: string;
  bytes: Uint8Array;
  contentType?: string;
  token: string;
}): Promise<BoxUploadResult> {
  const name = sanitiseBoxFilename(opts.filename);
  if (!name) throw new Error("The file needs a name.");

  const form = new FormData();
  form.append(
    "attributes",
    JSON.stringify({ name, parent: { id: opts.folderId } })
  );
  form.append(
    "file",
    new Blob([new Uint8Array(opts.bytes)], { type: opts.contentType ?? "image/png" }),
    name
  );

  const res = await fetch("https://upload.box.com/api/2.0/files/content", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.token}` },
    body: form,
    cache: "no-store",
  });

  if (res.status === 409) {
    throw new BoxNameConflictError(
      `"${name}" already exists in that folder — rename the file and try again.`
    );
  }
  if (!res.ok) {
    throw new Error(`Box upload failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }

  const data = (await res.json()) as { entries?: BoxUploadResult[] };
  const entry = data.entries?.[0];
  if (!entry) throw new Error("Box accepted the upload but returned no file details.");
  return entry;
}
