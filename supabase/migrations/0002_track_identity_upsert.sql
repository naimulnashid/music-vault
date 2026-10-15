-- Phase 3: allow ON CONFLICT upserts keyed on (user_id, drive_file_id) /
-- (user_id, content_hash). PostgREST cannot infer partial unique indexes for
-- upsert, and full unique indexes behave identically here because Postgres
-- treats NULLs as distinct (local-only tracks keep drive_file_id NULL and
-- Drive-only tracks keep content_hash NULL without conflicting).

drop index if exists public.tracks_user_drive_file_idx;
drop index if exists public.tracks_user_content_hash_idx;

create unique index tracks_user_drive_file_idx on public.tracks (user_id, drive_file_id);
create unique index tracks_user_content_hash_idx on public.tracks (user_id, content_hash);
