-- Step M7 of the Drive → R2 migration (docs/drive-to-r2-migration.md):
-- Google Drive is gone from every client, so its identity columns go too.
-- A track is known by its content hash (and its row id) only.
--
-- The library was rebuilt from scratch (decision 8), so no row carries a
-- Drive id any more and nothing needs reviewing before the drop.

-- ============================================================ merge_tracks
-- Same as 0004 minus the Drive columns: favorites, ratings and playlist
-- entries resolve by newest edited_at, play events and the queue are
-- repointed, identities (hash, storage, cover) carry over where p_keep lacks
-- them, and p_drop becomes a tombstone with merged_into = p_keep.

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

  -- identities move to the survivor; the tombstone frees the unique index first
  update public.tracks set
      deleted_at = now(), merged_into = p_keep,
      content_hash = null, storage_key = null, uploaded_at = null, artwork_key = null
    where id = p_drop;
  update public.tracks set
      content_hash = coalesce(k.content_hash, d.content_hash),
      storage_key  = coalesce(k.storage_key, d.storage_key),
      uploaded_at  = coalesce(k.uploaded_at, d.uploaded_at),
      artwork_key  = coalesce(k.artwork_key, d.artwork_key)
    where id = p_keep;

  return p_keep;
end;
$$;

-- ============================================================ resolve_upload_target
-- Called before an upload: the row with the same content hash (live, or a
-- deleted tombstone the upload will revive), or null for a new song.
-- p_md5 linked old Drive rows; it is accepted and ignored so clients built
-- before M7 (which still send p_md5: null) keep working.

create or replace function public.resolve_upload_target(p_content_hash text, p_md5 text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  target uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid content hash' using errcode = '22023';
  end if;
  select id into target from public.tracks where user_id = uid and content_hash = p_content_hash;
  return target;
end;
$$;

-- ============================================================ columns
drop index if exists public.tracks_user_drive_file_idx;
drop index if exists public.tracks_user_drive_md5_idx;

-- Live rows are known by their hash; merge tombstones give theirs away.
alter table public.tracks drop constraint tracks_identity;
alter table public.tracks add constraint tracks_identity
  check (deleted_at is not null or content_hash is not null);

alter table public.tracks drop column drive_file_id;
alter table public.tracks drop column drive_md5;
