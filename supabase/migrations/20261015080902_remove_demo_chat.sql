-- Remove the pre-spec demo: the global chat room, its profiles table and the
-- two test accounts (which share a published password). The real schema from
-- the spec starts in milestone 2.

-- Dropping messages also removes it from the supabase_realtime publication.
drop table if exists public.messages;
drop table if exists public.profiles;

-- auth.identities rows go with them (on delete cascade).
delete from auth.users
where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
);
