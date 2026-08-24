-- Cached plain-text meeting summary, for the printable minutes.
--
-- One Gemini call over a full transcript, viewed repeatedly by the whole team — so it is generated
-- once and stored. Both columns are NULLABLE with no default: null means "never generated", which
-- must stay distinguishable from a summary that genuinely found no action items.
--
-- No RLS change. These columns inherit cb_transcripts' existing policies (open to any signed-in
-- member since 20260810000000).
--
-- Run in the Supabase SQL editor, or `supabase db push --linked`.

alter table cb_transcripts add column if not exists summary jsonb;
alter table cb_transcripts add column if not exists summary_generated_at timestamptz;
