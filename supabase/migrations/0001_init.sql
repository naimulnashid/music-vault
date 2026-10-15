-- MusicVault — initial schema
-- Supabase stores METADATA AND USER STATE ONLY. Audio bytes live in Google
-- Drive (and local folders); they never touch this database.

-- ============================================================ helpers

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ============================================================ profiles

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: own row" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- auto-create a profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================ devices

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  platform text not null check (platform in ('desktop', 'android', 'web')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.devices enable row level security;

create policy "devices: own rows" on public.devices
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index devices_user_idx on public.devices (user_id);

-- ============================================================ tracks
-- Canonical cross-device track index. Identity: Google Drive fileId for
-- Drive tracks, BLAKE3 content hash for local-only tracks (either may be
-- null, not both — a track present in both resolves to ONE row).

create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  drive_file_id text,
  drive_md5 text,
  content_hash text,

  file_name text not null,
  file_size bigint not null default 0,

  title text not null,
  artist text not null default '',
  album text not null default '',
  album_artist text,
  genre text,
  year int,
  language text,
  composer text,
  track_no int,
  disc_no int,
  bpm real,
  replaygain_track_db real,
  replaygain_album_db real,

  duration real not null default 0,
  codec text,
  sample_rate int,
  bit_depth int,
  channels int,

  lyrics_text text,
  lyrics_synced jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tracks_identity check (drive_file_id is not null or content_hash is not null)
);

alter table public.tracks enable row level security;

create policy "tracks: own rows" on public.tracks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create unique index tracks_user_drive_file_idx on public.tracks (user_id, drive_file_id)
  where drive_file_id is not null;
create unique index tracks_user_content_hash_idx on public.tracks (user_id, content_hash)
  where content_hash is not null;
create index tracks_user_idx on public.tracks (user_id);

create trigger tracks_updated_at
  before update on public.tracks
  for each row execute function public.set_updated_at();

-- ============================================================ playlists
-- Folders and playlists share the table (is_folder). Smart playlists store
-- their rule AST in smart_rules. position is a fractional index string so
-- concurrent reorders merge without rewriting sibling rows.

create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  parent_id uuid references public.playlists (id) on delete cascade,
  name text not null,
  is_folder boolean not null default false,
  is_smart boolean not null default false,
  smart_rules jsonb,
  position text not null default 'a0',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.playlists enable row level security;

create policy "playlists: own rows" on public.playlists
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index playlists_user_idx on public.playlists (user_id);
create index playlists_parent_idx on public.playlists (parent_id);

create trigger playlists_updated_at
  before update on public.playlists
  for each row execute function public.set_updated_at();

create table public.playlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  playlist_id uuid not null references public.playlists (id) on delete cascade,
  track_id uuid not null references public.tracks (id) on delete cascade,
  position text not null default 'a0',
  added_at timestamptz not null default now()
);

alter table public.playlist_items enable row level security;

create policy "playlist_items: own rows" on public.playlist_items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index playlist_items_playlist_idx on public.playlist_items (playlist_id, position);

-- ============================================================ favorites / ratings

create table public.favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  track_id uuid not null references public.tracks (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, track_id)
);

alter table public.favorites enable row level security;

create policy "favorites: own rows" on public.favorites
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.ratings (
  user_id uuid not null references auth.users (id) on delete cascade,
  track_id uuid not null references public.tracks (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (user_id, track_id)
);

alter table public.ratings enable row level security;

create policy "ratings: own rows" on public.ratings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger ratings_updated_at
  before update on public.ratings
  for each row execute function public.set_updated_at();

-- ============================================================ play_events
-- Append-only. Statistics are derived from these rows; there is no separate
-- play_count column anywhere. id is CLIENT-GENERATED so offline replays are
-- idempotent (insert ... on conflict do nothing).

create table public.play_events (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  track_id uuid not null references public.tracks (id) on delete cascade,
  device_id uuid references public.devices (id) on delete set null,
  played_at timestamptz not null default now(),
  duration_played real not null default 0,
  completed boolean not null default false
);

alter table public.play_events enable row level security;

create policy "play_events: select own" on public.play_events
  for select using (user_id = auth.uid());
create policy "play_events: insert own" on public.play_events
  for insert with check (user_id = auth.uid());
-- no update/delete policies: append-only by construction

create index play_events_user_time_idx on public.play_events (user_id, played_at desc);
create index play_events_track_idx on public.play_events (track_id);

-- ============================================================ settings
-- Key-value with a scope: 'global' or a device id string, so per-device
-- overrides (e.g. EQ) can coexist with account-wide settings (e.g. theme).

create table public.settings (
  user_id uuid not null references auth.users (id) on delete cascade,
  scope text not null default 'global',
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, scope, key)
);

alter table public.settings enable row level security;

create policy "settings: own rows" on public.settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger settings_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

-- ============================================================ queue_state
-- One row per user: the last playback queue, for cross-device handoff.

create table public.queue_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  device_id uuid references public.devices (id) on delete set null,
  track_ids jsonb not null default '[]',
  current_index int not null default 0,
  position_seconds real not null default 0,
  shuffle boolean not null default false,
  repeat text not null default 'off' check (repeat in ('off', 'one', 'all')),
  updated_at timestamptz not null default now()
);

alter table public.queue_state enable row level security;

create policy "queue_state: own row" on public.queue_state
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger queue_state_updated_at
  before update on public.queue_state
  for each row execute function public.set_updated_at();
