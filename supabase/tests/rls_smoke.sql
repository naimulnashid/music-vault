-- RLS smoke test — run in the Supabase SQL editor (or psql) AFTER applying
-- 0001_init.sql. Creates two fake users, inserts a track as user A, and
-- verifies user B cannot see or modify it. Everything rolls back.

begin;

-- two throwaway users straight into auth.users (service-role context)
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-00000000000a', 'user-a@rls.test'),
  ('00000000-0000-0000-0000-00000000000b', 'user-b@rls.test');

-- act as user A
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';

insert into public.tracks (user_id, content_hash, file_name, title)
values ('00000000-0000-0000-0000-00000000000a', repeat('1', 64), 'song.flac', 'Song');

do $$
begin
  if (select count(*) from public.tracks) <> 1 then
    raise exception 'FAIL: user A should see exactly their 1 track';
  end if;
end $$;

-- act as user B
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';

do $$
begin
  if (select count(*) from public.tracks) <> 0 then
    raise exception 'FAIL: user B must not see user A''s tracks';
  end if;
end $$;

-- user B must not be able to insert rows owned by user A
do $$
begin
  begin
    insert into public.tracks (user_id, content_hash, file_name, title)
    values ('00000000-0000-0000-0000-00000000000a', repeat('2', 64), 'x.flac', 'X');
    raise exception 'FAIL: user B inserted a row owned by user A';
  exception
    when insufficient_privilege or check_violation then
      null; -- expected: RLS with check blocked it
  end;
end $$;

reset role;
select 'RLS smoke test passed' as result;

rollback;
