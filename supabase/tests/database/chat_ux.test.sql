begin;
create extension if not exists pgtap with schema extensions;

select plan(29);

-- Fixtures -----------------------------------------------------------------------
-- ana and ben are friends; cai is an outsider.
insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-000000000001', 'ana@example.com'),
  ('22222222-0000-0000-0000-000000000002', 'ben@example.com'),
  ('33333333-0000-0000-0000-000000000003', 'cai@example.com');
update public.profiles set username = 'pgt_ana' where user_id = '11111111-0000-0000-0000-000000000001';
update public.profiles set username = 'pgt_ben' where user_id = '22222222-0000-0000-0000-000000000002';
update public.profiles set username = 'pgt_cai' where user_id = '33333333-0000-0000-0000-000000000003';
select private.make_friends('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002');
select set_config('test.ab', (select conversation_id::text from public.direct_conversations
  where user_low_id = '11111111-0000-0000-0000-000000000001' and user_high_id = '22222222-0000-0000-0000-000000000002'), true);

-- Five messages from ben, two from ana, one second apart.
insert into public.messages (conversation_id, sender_id, client_id, content, created_at)
select current_setting('test.ab')::uuid,
       case when i <= 5 then '22222222-0000-0000-0000-000000000002'::uuid else '11111111-0000-0000-0000-000000000001'::uuid end,
       gen_random_uuid(), 'm' || i, '2026-01-01'::timestamptz + i * interval '1 second'
from generate_series(1, 7) i;
create function pg_temp.msg(n integer) returns bigint language sql as $$
  select id from public.messages where content = 'm' || n and conversation_id = current_setting('test.ab')::uuid;
$$;

