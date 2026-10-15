-- MusicVault — vault storage (Cloudflare R2) and online metadata editing.
-- See docs/drive-to-r2-migration.md §2.2.
--
-- Audio and cover objects live in R2 under users/<user_id>/…; this database
-- records where (storage_key / artwork_key) and owns all track metadata.
-- Drive columns stay until 0005_drop_drive.sql (migration step M7).

-- ============================================================ columns

alter table public.tracks add column storage_key text;
alter table public.tracks add column uploaded_at timestamptz;
alter table public.tracks add column artwork_key text;
-- Per-field edit clock for field-level last-writer-wins: {"title": "<iso>", …}
alter table public.tracks add column field_edited_at jsonb not null default '{}'::jsonb;
-- Tombstones. Track rows are never hard-deleted by the app, because a
-- deletion is invisible to updated_at cursor pulls. merged_into points a
-- duplicate at the row that absorbed its history, so clients can remap
-- local references (play events are not re-pulled when repointed).
alter table public.tracks add column deleted_at timestamptz;
alter table public.tracks add column merged_into uuid references public.tracks (id) on delete set null;

-- A merged tombstone gives its identity to the surviving row, so it may
-- carry neither a Drive id nor a hash.
alter table public.tracks drop constraint tracks_identity;
alter table public.tracks add constraint tracks_identity
  check (deleted_at is not null or drive_file_id is not null or content_hash is not null);

create index tracks_user_storage_key_idx on public.tracks (user_id, storage_key)
  where storage_key is not null;
create index tracks_user_artwork_key_idx on public.tracks (user_id, artwork_key)
  where artwork_key is not null;
create index tracks_user_drive_md5_idx on public.tracks (user_id, drive_md5)
  where drive_md5 is not null;

-- ============================================================ protected columns
-- storage_key / uploaded_at are written only by the vault Edge Function
-- (service role) after it has confirmed the object exists; deleted_at /
-- merged_into only by the functions below. A client writing them directly
-- through PostgREST (role authenticated) is silently ignored, which keeps
-- existing upserts working unchanged.

create or replace function public.tracks_protect_vault_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.storage_key := null;
      new.uploaded_at := null;
      new.deleted_at := null;
      new.merged_into := null;
    else
      new.storage_key := old.storage_key;
      new.uploaded_at := old.uploaded_at;
      new.deleted_at := old.deleted_at;
      new.merged_into := old.merged_into;
    end if;
  end if;
  return new;
end;
$$;

create trigger tracks_protect_vault_columns
  before insert or update on public.tracks
  for each row execute function public.tracks_protect_vault_columns();

-- ============================================================ apply_track_edit
-- Field-level LWW for the track.edit sync op. Each key in p_patch is applied
-- only when p_edited_at is at least as new as that field's last edit (ties go
-- to the incoming edit, matching the sync engine's other LWW entities).
-- Read-only fields (hash, size, duration, codec, sample rate, bit depth,
-- channels, ReplayGain) are rejected. Runs as the caller, so RLS applies.

create or replace function public.apply_track_edit(
  p_track_id uuid,
  p_patch jsonb,
  p_edited_at timestamptz
)
returns public.tracks
language plpgsql
set search_path = ''
as $$
declare
  editable constant text[] := array[
    'title', 'artist', 'album', 'album_artist', 'genre', 'year', 'language',
    'composer', 'track_no', 'disc_no', 'bpm', 'lyrics_text', 'lyrics_synced',
    'artwork_key'
  ];
  t public.tracks;
  wins text[];
  k text;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'patch must be a JSON object' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not k = any (editable) then
      raise exception 'field % is not editable', k using errcode = '22023';
    end if;
  end loop;

  select * into t from public.tracks where id = p_track_id for update;
  if not found or t.deleted_at is not null then
    raise exception 'track not found' using errcode = 'P0002';
  end if;

  if p_patch ? 'title' and coalesce(btrim(p_patch->>'title'), '') = '' then
    raise exception 'title cannot be empty' using errcode = '22023';
  end if;
  if p_patch ? 'artwork_key' and jsonb_typeof(p_patch->'artwork_key') <> 'null'
     and (p_patch->>'artwork_key') !~ ('^users/' || t.user_id::text || '/art/[0-9a-f]{64}\.jpg$') then
    raise exception 'invalid artwork_key' using errcode = '22023';
  end if;

  select coalesce(array_agg(f), '{}') into wins
  from jsonb_object_keys(p_patch) f
  where coalesce((t.field_edited_at->>f)::timestamptz, '-infinity') <= p_edited_at;

  if cardinality(wins) = 0 then
    return t;
  end if;

  update public.tracks set
    title         = case when 'title' = any (wins) then btrim(p_patch->>'title') else title end,
    artist        = case when 'artist' = any (wins) then coalesce(p_patch->>'artist', '') else artist end,
    album         = case when 'album' = any (wins) then coalesce(p_patch->>'album', '') else album end,
    album_artist  = case when 'album_artist' = any (wins) then p_patch->>'album_artist' else album_artist end,
    genre         = case when 'genre' = any (wins) then p_patch->>'genre' else genre end,
    year          = case when 'year' = any (wins) then (p_patch->>'year')::int else year end,
    language      = case when 'language' = any (wins) then p_patch->>'language' else language end,
    composer      = case when 'composer' = any (wins) then p_patch->>'composer' else composer end,
    track_no      = case when 'track_no' = any (wins) then (p_patch->>'track_no')::int else track_no end,
    disc_no       = case when 'disc_no' = any (wins) then (p_patch->>'disc_no')::int else disc_no end,
    bpm           = case when 'bpm' = any (wins) then (p_patch->>'bpm')::real else bpm end,
    lyrics_text   = case when 'lyrics_text' = any (wins) then p_patch->>'lyrics_text' else lyrics_text end,
    lyrics_synced = case when 'lyrics_synced' = any (wins)
                      then nullif(p_patch->'lyrics_synced', 'null'::jsonb) else lyrics_synced end,
    artwork_key   = case when 'artwork_key' = any (wins) then p_patch->>'artwork_key' else artwork_key end,
    field_edited_at = field_edited_at
      || (select jsonb_object_agg(f, to_jsonb(p_edited_at)) from unnest(wins) f)
  where id = p_track_id
  returning * into t;

  return t;
