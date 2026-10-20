-- MusicVault: reject foreign or malformed artwork_key writes.
--
-- Applied to the live project on 2026-10-20.
--
-- apply_track_edit already checks artwork_key, but a client can also write
-- the column with a direct INSERT or UPDATE through PostgREST. A key under
-- another user's prefix would then be handed to the vault Edge Function's
-- service-role delete. The function now refuses such keys itself; this
-- closes the database side, so the column can only ever hold the caller's
-- own full cover key (users/<user_id>/art/<sha256>.jpg) or null.
--
-- Only a changed value is checked, so existing rows and upserts that resend
-- an unchanged key keep working. Writes by the SQL functions and the service
-- role are not affected.

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

    if new.artwork_key is not null
       and (tg_op = 'INSERT' or new.artwork_key is distinct from old.artwork_key)
       and new.artwork_key !~ ('^users/' || new.user_id::text || '/art/[0-9a-f]{64}\.jpg$') then
      raise exception 'invalid artwork_key' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.tracks_protect_vault_columns() from public, anon, authenticated;
