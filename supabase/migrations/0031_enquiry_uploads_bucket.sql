-- 0031: the `enquiry-uploads` bucket for attachments on the enquiry form.
--
-- A visitor's PDFs and photos are PUT straight from the browser into this bucket on a signed
-- upload URL (Vercel's 4.5 MB body cap is why they never pass through a route), read back by
-- /api/quote, attached to the notice to info@ and deleted. Objects under `pending/` should
-- never be more than a day old; `leads/<lead id>/` holds only files that could not be attached.
--
-- Same design as `knowledge` (0009): private, NO storage.objects policies. Every write is on a
-- server-minted signed URL, so the anon key alone can reach nothing here.
--
-- NOTE: lib/enquiry-uploads.ts also creates this bucket on first use (ensureBucket), so the
-- form works before this file is pasted into the SQL editor. Whichever runs first wins.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'enquiry-uploads',
  'enquiry-uploads',
  false,
  10485760, -- 10 MB, = MAX_UPLOAD_FILE_BYTES in lib/enquiry-uploads-options.ts
  array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do nothing;
