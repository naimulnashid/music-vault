-- Vault schema smoke test — run in the Supabase SQL editor (or psql) AFTER
-- applying the migrations through 0006. Two fake users exercise the protected columns,
-- apply_track_edit (field-level LWW), resolve_upload_target, merge_tracks
-- and delete_track, including cross-user refusal. Everything rolls back.

begin;

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-00000000000a', 'user-a@vault.test'),
  ('00000000-0000-0000-0000-00000000000b', 'user-b@vault.test');

-- ---------------------------------------------------------------- as user A
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';

-- Protected columns are ignored when a client writes them.
insert into public.tracks (id, user_id, content_hash, file_name, title, storage_key, deleted_at)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
        repeat('a', 64), 'one.flac', 'One', 'users/x/audio/forged.flac', now());

update public.tracks set storage_key = 'users/x/audio/forged2.flac', uploaded_at = now()
where id = '10000000-0000-0000-0000-000000000001';

do $$
begin
  if exists (select 1 from public.tracks
             where id = '10000000-0000-0000-0000-000000000001'
               and (storage_key is not null or uploaded_at is not null or deleted_at is not null)) then
    raise exception 'FAIL: a client wrote a protected vault column';
  end if;
end $$;

-- Field-level LWW.
select public.apply_track_edit('10000000-0000-0000-0000-000000000001',
  '{"title": "Newer"}', '2026-10-11T12:00:00Z');
select public.apply_track_edit('10000000-0000-0000-0000-000000000001',
  '{"title": "Older", "genre": "Folk"}', '2026-10-11T11:00:00Z');

do $$
declare t public.tracks;
begin
  select * into t from public.tracks where id = '10000000-0000-0000-0000-000000000001';
  if t.title <> 'Newer' then raise exception 'FAIL: an older title edit won (%).', t.title; end if;
  if t.genre is distinct from 'Folk' then raise exception 'FAIL: an edit to a different field was lost'; end if;
end $$;

-- A tie goes to the incoming edit; nulls clear; a release date sets the year
-- (0006: year is derived and no longer editable).
select public.apply_track_edit('10000000-0000-0000-0000-000000000001',
  '{"title": "Tie", "genre": null, "release_date": "1999", "language": "Bangla"}', '2026-10-11T12:00:00Z');

do $$
declare t public.tracks;
begin
  select * into t from public.tracks where id = '10000000-0000-0000-0000-000000000001';
  if t.title <> 'Tie' then raise exception 'FAIL: a tied edit should apply'; end if;
  if t.genre is not null or t.release_date is distinct from '1999' or t.year is distinct from 1999
     or t.language <> 'Bangla' then
    raise exception 'FAIL: null/release date/text edits not applied as expected';
  end if;
end $$;

-- Read-only fields, empty titles and foreign cover keys are rejected.
do $$
begin
  begin
    perform public.apply_track_edit('10000000-0000-0000-0000-000000000001', '{"duration": 1}', now());
    raise exception 'FAIL: duration was editable';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.apply_track_edit('10000000-0000-0000-0000-000000000001', '{"title": "  "}', now());
    raise exception 'FAIL: an empty title was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.apply_track_edit('10000000-0000-0000-0000-000000000001',
      jsonb_build_object('artwork_key', 'users/00000000-0000-0000-0000-00000000000b/art/' || repeat('c', 64) || '.jpg'), now());
    raise exception 'FAIL: another user''s cover key was accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

select public.apply_track_edit('10000000-0000-0000-0000-000000000001',
  jsonb_build_object('artwork_key', 'users/00000000-0000-0000-0000-00000000000a/art/' || repeat('c', 64) || '.jpg'),
  '2026-10-11T13:00:00Z');

-- resolve_upload_target: by hash, or new.
insert into public.tracks (id, user_id, content_hash, file_name, title)
values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a',
        repeat('b', 64), 'two.flac', 'Two');

do $$
begin
  if public.resolve_upload_target(repeat('a', 64)) <> '10000000-0000-0000-0000-000000000001' then
    raise exception 'FAIL: hash lookup';
  end if;
  if public.resolve_upload_target(repeat('f', 64)) is not null then
    raise exception 'FAIL: an unknown hash should resolve to null';
  end if;
  -- pre-M7 clients still send p_md5; it is ignored
  if public.resolve_upload_target(repeat('b', 64), 'abcdef0123456789abcdef0123456789')
     <> '10000000-0000-0000-0000-000000000002' then
    raise exception 'FAIL: hash lookup with a legacy md5 argument';
  end if;
