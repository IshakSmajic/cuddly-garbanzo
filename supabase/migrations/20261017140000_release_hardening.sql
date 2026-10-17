-- Milestone 10: release hardening (spec section 9).
--
-- 1. Indexes and a primary key the Supabase advisors asked for.
-- 2. Finding files nothing points at, for the cleanup-files Edge Function.
-- 3. A daily schedule that calls that function.

-- 1. Advisors ---------------------------------------------------------------------
-- Foreign keys are checked from the referenced side too: deleting a message
-- (or a membership, on account deletion) looks for rows pointing at it. Without
-- an index on the referencing columns, that is a scan of the whole table.
create index conversation_members_last_read on public.conversation_members (last_read_message_id);
create index messages_sender_member on public.messages (conversation_id, sender_id);

-- search_events had no key: rows are only counted and pruned, never addressed.
-- A key costs nothing and lets tools (and logical replication) identify rows.
-- "RLS enabled, no policies" stays as it is: clients must see nothing here.
alter table public.search_events add column id bigint generated always as identity primary key;

-- Trigger functions are executable by PUBLIC by default. Nobody can call
-- them directly (Postgres refuses outside a trigger) and execute is checked
-- only when a trigger is created, not when it fires, so this changes nothing
-- at run time; it keeps the grants saying what is meant.
revoke execute on function
  private.announce_friendship_change(),
  private.delete_empty_conversation(),
  public.set_updated_at()
from public, anon, authenticated;

-- 2. Orphaned files ------------------------------------------------------------------
-- Storage and Postgres don't share a transaction, so files can outlive what
-- pointed at them: an avatar replaced when deleting the old file failed, a
-- deleted account's avatar, an image whose send failed after the upload, the
-- images of a conversation deleted once both accounts were gone.
--
-- SQL can't delete stored files (storage.protect_delete refuses, and deleting
-- the row would leave the bytes behind), so this only lists them; the
-- cleanup-files Edge Function deletes them through the Storage API.
--
-- Only files older than `min_age`: a file uploaded a moment ago may be about
-- to be attached (upload first, then set_avatar or send_image_message).
-- Security invoker, executable by service_role only (which bypasses RLS):
-- the function sees every user's files.

create function public.orphan_files(min_age interval default interval '1 day', max_files integer default 1000)
returns table (bucket_id text, name text)
language sql
stable
set search_path = ''
as $$
  select o.bucket_id, o.name
  from storage.objects o
  where o.created_at < now() - min_age
    and (
      (o.bucket_id = 'avatars'
        and not exists (select 1 from public.profiles p where p.avatar_path = o.name))
      or (o.bucket_id = 'message-images'
        and not exists (select 1 from public.message_attachments a where a.storage_path = o.name))
    )
  order by o.created_at
  limit least(greatest(max_files, 1), 1000);
$$;

revoke execute on function public.orphan_files(interval, integer) from public, anon, authenticated;
grant execute on function public.orphan_files(interval, integer) to service_role;

-- 3. The daily run -----------------------------------------------------------------
-- pg_cron runs a statement on a schedule; pg_net makes the HTTP request to
-- the Edge Function. The function's address and its secret are read from
-- Vault when the job runs, so neither is in this file: each environment
-- stores its own (supabase/seed.sql locally; by hand on the hosted project).
-- Until they are stored, the job fails harmlessly (see cron.job_run_details).

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'cleanup-files',
  '17 3 * * *', -- every day at 03:17 UTC
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
        || '/functions/v1/cleanup-files',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $job$
);
