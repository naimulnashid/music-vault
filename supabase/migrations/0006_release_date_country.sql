-- MusicVault — release date and country; retired tag fields.
--
-- Songs gain `country` and a `release_date` that replaces the year in every
-- editor: a year, a year and month, or a full date ("2019", "2019-05",
-- "2019-05-14"). `year` stays as a column that follows the release date
-- (trigger below), so sorting, "By Year" browsing and smart rules keep
-- working, and older app builds that still send `year` stay consistent.
--
-- Album artist, composer, track number, disc number and BPM are no longer
-- edited, uploaded or shown. Their columns are kept (unused) so older builds
-- don't fail on insert; apply_track_edit no longer accepts them.

-- ============================================================ columns

alter table public.tracks add column release_date text;
alter table public.tracks add column country text;

alter table public.tracks add constraint tracks_release_date_format check (
  release_date is null
  or release_date ~ '^[0-9]{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12][0-9]|3[01]))?)?$'
);

-- ============================================================ year follows release_date

create or replace function public.tracks_sync_year()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.release_date is not null then
      new.year := substr(new.release_date, 1, 4)::int;
    elsif new.year between 1 and 9999 then
      new.release_date := lpad(new.year::text, 4, '0');
    end if;
  elsif new.release_date is distinct from old.release_date then
    new.year := substr(new.release_date, 1, 4)::int;
  elsif new.year is distinct from old.year then
    -- An older build edited the year: the date follows, at year precision.
    new.release_date := case when new.year between 1 and 9999 then lpad(new.year::text, 4, '0') end;
  end if;
  return new;
end;
$$;

create trigger tracks_sync_year
  before insert or update on public.tracks
  for each row execute function public.tracks_sync_year();

revoke all on function public.tracks_sync_year() from public, anon, authenticated;

-- Existing years become year-precision release dates; their edit clocks move along.
update public.tracks set
    release_date = lpad(year::text, 4, '0'),
    field_edited_at = case
      when field_edited_at ? 'year'
        then (field_edited_at - 'year') || jsonb_build_object('release_date', field_edited_at->'year')
      else field_edited_at
    end
  where year between 1 and 9999 and release_date is null;

-- ============================================================ apply_track_edit
-- Same field-level LWW as 0004, over the new editable set. A release date
-- must be a string in the column's format.

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
    'title', 'artist', 'album', 'genre', 'language', 'country', 'release_date',
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
    title         = case when 'title' = any (wins) then btrim(p_patch->>'title') else title end,
    artist        = case when 'artist' = any (wins) then coalesce(p_patch->>'artist', '') else artist end,
    album         = case when 'album' = any (wins) then coalesce(p_patch->>'album', '') else album end,
    genre         = case when 'genre' = any (wins) then p_patch->>'genre' else genre end,
    language      = case when 'language' = any (wins) then p_patch->>'language' else language end,
    country       = case when 'country' = any (wins) then p_patch->>'country' else country end,
    release_date  = case when 'release_date' = any (wins) then p_patch->>'release_date' else release_date end,
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

revoke all on function public.apply_track_edit(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.apply_track_edit(uuid, jsonb, timestamptz) to authenticated;
