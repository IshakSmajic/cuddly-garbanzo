-- Follow-up to milestone 3 (avatars).
--
-- 1. set_avatar reported a missing file with P0002. PostgREST maps P0 codes
--    other than P0001 to HTTP 500, which reads as a server fault; a missing
--    file is the caller's mistake, so it now uses 22023 (HTTP 400) like the
--    path check.
-- 2. The delete policy allowed deleting the file your profile points at,
--    leaving avatar_path naming nothing (a broken image for everyone). The app
--    always repoints the profile first and deletes afterwards, so it never
--    needs to delete the current file.

-- create or replace keeps the function's owner and its execute grants.
create or replace function public.set_avatar(new_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  old_path text;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  -- A uuid's text form is only hex digits and hyphens, so it is safe to
  -- splice into the pattern.
  if new_path is null or new_path !~ (
    '^' || uid::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
  ) then
    raise exception 'Invalid avatar path' using errcode = '22023';
  end if;

  if not exists (
    select 1 from storage.objects
    where bucket_id = 'avatars' and name = new_path and owner_id = uid::text
  ) then
    raise exception 'Avatar file not found' using errcode = '22023';
  end if;

  -- Lock the row so two concurrent changes can't both read the same old path
  -- (the second would then leave the first one's upload orphaned).
  select avatar_path into old_path from public.profiles where user_id = uid for update;
  update public.profiles set avatar_path = new_path where user_id = uid;
  return old_path;
end;
$$;

drop policy "Users delete their own avatar files" on storage.objects;

-- "is distinct from" rather than "<>": with no avatar, avatar_path is null and
-- "<> null" would be null (false), blocking every delete.
create policy "Users delete their own avatar files except the current one"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name is distinct from (
      select avatar_path from public.profiles where user_id = (select auth.uid())
    )
  );
