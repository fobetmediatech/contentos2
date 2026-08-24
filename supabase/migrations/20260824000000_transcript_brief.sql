-- Cached discovery-call client brief, for the printable one-pager.
--
-- One Gemini call over a full transcript, viewed repeatedly by the whole team — so it is generated
-- once and stored, mirroring cb_transcripts.summary (20260817000001). Both columns are NULLABLE
-- with no default: null means "never generated", which must stay distinguishable from a brief that
-- genuinely found nothing on the call.
--
-- No RLS change. These columns inherit cb_transcripts' existing policies (open to any signed-in
-- member since 20260810000000).
--
-- Run in the Supabase SQL editor, or `supabase db push --linked`.

alter table cb_transcripts add column if not exists brief jsonb;
alter table cb_transcripts add column if not exists brief_generated_at timestamptz;
