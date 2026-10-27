-- MusicVault: covers picked for playlists and smart groups.
--
-- A cover is a settings row like an artist photo (0008): scope
-- 'collection_cover', key = '<kind>:<id>' ('playlist:<uuid>', 'smart:favorites',
-- 'country:Bangladesh', ...), value = the cover key of the uploaded picture as
-- a JSON string, or JSON null once the default cover is back. Settings already
-- sync to every device with last-writer-wins, so covers need no new table.
--
-- 0008's three server pieces are extended to the new scope:
-- 1. the value guard accepts only null or the caller's own full cover key;
-- 2. referenced_artwork_keys lists these covers, so sign-get can read a
--    picture no song uses;
-- 3. delete_track keeps a cover a collection still uses.

-- ============================================================ value guard

create or replace function public.settings_check_artist_photo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.scope in ('artist_photo', 'collection_cover') then
    if char_length(new.key) = 0 or char_length(new.key) > 500 then
      raise exception 'invalid artist or collection name' using errcode = '22023';
    end if;
    if jsonb_typeof(new.value) <> 'null'
       and (jsonb_typeof(new.value) <> 'string'
            or (new.value #>> '{}') !~ ('^users/' || new.user_id::text || '/art/[0-9a-f]{64}\.jpg$')) then
      raise exception 'invalid cover' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.settings_check_artist_photo() from public, anon, authenticated;

-- ============================================================ readable covers

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
     and s.scope in ('artist_photo', 'collection_cover')
     and jsonb_typeof(s.value) = 'string'
     and (s.value #>> '{}') = any(p_keys);
$$;

revoke all on function public.referenced_artwork_keys(text[]) from public, anon;
grant execute on function public.referenced_artwork_keys(text[]) to authenticated;

-- ============================================================ delete_track
-- As in 0008, with the cover also counted as used by a collection cover.

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
        where s.user_id = uid and s.scope in ('artist_photo', 'collection_cover')
          and s.value = to_jsonb(t.artwork_key)));
end;
$$;
