// Box API client. Two uses:
//   - reading live folder contents for the site (the sample reports library)
//   - uploading a generated site markup into a job's folder (Sync To Salesforce)
//
// The upload path means this is no longer read-only, and the Box app's scopes have to
// match: the Custom App needs "Write all files and folders" re-authorised by a Box admin,
// and the Service Account needs Editor (not Viewer) on the target folder tree.
//
// Auth: Client Credentials Grant (server-to-server, no user login). Requires a Box Custom
// App authorised in the Box Admin Console, with its Service Account added as a
// collaborator on any folder it touches. See docs/box-samples-sync.md for the setup.

export type BoxSample = {
  name: string;
  /** Public Box shared-link URL — the site never hosts the file itself. */
  url: string;
};

export type BoxCategory = {
  name: string;
  samples: BoxSample[];
};

/** Category label for files sitting loose in the root folder, outside any subfolder. */
const UNCATEGORIZED = "Other";

type BoxTokenResponse = { access_token: string; expires_in: number };

type BoxFileItem = {
  type: "file" | "folder";
  id: string;
  name: string;
  shared_link?: { url: string } | null;
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
    // Token calls are only made once per ISR regeneration — never cache across requests.
    cache: "no-store",
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
export async function ensureSharedLink(
  fileId: string,
  token: string,
  access: "open" | "company" = "open"
): Promise<string> {
  const res = await fetch(`https://api.box.com/2.0/files/${fileId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ shared_link: { access } }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Box create shared link failed for ${fileId}: ${res.status}`);
  const data = (await res.json()) as { shared_link?: { url: string } };
  if (!data.shared_link?.url) throw new Error(`Box returned no shared_link for ${fileId}`);
  return data.shared_link.url;
}

export async function listFolderItems(folderId: string, token: string): Promise<BoxFileItem[]> {
  const res = await fetch(
    `https://api.box.com/2.0/folders/${folderId}/items?fields=name,type,shared_link&limit=200&sort=name&direction=ASC`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`Box list folder failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { entries: BoxFileItem[] };
  return data.entries;
}

async function resolveSamples(files: BoxFileItem[], token: string): Promise<BoxSample[]> {
  const samples = await Promise.all(
    files.map(async (f) => ({
      name: f.name,
      url: f.shared_link?.url ?? (await ensureSharedLink(f.id, token)),
    }))
  );
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

  const categories = await Promise.all(
    subfolders.map(async (folder) => {
      const items = await listFolderItems(folder.id, token);
      const files = items.filter((e) => e.type === "file");
      return { name: folder.name, samples: await resolveSamples(files, token) };
    })
  );

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
