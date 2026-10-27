-- MusicVault: more song details.
--
-- Songs gain five optional text fields, edited like genre or country:
--   featured_artists  guest artists on the song ("A, B": a comma separates names)
--   subgenre          a narrower genre than `genre`
--   secondary_genres  other genres the song belongs to ("A, B")
--   mood              how the song feels ("Romantic, Yearning")
--   vocals            "Male", "Female", "Male and Female" or "Instrumental"
-- Like the other text fields they are free text; the apps suggest the values
-- already in the library. apply_track_edit accepts them with the same
-- field-level last-writer-wins as before.

-- ============================================================ columns

alter table public.tracks add column featured_artists text;
alter table public.tracks add column subgenre text;
alter table public.tracks add column secondary_genres text;
alter table public.tracks add column mood text;
alter table public.tracks add column vocals text;

-- ============================================================ apply_track_edit
-- As in 0006, over the larger editable set.

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
    'title', 'artist', 'featured_artists', 'album', 'genre', 'subgenre', 'secondary_genres',
    'mood', 'vocals', 'language', 'country', 'release_date',
    'lyrics_text', 'lyrics_synced', 'artwork_key'
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
  if p_patch ? 'release_date' and jsonb_typeof(p_patch->'release_date') <> 'null'
     and (jsonb_typeof(p_patch->'release_date') <> 'string'
          or (p_patch->>'release_date') !~ '^[0-9]{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12][0-9]|3[01]))?)?$') then
    raise exception 'invalid release_date' using errcode = '22023';
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

  -- year follows release_date through tracks_sync_year.
  update public.tracks set
    title            = case when 'title' = any (wins) then btrim(p_patch->>'title') else title end,
    artist           = case when 'artist' = any (wins) then coalesce(p_patch->>'artist', '') else artist end,
    featured_artists = case when 'featured_artists' = any (wins) then p_patch->>'featured_artists' else featured_artists end,
    album            = case when 'album' = any (wins) then coalesce(p_patch->>'album', '') else album end,
    genre            = case when 'genre' = any (wins) then p_patch->>'genre' else genre end,
    subgenre         = case when 'subgenre' = any (wins) then p_patch->>'subgenre' else subgenre end,
    secondary_genres = case when 'secondary_genres' = any (wins) then p_patch->>'secondary_genres' else secondary_genres end,
    mood             = case when 'mood' = any (wins) then p_patch->>'mood' else mood end,
    vocals           = case when 'vocals' = any (wins) then p_patch->>'vocals' else vocals end,
    language         = case when 'language' = any (wins) then p_patch->>'language' else language end,
    country          = case when 'country' = any (wins) then p_patch->>'country' else country end,
    release_date     = case when 'release_date' = any (wins) then p_patch->>'release_date' else release_date end,
    lyrics_text      = case when 'lyrics_text' = any (wins) then p_patch->>'lyrics_text' else lyrics_text end,
    lyrics_synced    = case when 'lyrics_synced' = any (wins)
                         then nullif(p_patch->'lyrics_synced', 'null'::jsonb) else lyrics_synced end,
    artwork_key      = case when 'artwork_key' = any (wins) then p_patch->>'artwork_key' else artwork_key end,
    field_edited_at = field_edited_at
      || (select jsonb_object_agg(f, to_jsonb(p_edited_at)) from unnest(wins) f)
  where id = p_track_id
  returning * into t;

  return t;
end;
$$;

revoke all on function public.apply_track_edit(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.apply_track_edit(uuid, jsonb, timestamptz) to authenticated;