end $$;

-- merge_tracks: history follows the survivor, the duplicate becomes a tombstone.
insert into public.tracks (id, user_id, content_hash, file_name, title)
values ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a',
        repeat('d', 64), 'three.flac', 'Three');
insert into public.favorites (user_id, track_id, favorite, edited_at)
values ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000003', true, '2026-10-11T10:00:00Z');
insert into public.ratings (user_id, track_id, rating, edited_at)
values ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', 2, '2026-10-11T09:00:00Z'),
       ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000003', 5, '2026-10-11T10:00:00Z');
insert into public.play_events (id, user_id, track_id)
values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000003');

select public.merge_tracks('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003');

do $$
declare d public.tracks;
begin
  select * into d from public.tracks where id = '10000000-0000-0000-0000-000000000003';
  if d.deleted_at is null or d.merged_into <> '10000000-0000-0000-0000-000000000002' or d.content_hash is not null then
    raise exception 'FAIL: the duplicate is not a merged tombstone';
  end if;
  if (select rating from public.ratings where track_id = '10000000-0000-0000-0000-000000000002') <> 5 then
    raise exception 'FAIL: the newer rating did not win the merge';
  end if;
  if not exists (select 1 from public.favorites where track_id = '10000000-0000-0000-0000-000000000002' and favorite) then
    raise exception 'FAIL: the favorite did not move';
  end if;
  if (select track_id from public.play_events where id = '20000000-0000-0000-0000-000000000001')
     <> '10000000-0000-0000-0000-000000000002' then
    raise exception 'FAIL: the play event did not move';
  end if;
end $$;

-- ---------------------------------------------------------------- as user B
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';

do $$
begin
  begin
    perform public.apply_track_edit('10000000-0000-0000-0000-000000000001', '{"title": "Hijack"}', now());
    raise exception 'FAIL: user B edited user A''s track';
  exception when no_data_found then null;
  end;
  begin
    perform public.delete_track('10000000-0000-0000-0000-000000000001');
    raise exception 'FAIL: user B deleted user A''s track';
  exception when no_data_found then null;
  end;
  begin
    perform public.merge_tracks('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002');
    raise exception 'FAIL: user B merged user A''s tracks';
  exception when no_data_found then null;
  end;
  if public.resolve_upload_target(repeat('a', 64)) is not null then
    raise exception 'FAIL: user B resolved user A''s hash';
  end if;
end $$;

-- ---------------------------------------------------------------- service role marks an upload
reset role;
update public.tracks set storage_key = 'users/00000000-0000-0000-0000-00000000000a/audio/' || repeat('a', 64) || '.flac',
                         uploaded_at = now()
where id = '10000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------- back to user A: delete
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';

insert into public.favorites (user_id, track_id) values
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001');

create temp table deleted_keys as
  select * from public.delete_track('10000000-0000-0000-0000-000000000001');

do $$
declare t public.tracks;
begin
  if (select storage_key from deleted_keys) is null or (select artwork_key from deleted_keys) is null then
    raise exception 'FAIL: delete_track did not return the object keys';
  end if;
  if (select artwork_still_used from deleted_keys) then
    raise exception 'FAIL: the cover is not used by any other track';
  end if;
  select * into t from public.tracks where id = '10000000-0000-0000-0000-000000000001';
  if t.deleted_at is null or t.storage_key is not null or t.content_hash <> repeat('a', 64) then
    raise exception 'FAIL: the deleted track should be a tombstone that keeps its hash';
  end if;
  if exists (select 1 from public.favorites where track_id = '10000000-0000-0000-0000-000000000001') then
    raise exception 'FAIL: the deleted track''s favorite survived';
  end if;
  -- A re-upload of the same file finds the tombstone.
  if public.resolve_upload_target(repeat('a', 64)) <> '10000000-0000-0000-0000-000000000001' then
    raise exception 'FAIL: a re-upload should revive the tombstone';
  end if;
end $$;

reset role;
select 'Vault smoke test passed' as result;

rollback;
