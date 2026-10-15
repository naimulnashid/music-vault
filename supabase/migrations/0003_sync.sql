-- MusicVault — Phase 4 sync engine schema.
--
-- Adds the two-timestamp scheme documented in docs/sync-protocol.md:
--   updated_at (server trigger)  → pull cursors
--   edited_at  (client-supplied) → last-writer-wins conflict resolution
-- and converts deletions to soft state so cursor pulls can see them.

-- ============================================================ favorites
-- Un-favoriting used to delete the row; deletions are invisible to
-- updated_at cursors, so favorites become soft state: favorite = false.

alter table public.favorites add column favorite boolean not null default true;
alter table public.favorites add column edited_at timestamptz not null default now();
alter table public.favorites add column updated_at timestamptz not null default now();

create trigger favorites_updated_at
  before update on public.favorites
  for each row execute function public.set_updated_at();

create index favorites_user_updated_idx on public.favorites (user_id, updated_at);

-- ============================================================ ratings
-- rating = 0 now means "cleared" (was: delete the row).

alter table public.ratings drop constraint ratings_rating_check;
alter table public.ratings add constraint ratings_rating_check check (rating between 0 and 5);
alter table public.ratings add column edited_at timestamptz not null default now();

create index ratings_user_updated_idx on public.ratings (user_id, updated_at);

-- ============================================================ playlists

alter table public.playlists add column edited_at timestamptz not null default now();
alter table public.playlists add column deleted_at timestamptz;

create index playlists_user_updated_idx on public.playlists (user_id, updated_at);

-- ============================================================ playlist_items

alter table public.playlist_items add column edited_at timestamptz not null default now();
alter table public.playlist_items add column updated_at timestamptz not null default now();
alter table public.playlist_items add column deleted_at timestamptz;

create trigger playlist_items_updated_at
  before update on public.playlist_items
  for each row execute function public.set_updated_at();

-- A playlist holds a track at most once (all clients enforce this in the UI);
-- the constraint gives PostgREST upserts their conflict target. Dedupe first
-- in case any duplicates slipped in pre-Phase 4.
delete from public.playlist_items a
  using public.playlist_items b
  where a.playlist_id = b.playlist_id
    and a.track_id = b.track_id
    and a.ctid < b.ctid;

alter table public.playlist_items
  add constraint playlist_items_playlist_track_key unique (playlist_id, track_id);

create index playlist_items_user_updated_idx on public.playlist_items (user_id, updated_at);

-- ============================================================ settings / queue_state

alter table public.settings add column edited_at timestamptz not null default now();
alter table public.queue_state add column edited_at timestamptz not null default now();

create index settings_user_updated_idx on public.settings (user_id, updated_at);

-- ============================================================ play_events
-- played_at is a client clock and can be arbitrarily old when a device
-- flushes an offline backlog; cursor pulls need server receive time.

alter table public.play_events add column created_at timestamptz not null default now();

create index play_events_user_created_idx on public.play_events (user_id, created_at);

-- ============================================================ realtime
-- Change events (filtered by user_id client-side via RLS + channel filter)
-- act as "pull sooner" hints while a client is running.

alter publication supabase_realtime add table
  public.tracks,
  public.playlists,
  public.playlist_items,
  public.favorites,
  public.ratings,
  public.settings,
  public.queue_state,
  public.play_events;
