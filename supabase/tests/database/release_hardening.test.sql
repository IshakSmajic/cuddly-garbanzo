begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

-- Advisors -----------------------------------------------------------------------
select has_index('public', 'conversation_members', 'conversation_members_last_read', 'reading positions are indexed (FK to messages)');
select has_index('public', 'messages', 'messages_sender_member', 'senders are indexed (FK to conversation_members)');
select col_is_pk('public', 'search_events', 'id', 'search_events has a primary key');

-- Fixtures: ana and ben are friends; files of every kind, old and new ---------------
insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-000000000001', 'ana@example.com'),
  ('22222222-0000-0000-0000-000000000002', 'ben@example.com');
select private.make_friends('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002');
select set_config('test.ab', (select conversation_id::text from public.direct_conversations
  where user_high_id = '22222222-0000-0000-0000-000000000002'), true);

-- Avatars: in use (old), replaced (old), just uploaded (new).
insert into storage.objects (bucket_id, name, owner_id, created_at) values
  ('avatars', '11111111-0000-0000-0000-000000000001/a0000000-0000-0000-0000-000000000001.webp', '11111111-0000-0000-0000-000000000001', now() - interval '2 days'),
  ('avatars', '11111111-0000-0000-0000-000000000001/a0000000-0000-0000-0000-000000000002.webp', '11111111-0000-0000-0000-000000000001', now() - interval '2 days'),
  ('avatars', '11111111-0000-0000-0000-000000000001/a0000000-0000-0000-0000-000000000003.webp', '11111111-0000-0000-0000-000000000001', now() - interval '1 hour');
update public.profiles set avatar_path = '11111111-0000-0000-0000-000000000001/a0000000-0000-0000-0000-000000000001.webp'
  where user_id = '11111111-0000-0000-0000-000000000001';

-- Message images: sent (old), failed send (old), mid-send (new).
insert into storage.objects (bucket_id, name, owner_id, created_at) values
  ('message-images', current_setting('test.ab') || '/b0000000-0000-0000-0000-000000000001.webp', '11111111-0000-0000-0000-000000000001', now() - interval '2 days'),
  ('message-images', current_setting('test.ab') || '/b0000000-0000-0000-0000-000000000002.webp', '11111111-0000-0000-0000-000000000001', now() - interval '2 days'),
  ('message-images', current_setting('test.ab') || '/b0000000-0000-0000-0000-000000000003.webp', '11111111-0000-0000-0000-000000000001', now() - interval '1 hour');
with m as (
  insert into public.messages (conversation_id, sender_id, client_id)
  values (current_setting('test.ab')::uuid, '11111111-0000-0000-0000-000000000001', gen_random_uuid())
  returning id
)
insert into public.message_attachments (message_id, storage_path, mime_type, size_bytes, width, height)
select id, current_setting('test.ab') || '/b0000000-0000-0000-0000-000000000001.webp', 'image/webp', 100, 10, 10 from m;

-- Only this test's files (the local stack may hold others).
create function pg_temp.mine(min_age interval default interval '1 day') returns setof text language sql as $$
  select f.name from public.orphan_files(min_age) f
  where f.name like '11111111-0000-0000-0000-000000000001/%' or f.name like current_setting('test.ab') || '/%';
$$;

-- orphan_files ------------------------------------------------------------------------
set local role service_role;
select set_eq(
  'select pg_temp.mine()',
  array[
    '11111111-0000-0000-0000-000000000001/a0000000-0000-0000-0000-000000000002.webp',
    current_setting('test.ab') || '/b0000000-0000-0000-0000-000000000002.webp'
  ],
  'orphans are files over a day old that no profile or attachment points at'
);
select is((select count(*)::int from pg_temp.mine(interval '0 seconds')), 4, 'with no minimum age, the new uploads count too');

reset role;
delete from auth.users where id = '22222222-0000-0000-0000-000000000002';
delete from auth.users where id = '11111111-0000-0000-0000-000000000001';
set local role service_role;
select is(
  (select count(*)::int from pg_temp.mine()),
  4,
  'once both accounts are gone, the avatar and the conversation''s images are orphans too'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-0000-0000-0000-000000000001", "role": "authenticated"}', true);
select throws_ok('select * from public.orphan_files()', '42501', null, 'signed-in users cannot list orphaned files');
reset role;
set local role anon;
select throws_ok('select * from public.orphan_files()', '42501', null, 'signed-out visitors cannot either');
reset role;

-- The schedule ---------------------------------------------------------------------------
select is((select schedule from cron.job where jobname = 'cleanup-files'), '17 3 * * *', 'cleanup-files runs daily');
select ok(
  (select command from cron.job where jobname = 'cleanup-files') like '%vault.decrypted_secrets%',
  'the job reads its address and secret from Vault at run time'
);
select ok(
  (select command from cron.job where jobname = 'cleanup-files') not like '%local-cleanup-secret%',
  'no secret is written into the job itself'
);
select ok(
  not has_function_privilege('authenticated', 'public.orphan_files(interval, integer)', 'execute')
    and has_function_privilege('service_role', 'public.orphan_files(interval, integer)', 'execute'),
  'only service_role may execute orphan_files'
);

select ok(
  not has_function_privilege('authenticated', 'private.announce_friendship_change()', 'execute')
    and not has_function_privilege('anon', 'public.set_updated_at()', 'execute'),
  'trigger functions are not executable by clients'
);

select * from finish();
rollback;
