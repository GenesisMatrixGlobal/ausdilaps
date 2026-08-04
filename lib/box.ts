// Box API client for pulling live folder contents into the site (currently:
// the sample reports library). Read-only — the site never uploads/deletes.
//
// Auth: Client Credentials Grant (server-to-server, no user login). Requires
// a Box Custom App authorised in the Box Admin Console, with its Service
// Account added as a collaborator on any folder it needs to read. See
// docs/box-samples-sync.md for the one-time setup.

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

async function getAccessToken(): Promise<string> {
  const clientId = process.env.BOX_CLIENT_ID;
  const clientSecret = process.env.BOX_CLIENT_SECRET;
  const enterpriseId = process.env.BOX_ENTERPRISE_ID;
  if (!clientId || !clientSecret || !enterpriseId) {
    throw new Error("Box not configured (BOX_CLIENT_ID / BOX_CLIENT_SECRET / BOX_ENTERPRISE_ID)");
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

/** Ensure a file has an open (public, no-login) shared link, creating one if missing. */
async function ensureSharedLink(fileId: string, token: string): Promise<string> {
  const res = await fetch(`https://api.box.com/2.0/files/${fileId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ shared_link: { access: "open" } }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Box create shared link failed for ${fileId}: ${res.status}`);
  const data = (await res.json()) as { shared_link?: { url: string } };
  if (!data.shared_link?.url) throw new Error(`Box returned no shared_link for ${fileId}`);
  return data.shared_link.url;
}

async function listFolderItems(folderId: string, token: string): Promise<BoxFileItem[]> {
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