create function pg_temp.as_user(id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', id, 'role', 'authenticated')::text, true);
$$;
-- What Realtime does when a client joins a private channel: set the topic,
-- then, as that user, see whether the policies let it read a row on the
-- topic (listen) and insert one (send). These go through the real policies.
create function pg_temp.on_topic(topic text) returns void language sql as $$
  select set_config('realtime.topic', topic, true);
$$;
create function pg_temp.can_listen(ext text) returns boolean language sql as $$
  select exists (select 1 from realtime.messages m where m.topic = realtime.topic() and m.extension = ext);
$$;
create function pg_temp.can_send(ext text) returns boolean language plpgsql as $$
begin
  insert into realtime.messages (topic, extension, event, payload, private)
  values (realtime.topic(), ext, 'test', '{}', true);
  return true;
exception when insufficient_privilege then
  return false;
end;
$$;
-- One row on each topic to be (or not be) seen.
insert into realtime.messages (topic, extension, event, payload, private) values
  ('conversation:' || current_setting('test.ab'), 'broadcast', 'test', '{}', true),
  ('user:22222222-0000-0000-0000-000000000002', 'presence', 'test', '{}', true);

-- Unread counts and mark_read ---------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana

select is(
  (select unread_count from public.my_conversations()), 5,
  'messages from the other person count as unread; your own do not'
);
select lives_ok(
  $$select public.mark_read(current_setting('test.ab')::uuid, pg_temp.msg(3))$$,
  'ana marks up to the third message read'
);
select is((select unread_count from public.my_conversations()), 2, '... leaving two unread');
select lives_ok(
  $$select public.mark_read(current_setting('test.ab')::uuid, pg_temp.msg(1))$$,
  'marking an older message is harmless'
);
select is(
  (select last_read_message_id from public.conversation_members
   where user_id = '11111111-0000-0000-0000-000000000001'),
  pg_temp.msg(3),
  '... the reading position never moves back'
);
select lives_ok(
  $$select public.mark_read(current_setting('test.ab')::uuid, pg_temp.msg(7))$$,
  'marking the newest message'
);
select is((select unread_count from public.my_conversations()), 0, '... clears the unread count');
select throws_ok(
  $$select public.mark_read(current_setting('test.ab')::uuid, 999999)$$,
  '22023', null, 'a message that is not in the conversation is refused'
);
select throws_ok(
  $$update public.conversation_members set last_read_message_id = null$$,
  '42501', null, 'the reading position cannot be changed directly'
);

select pg_temp.as_user('22222222-0000-0000-0000-000000000002'); -- ben
select is(
  (select last_read_message_id from public.conversation_members
   where user_id = '11111111-0000-0000-0000-000000000001'),
  pg_temp.msg(7),
  'the other member can read ana''s position (for "Seen")'
);
select is((select unread_count from public.my_conversations()), 2, 'ben has ana''s two messages unread');

select set_config('test.m7', pg_temp.msg(7)::text, true);
select pg_temp.as_user('33333333-0000-0000-0000-000000000003'); -- cai
select throws_ok(
  $$select public.mark_read(current_setting('test.ab')::uuid, current_setting('test.m7')::bigint)$$,
  '42501', null, 'someone outside the conversation cannot mark it read'
);

reset role;
set local role anon;
select throws_ok(
  $$select public.mark_read(current_setting('test.ab')::uuid, 1)$$,
  '42501', null, 'signed-out visitors cannot call mark_read'
);
reset role;

-- Channel names ------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana
select pg_temp.on_topic('conversation:' || current_setting('test.ab'));
select is(private.topic_id('conversation'), current_setting('test.ab')::uuid, 'topic_id reads the id from the channel name');
select pg_temp.on_topic('conversation:' || current_setting('test.ab') || 'x');
select is(private.topic_id('conversation'), null, 'a malformed channel name gives no id');
select pg_temp.on_topic('user:' || current_setting('test.ab'));
select is(private.topic_id('conversation'), null, 'the wrong kind of channel gives no id');

-- Conversation channels -------------------------------------------------------------------------
select pg_temp.on_topic('conversation:' || current_setting('test.ab'));
select ok(pg_temp.can_listen('broadcast'), 'a member may listen to the conversation channel');
select ok(pg_temp.can_send('broadcast'), 'a friend may broadcast in it (typing)');

select pg_temp.as_user('33333333-0000-0000-0000-000000000003'); -- cai
select ok(not pg_temp.can_listen('broadcast'), 'an outsider may not listen');
select ok(not pg_temp.can_send('broadcast'), 'an outsider may not broadcast');

-- Presence channels ---------------------------------------------------------------------------------
select pg_temp.on_topic('user:22222222-0000-0000-0000-000000000002');
select ok(not pg_temp.can_listen('presence'), 'a non-friend may not watch ben''s online status');
select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana
select ok(pg_temp.can_listen('presence'), 'a friend may watch it');
select pg_temp.as_user('22222222-0000-0000-0000-000000000002'); -- ben
select ok(pg_temp.can_listen('presence'), 'ben may watch his own channel');
select ok(pg_temp.can_send('presence'), '... and announce his presence on it');
select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana
select ok(not pg_temp.can_send('presence'), 'a friend may not announce presence on ben''s channel');

-- The exact policies on realtime.messages (as the owner).
reset role;
select is(
  (select array_agg(policyname::text || ':' || cmd order by policyname) from pg_policies
   where schemaname = 'realtime' and tablename = 'messages'),
  array[
    'Friends broadcast in their conversation:INSERT',
    'Friends see each other''s presence:SELECT',
    'Members listen to their conversation:SELECT',
    'Users announce only their own presence:INSERT'
  ],
  'realtime.messages has exactly the four channel policies'
);

-- After unfriending ---------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana
select public.unfriend('22222222-0000-0000-0000-000000000002');
select pg_temp.on_topic('conversation:' || current_setting('test.ab'));
select ok(pg_temp.can_listen('broadcast'), 'a former friend may still listen to the conversation (history stays readable)');
select ok(not pg_temp.can_send('broadcast'), '... but may no longer broadcast in it');
select pg_temp.on_topic('user:22222222-0000-0000-0000-000000000002');
select ok(not pg_temp.can_listen('presence'), '... nor watch the other''s online status');

select * from finish();
rollback;
