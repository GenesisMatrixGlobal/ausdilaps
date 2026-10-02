-- A third kind of tender source: a public web page read by a code-owned adapter
-- (eTenderBox — no feed, no API). Like 'rss', the URL lives in lib/tenders/sources.ts and
-- never in the database, for the SSRF reason given there.
--
-- Its own value rather than reusing 'rss' so the Source health tab says what the source is.
alter type tender_source_kind add value if not exists 'web';
