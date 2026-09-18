-- 0019: the `dictation` bucket for Transcription Buddy (reports department).
--
-- Audio an operator drops on the tool is PUT straight from the browser into this bucket on a
-- signed upload URL (Vercel's 4.5 MB body cap is why it never passes through a route), read
-- once by Deepgram through a signed link, and deleted by the transcribe route. Objects should
-- never be more than a few minutes old.
--
-- Same design as `knowledge` (0009): private, NO storage.objects policies. Every write is on a
-- server-minted signed URL and every read a server-minted signed link, so the anon key alone
-- can reach nothing here.
--
-- NOTE: lib/transcription/storage.ts also creates this bucket on first use
-- (ensureDictationBucket), so the tool works before this file is pasted into the SQL editor.
-- Whichever runs first wins; the other is a no-op.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dictation',
  'dictation',
  false,
  52428800, -- 50 MB, = MAX_AUDIO_BYTES in lib/transcription/config.ts AND the project's global upload limit (a bucket may not exceed it)
  array['audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/m4a','audio/aac','audio/wav','audio/x-wav','audio/webm','audio/ogg']
)
on conflict (id) do nothing;
