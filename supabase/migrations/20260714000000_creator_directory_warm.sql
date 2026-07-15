-- Warm-state for the voice-profile warmer (api/warm-voice-profile.ts). Only the service-role
-- warmer writes these; the existing select policy already exposes creator_directory read-only.
alter table creator_directory
  add column if not exists warm_attempts        int         not null default 0,
  add column if not exists warm_last_attempt_at  timestamptz,
  add column if not exists warm_last_error       text;
