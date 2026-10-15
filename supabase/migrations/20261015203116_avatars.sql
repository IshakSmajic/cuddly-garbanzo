-- Milestone 3: avatars (spec section 5).
--
-- Files live in Supabase Storage; profiles.avatar_path points at one. Storage
-- and Postgres don't share a transaction, so the app uploads first, then
-- calls set_avatar, then deletes the old file (see src/lib/avatarUpload.ts).

-- Bucket ---------------------------------------------------------------------
-- Created here rather than in config.toml, which only configures the local
-- stack: `supabase db push` then creates the same bucket on the hosted project.
-- Public: anyone with a file's URL can view it (decided 15 Oct 2026). Object
-- names are random, so URLs can't be guessed, and listing is not public.
-- The size and type limits are enforced by the storage server on upload; the
-- type is the one the client reports, not a check of the file's content.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp']);

-- Storage policies -------------------------------------------------------------
-- Every stored file is a row in storage.objects, so file permissions are RLS
-- policies. Paths are {user_id}/{random uuid}.{ext}: a user owns the folder
-- named after their id. No update policy: files are never overwritten, each
-- upload gets a new name (which also means browsers never cache a stale image).
create policy "Users upload avatars into their own folder"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Viewing goes through the public URL and needs no policy. This one lets the
-- API list and delete your own files (delete needs select too), and nobody
-- else's, so folders can't be enumerated.
create policy "Users see their own avatar files"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users delete their own avatar files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Pointing the profile at a file -------------------------------------------------
-- avatar_path has no update grant (milestone 2), so these functions are the
-- only way to change it. They run as their owner (security definer) and check
-- everything a column grant couldn't: the path is in the caller's folder, has
-- the expected shape, and names a file the caller actually uploaded.
-- Both return the previous path so the app can delete that file.

create function public.set_avatar(new_path text)
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
    raise exception 'Avatar file not found' using errcode = 'P0002';
  end if;

  -- Lock the row so two concurrent changes can't both read the same old path
  -- (the second would then leave the first one's upload orphaned).
  select avatar_path into old_path from public.profiles where user_id = uid for update;
  update public.profiles set avatar_path = new_path where user_id = uid;
  return old_path;
end;
$$;

create function public.remove_avatar()
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

  select avatar_path into old_path from public.profiles where user_id = uid for update;
  update public.profiles set avatar_path = null where user_id = uid;
  return old_path;
end;
$$;

-- Functions are executable by PUBLIC by default; only signed-in users need these.
revoke execute on function public.set_avatar(text), public.remove_avatar() from public, anon;
grant execute on function public.set_avatar(text), public.remove_avatar() to authenticated;

comment on column public.profiles.avatar_path is
  'Path in the avatars bucket. Changed only through set_avatar and remove_avatar.';
