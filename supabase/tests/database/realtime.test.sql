begin;
create extension if not exists pgtap with schema extensions;

select plan(2);

-- Realtime sends DELETE events to every subscriber of a table with the old
-- primary key, unchecked by RLS. Only tables whose keys reveal nothing may be
-- published (see the realtime migration); this pins the exact list.
select is(
  (select array_agg(schemaname || '.' || tablename order by tablename)
   from pg_publication_tables where pubname = 'supabase_realtime'),
  array['public.friend_requests', 'public.messages'],
  'only messages and friend_requests are published for realtime'
);
select ok(
  not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and tablename in ('friendships', 'conversation_members', 'blocks', 'direct_conversations')
  ),
  'tables whose keys are user ids are never published (their deletes would leak who unfriended, blocked or talked to whom)'
);

select * from finish();
rollback;
