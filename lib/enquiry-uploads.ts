import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { secretMatches } from "@/lib/auth/shared-secret";
import { cleanUploadName, nameFromUploadKey, sniffUpload, uploadKeyFor } from "@/lib/enquiry-upload-sniff";
import {
  MAX_UPLOAD_FILES,
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_TOTAL_BYTES,
  UPLOAD_MIME_TYPES,
  uploadTypeFor,
} from "@/lib/enquiry-uploads-options";

// Attachments on the enquiry form: a brief stop between the browser and the email.
//
// The browser PUTs each file straight into a private bucket on a signed upload URL
// (Vercel caps a request body at 4.5 MB, so a site plan can't pass through a route).
// /api/quote then reads them back, attaches them to the notice to info@, and deletes them.
// Nothing is kept once that email has gone. If it can't be attached, the files are moved
// under the lead's id and the email carries download links instead.
//
// Same trust model as the knowledge bucket (0009): private, NO storage.objects policies,
// every write on a server-minted signed URL. The anon key alone reaches nothing here.

export const ENQUIRY_BUCKET = "enquiry-uploads";

/** How long after the upload URLs are issued the form may still be submitted with them. */
const TICKET_TTL_MS = 30 * 60 * 1000;
/** Uploads never claimed by a submission are swept after this. */
const ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;
/** `<epoch ms>-<uuid>` — the timestamp is what lets the sweep find old folders by name. */
const UPLOAD_ID_PATTERN = /^(\d{13})-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let ensured = false;

/** Creates the bucket if it is missing. Migration 0031 creates it too, but migrations here
 *  are hand-pasted into the SQL editor; whichever runs first wins and the other is a no-op. */
async function ensureBucket(): Promise<void> {
  if (ensured) return;
  const { error } = await createAdminClient().storage.createBucket(ENQUIRY_BUCKET, {
    public: false,
    fileSizeLimit: MAX_UPLOAD_FILE_BYTES,
    allowedMimeTypes: UPLOAD_MIME_TYPES,
  });
  // "already exists" arrives as an error, not a success — that is the normal case.
  if (error && !/exist/i.test(error.message)) {
    throw new Error(`Could not create the ${ENQUIRY_BUCKET} bucket: ${error.message}`);
  }
  // An existing bucket keeps the limits it was created with, so a file type added to
  // UPLOAD_TYPES later would be refused by Storage. Once per cold start, make it match.
  if (error) {
    const { error: updateError } = await createAdminClient().storage.updateBucket(ENQUIRY_BUCKET, {
      public: false,
      fileSizeLimit: MAX_UPLOAD_FILE_BYTES,
      allowedMimeTypes: UPLOAD_MIME_TYPES,
    });
    if (updateError) console.warn(`[quote] could not update the ${ENQUIRY_BUCKET} bucket: ${updateError.message}`);
  }
  ensured = true;
}

/** The ticket proves this upload batch was issued by us, after the bot check. Keyed on the
 *  service-role key so there is no extra secret to configure. */
function ticketFor(uploadId: string): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? "";
  return createHmac("sha256", key).update(`enquiry-upload:${uploadId}`).digest("hex");
}

export function ticketIsValid(uploadId: string, ticket: string): boolean {
  const issued = Number(UPLOAD_ID_PATTERN.exec(uploadId)?.[1]);
  if (!issued || Date.now() - issued > TICKET_TTL_MS) return false;
  return secretMatches(ticket, ticketFor(uploadId));
}

export type UploadSlot = { signedUrl: string; contentType: string };

/** Signed upload URLs for one submission's files, in the order given. */
export async function issueUploadSlots(
  files: { name: string }[]
): Promise<{ uploadId: string; ticket: string; uploads: UploadSlot[] }> {
  await ensureBucket();
  const bucket = createAdminClient().storage.from(ENQUIRY_BUCKET);
  const uploadId = `${Date.now()}-${randomUUID()}`;
  const uploads = await Promise.all(
    files.map(async (f, i) => {
      // Judged on the cleaned name, because that is the name the email will carry.
      const contentType = uploadTypeFor(cleanUploadName(f.name));
      if (!contentType) throw new Error(`Not an accepted file type: ${f.name}`);
      const { data, error } = await bucket.createSignedUploadUrl(
        `pending/${uploadId}/${uploadKeyFor(i + 1, f.name)}`
      );
      if (error || !data) throw new Error(`Could not prepare the upload: ${error?.message ?? "no data"}`);
      return { signedUrl: data.signedUrl, contentType };
    })
  );
  return { uploadId, ticket: ticketFor(uploadId), uploads };
}

