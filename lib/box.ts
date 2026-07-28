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

/**
 * List every file in a Box folder (flat — subfolders are ignored) with a
 * public shared link each, creating shared links for any file that doesn't
 * already have one.
 */
export async function listBoxFolderSamples(folderId: string): Promise<BoxSample[]> {
  const token = await getAccessToken();

  const res = await fetch(
    `https://api.box.com/2.0/folders/${folderId}/items?fields=name,type,shared_link&limit=200`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`Box list folder failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { entries: BoxFileItem[] };

  const files = data.entries.filter((e) => e.type === "file");

  const samples = await Promise.all(
    files.map(async (f) => ({
      name: f.name,
      url: f.shared_link?.url ?? (await ensureSharedLink(f.id, token)),
    }))
  );

  // Stable, readable order.
  return samples.sort((a, b) => a.name.localeCompare(b.name));
}