end;
$$;

-- ============================================================ merge_tracks
-- Folds p_drop into p_keep: favorites, ratings and playlist entries resolve
-- by newest edited_at, play events and the queue are repointed, identities
-- (hash, storage, cover, Drive id) carry over where p_keep lacks them, and
-- p_drop becomes a tombstone with merged_into = p_keep.

create or replace function public.merge_tracks(p_keep uuid, p_drop uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  k public.tracks;
  d public.tracks;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_keep = p_drop then
    raise exception 'cannot merge a track into itself' using errcode = '22023';
  end if;
  select * into k from public.tracks where id = p_keep and user_id = uid and deleted_at is null for update;
  select * into d from public.tracks where id = p_drop and user_id = uid and deleted_at is null for update;
  if k.id is null or d.id is null then
    raise exception 'track not found' using errcode = 'P0002';
  end if;

  -- favorites
  update public.favorites fk set favorite = fd.favorite, edited_at = fd.edited_at
    from public.favorites fd
    where fk.user_id = uid and fk.track_id = p_keep
      and fd.user_id = uid and fd.track_id = p_drop and fd.edited_at > fk.edited_at;
  delete from public.favorites fd
    where fd.user_id = uid and fd.track_id = p_drop
      and exists (select 1 from public.favorites fk where fk.user_id = uid and fk.track_id = p_keep);
  update public.favorites set track_id = p_keep where user_id = uid and track_id = p_drop;

  -- ratings
  update public.ratings rk set rating = rd.rating, edited_at = rd.edited_at
    from public.ratings rd
    where rk.user_id = uid and rk.track_id = p_keep
      and rd.user_id = uid and rd.track_id = p_drop and rd.edited_at > rk.edited_at;
  delete from public.ratings rd
    where rd.user_id = uid and rd.track_id = p_drop
      and exists (select 1 from public.ratings rk where rk.user_id = uid and rk.track_id = p_keep);
  update public.ratings set track_id = p_keep where user_id = uid and track_id = p_drop;

  -- playlist entries (one per playlist + track)
  update public.playlist_items ik
    set position = id_.position, edited_at = id_.edited_at, deleted_at = id_.deleted_at
    from public.playlist_items id_
    where ik.user_id = uid and ik.track_id = p_keep
      and id_.user_id = uid and id_.track_id = p_drop
      and id_.playlist_id = ik.playlist_id and id_.edited_at > ik.edited_at;
  delete from public.playlist_items id_
    where id_.user_id = uid and id_.track_id = p_drop
      and exists (select 1 from public.playlist_items ik
                  where ik.user_id = uid and ik.track_id = p_keep and ik.playlist_id = id_.playlist_id);
  update public.playlist_items set track_id = p_keep where user_id = uid and track_id = p_drop;

  -- history and queue
  update public.play_events set track_id = p_keep where user_id = uid and track_id = p_drop;
  update public.queue_state set track_ids = (
      select coalesce(jsonb_agg(case when e = to_jsonb(p_drop::text) then to_jsonb(p_keep::text) else e end
                                order by ord), '[]'::jsonb)
      from jsonb_array_elements(track_ids) with ordinality as a(e, ord))
    where user_id = uid and track_ids @> jsonb_build_array(p_drop::text);

  -- identities move to the survivor; the tombstone frees the unique indexes first
  update public.tracks set
      deleted_at = now(), merged_into = p_keep,
      drive_file_id = null, drive_md5 = null, content_hash = null,
      storage_key = null, uploaded_at = null, artwork_key = null
    where id = p_drop;
  update public.tracks set
      content_hash  = coalesce(k.content_hash, d.content_hash),
      drive_file_id = coalesce(k.drive_file_id, d.drive_file_id),
      drive_md5     = coalesce(k.drive_md5, d.drive_md5),
      storage_key   = coalesce(k.storage_key, d.storage_key),
      uploaded_at   = coalesce(k.uploaded_at, d.uploaded_at),
      artwork_key   = coalesce(k.artwork_key, d.artwork_key)
    where id = p_keep;

  return p_keep;
end;
$$;

-- ============================================================ resolve_upload_target
-- Called before an upload. Returns the row the upload should attach to, so
-- re-uploading a known song keeps its history:
--   1. a row with the same content hash (live, or a deleted tombstone that
--      the upload will revive);
--   2. otherwise an old Drive row with the same md5 whose hash is unknown —
--      it adopts the hash;
-- and when both exist, merges them (the one with more plays survives).
-- Returns null when the song is new: the client inserts a fresh row.

create or replace function public.resolve_upload_target(p_content_hash text, p_md5 text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  h public.tracks;
  m public.tracks;
  keep uuid;
  drop_ uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid content hash' using errcode = '22023';
  end if;

  select * into h from public.tracks where user_id = uid and content_hash = p_content_hash;
  if p_md5 is not null then
    select * into m from public.tracks
      where user_id = uid and drive_md5 = lower(p_md5) and content_hash is null and deleted_at is null
      order by created_at limit 1;
  end if;

  if h.id is not null and m.id is not null and h.deleted_at is null then
    if (select count(*) from public.play_events where track_id = m.id)
       > (select count(*) from public.play_events where track_id = h.id) then
      keep := m.id; drop_ := h.id;
    else
      keep := h.id; drop_ := m.id;
    end if;
    return public.merge_tracks(keep, drop_);
  end if;
  if h.id is not null then
    return h.id;
  end if;
  if m.id is not null then
    update public.tracks set content_hash = p_content_hash where id = m.id;
    return m.id;
  end if;
  return null;
end;
$$;

-- ============================================================ delete_track
-- "Delete from vault": removes the track's favorites, ratings, playlist
-- entries, play events and queue references, and turns the row into a
-- tombstone (the hash stays, so a later re-upload revives it cleanly).
-- Returns the object keys the vault function must delete from R2, and
-- whether the cover is still used by another of the user's tracks.

create or replace function public.delete_track(p_track_id uuid)
returns table (storage_key text, artwork_key text, artwork_still_used boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t public.tracks;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into t from public.tracks where id = p_track_id and user_id = uid and deleted_at is null for update;
  if t.id is null then
    raise exception 'track not found' using errcode = 'P0002';
  end if;

  delete from public.favorites where user_id = uid and track_id = p_track_id;
  delete from public.ratings where user_id = uid and track_id = p_track_id;
  delete from public.playlist_items where user_id = uid and track_id = p_track_id;
  delete from public.play_events where user_id = uid and track_id = p_track_id;
  update public.queue_state set track_ids = (
      select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
      from jsonb_array_elements(track_ids) with ordinality as a(e, ord)
      where e <> to_jsonb(p_track_id::text))
    where user_id = uid and track_ids @> jsonb_build_array(p_track_id::text);

  update public.tracks set
      deleted_at = now(), storage_key = null, uploaded_at = null, artwork_key = null
    where id = p_track_id;

  return query select
    t.storage_key,
    t.artwork_key,
    t.artwork_key is not null and exists (
      select 1 from public.tracks o
      where o.user_id = uid and o.artwork_key = t.artwork_key and o.id <> p_track_id);
end;
$$;

-- ============================================================ grants

revoke all on function public.apply_track_edit(uuid, jsonb, timestamptz) from public, anon;
revoke all on function public.merge_tracks(uuid, uuid) from public, anon;
revoke all on function public.resolve_upload_target(text, text) from public, anon;
revoke all on function public.delete_track(uuid) from public, anon;
grant execute on function public.apply_track_edit(uuid, jsonb, timestamptz) to authenticated;
grant execute on function public.merge_tracks(uuid, uuid) to authenticated;
grant execute on function public.resolve_upload_target(text, text) to authenticated;
grant execute on function public.delete_track(uuid) to authenticated;
revoke all on function public.tracks_protect_vault_columns() from public, anon, authenticated;