export type EnquiryFile = {
  /** Object key in the bucket. */
  path: string;
  /** The name shown in the email — the uploader's own, decoded from the object key. */
  filename: string;
  bytes: Buffer;
};

export type EnquiryFiles = {
  files: EnquiryFile[];
  /** Names dropped because the contents weren't an accepted type, or the batch ran over a limit. */
  rejected: string[];
  /** Every object in the batch, kept or not — what `discardUploads` removes. */
  paths: string[];
};

/** Reads one submission's uploads back. An empty `paths` means nothing arrived, or the
 *  batch has already been used — a ticket is good for one submission. */
export async function collectUploads(uploadId: string): Promise<EnquiryFiles> {
  const bucket = createAdminClient().storage.from(ENQUIRY_BUCKET);
  const folder = `pending/${uploadId}`;
  const { data, error } = await bucket.list(folder, { limit: 50, sortBy: { column: "name", order: "asc" } });
  if (error) throw new Error(`Could not list the uploads: ${error.message}`);

  const out: EnquiryFiles = { files: [], rejected: [], paths: [] };
  let total = 0;
  for (const entry of data ?? []) {
    const path = `${folder}/${entry.name}`;
    const filename = nameFromUploadKey(entry.name);
    out.paths.push(path);
    const size = Number((entry.metadata as { size?: number } | null)?.size ?? 0);
    if (out.files.length >= MAX_UPLOAD_FILES || total + size > MAX_UPLOAD_TOTAL_BYTES) {
      out.rejected.push(filename);
      continue;
    }
    const { data: blob, error: dlError } = await bucket.download(path);
    if (dlError || !blob) {
      console.error(`[quote] could not read upload ${path}:`, dlError?.message);
      out.rejected.push(filename);
      continue;
    }
    const bytes = Buffer.from(await blob.arrayBuffer());
    if (!sniffUpload(bytes)) {
      out.rejected.push(filename);
      continue;
    }
    total += bytes.length;
    out.files.push({ path, filename, bytes });
  }
  return out;
}

/** Best effort; a leftover object is swept within a day. */
export async function discardUploads(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    const { error } = await createAdminClient().storage.from(ENQUIRY_BUCKET).remove(paths);
    if (error) console.warn(`[quote] could not delete uploads: ${error.message}`);
  } catch (e) {
    console.warn(`[quote] could not delete uploads: ${(e as Error).message}`);
  }
}

/**
 * The fallback for when the files couldn't be attached: move them under the lead's id (so
 * the sweep leaves them alone and the ticket can't be replayed) and return a week-long
 * download link for each. A file that can't be moved or signed is simply left out.
 */
export async function keepUploadsForLead(
  leadId: string,
  files: EnquiryFile[]
): Promise<{ filename: string; url: string }[]> {
  const bucket = createAdminClient().storage.from(ENQUIRY_BUCKET);
  const links: { filename: string; url: string }[] = [];
  for (const f of files) {
    const kept = `leads/${leadId}/${f.path.split("/").pop()}`;
    const { error: moveError } = await bucket.move(f.path, kept);
    // `download` gives the link the real file name; the object key is the encoded one.
    const { data } = await bucket.createSignedUrl(moveError ? f.path : kept, 7 * 24 * 60 * 60, {
      download: f.filename,
    });
    if (data?.signedUrl) links.push({ filename: f.filename, url: data.signedUrl });
  }
  return links;
}

/** Deletes upload batches nobody submitted. Called after issuing new slots, so the bucket
 *  cleans itself at the rate it is used and needs no cron. */
export async function sweepOrphanUploads(): Promise<void> {
  try {
    const bucket = createAdminClient().storage.from(ENQUIRY_BUCKET);
    const { data } = await bucket.list("pending", { limit: 100, sortBy: { column: "name", order: "asc" } });
    for (const folder of data ?? []) {
      const issued = Number(UPLOAD_ID_PATTERN.exec(folder.name)?.[1]);
      if (!issued || Date.now() - issued < ORPHAN_TTL_MS) continue;
      const { data: objects } = await bucket.list(`pending/${folder.name}`, { limit: 50 });
      await discardUploads((objects ?? []).map((o) => `pending/${folder.name}/${o.name}`));
    }
  } catch (e) {
    console.warn(`[quote] upload sweep failed: ${(e as Error).message}`);
  }
}
