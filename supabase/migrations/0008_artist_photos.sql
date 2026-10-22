-- MusicVault: artist photos.
--
-- Applied to the live project on 2026-10-22.
--
-- A photo is a settings row: scope 'artist_photo', key = the artist's name,
-- value = the cover key of the uploaded picture as a JSON string
-- ("users/<user_id>/art/<sha256>.jpg"), or JSON null once the photo is
-- removed. Settings already sync to every device with last-writer-wins, so
-- photos need no new table, sync path or app-side pull.
--
-- The picture itself is uploaded like a song cover (vault sign-put, kind
-- 'art'). Three server pieces make that safe and visible:
-- 1. A trigger rejects artist_photo rows whose value isn't null or the
--    caller's own full cover key, as 0007 guards tracks.artwork_key.
-- 2. referenced_artwork_keys lists the cover keys the caller may read: those
--    of live tracks and of artist photos. The vault function's sign-get uses
--    it, so a photo no song uses can still be fetched.
-- 3. delete_track keeps a cover an artist photo still uses.

-- ============================================================ value guard

create or replace function public.settings_check_artist_photo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.scope = 'artist_photo' then
    if char_length(new.key) = 0 or char_length(new.key) > 500 then
      raise exception 'invalid artist name' using errcode = '22023';
    end if;
    if jsonb_typeof(new.value) <> 'null'
       and (jsonb_typeof(new.value) <> 'string'
            or (new.value #>> '{}') !~ ('^users/' || new.user_id::text || '/art/[0-9a-f]{64}\.jpg$')) then
      raise exception 'invalid artist photo' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.settings_check_artist_photo() from public, anon, authenticated;

create trigger settings_check_artist_photo
  before insert or update on public.settings
  for each row execute function public.settings_check_artist_photo();

-- ============================================================ readable covers
-- Security invoker: RLS on tracks and settings already limits rows to the
-- caller's own, and the auth.uid() filters keep the plan on their indexes.

create or replace function public.referenced_artwork_keys(p_keys text[])
returns setof text
language sql
stable
set search_path = ''
as $$
  select t.artwork_key
    from public.tracks t
   where t.user_id = auth.uid()
     and t.deleted_at is null
     and t.artwork_key = any(p_keys)
  union
  select s.value #>> '{}'
    from public.settings s
   where s.user_id = auth.uid()
     and s.scope = 'artist_photo'
     and jsonb_typeof(s.value) = 'string'
     and (s.value #>> '{}') = any(p_keys);
$$;

revoke all on function public.referenced_artwork_keys(text[]) from public, anon;
grant execute on function public.referenced_artwork_keys(text[]) to authenticated;

-- ============================================================ delete_track
-- As in 0004, with one change: the cover counts as still used when an artist
-- photo points at it, so deleting the song doesn't delete the photo.

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
    t.artwork_key is not null and (
      exists (
        select 1 from public.tracks o
        where o.user_id = uid and o.artwork_key = t.artwork_key and o.id <> p_track_id)
      or exists (
        select 1 from public.settings s
        where s.user_id = uid and s.scope = 'artist_photo' and s.value = to_jsonb(t.artwork_key)));
end;
$$;
