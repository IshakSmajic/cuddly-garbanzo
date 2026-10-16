begin;
create extension if not exists pgtap with schema extensions;

select plan(35);

-- Fixtures -----------------------------------------------------------------------
-- ana and ben are friends; cai is friends with nobody; dee is ana's friend.
insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-000000000001', 'ana@example.com'),
  ('22222222-0000-0000-0000-000000000002', 'ben@example.com'),
  ('33333333-0000-0000-0000-000000000003', 'cai@example.com'),
  ('44444444-0000-0000-0000-000000000004', 'dee@example.com');
update public.profiles set username = 'pgt_ana', display_name = 'Ana' where user_id = '11111111-0000-0000-0000-000000000001';
update public.profiles set username = 'pgt_ben', display_name = 'Ben' where user_id = '22222222-0000-0000-0000-000000000002';
update public.profiles set username = 'pgt_cai', display_name = 'Cai' where user_id = '33333333-0000-0000-0000-000000000003';
update public.profiles set username = 'pgt_dee', display_name = 'Dee' where user_id = '44444444-0000-0000-0000-000000000004';
select private.make_friends('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002');
select private.make_friends('11111111-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000004');
select set_config('test.ab', (select conversation_id::text from public.direct_conversations
  where user_high_id = '22222222-0000-0000-0000-000000000002'), true);
select set_config('test.ad', (select conversation_id::text from public.direct_conversations
  where user_high_id = '44444444-0000-0000-0000-000000000004'), true);

create function pg_temp.as_user(id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', id, 'role', 'authenticated')::text, true);
$$;
-- A send as the current user, the way the app does it.
create function pg_temp.send(conversation text, client uuid, body text) returns void language sql as $$
  insert into public.messages (conversation_id, client_id, content) values (conversation::uuid, client, body);
$$;

-- Sending ----------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana

select lives_ok(
  $$select pg_temp.send(current_setting('test.ab'), 'aaaaaaaa-0000-0000-0000-000000000001', 'Hi Ben')$$,
  'a friend can send a message'
);
select is(
  (select sender_id from public.messages where client_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '11111111-0000-0000-0000-000000000001'::uuid,
  'the sender is filled in by the database'
);
select throws_ok(
  $$select pg_temp.send(current_setting('test.ab'), 'aaaaaaaa-0000-0000-0000-000000000001', 'Hi Ben')$$,
  '23505', null, 'a retry with the same client_id cannot create a duplicate'
);
select is((select count(*)::int from public.messages), 1, '... so there is still one message');
select throws_ok(
  $$insert into public.messages (conversation_id, client_id, content, sender_id)
    values (current_setting('test.ab')::uuid, gen_random_uuid(), 'as ben', '22222222-0000-0000-0000-000000000002')$$,
  '42501', null, 'a client cannot choose the sender'
);
select throws_ok(
  $$insert into public.messages (conversation_id, client_id, content, created_at)
    values (current_setting('test.ab')::uuid, gen_random_uuid(), 'old', '2020-01-01')$$,
  '42501', null, 'a client cannot backdate a message'
);
select throws_ok(
  $$insert into public.messages (conversation_id, client_id) values (current_setting('test.ab')::uuid, gen_random_uuid())$$,
  '42501', null, 'a message without text is refused (images come later, through a function)'
);
select throws_ok(
  $$select pg_temp.send(current_setting('test.ab'), gen_random_uuid(), '')$$,
  '23514', null, 'an empty message is refused'
);
select throws_ok(
  $$select pg_temp.send(current_setting('test.ab'), gen_random_uuid(), e'  \n\t ')$$,
  '23514', null, 'a message of only spaces and line breaks is refused'
);
select lives_ok(
  $$select pg_temp.send(current_setting('test.ab'), gen_random_uuid(), repeat('é', 4000))$$,
  '4,000 characters are allowed (counted as characters, not bytes)'
);
select throws_ok(
  $$select pg_temp.send(current_setting('test.ab'), gen_random_uuid(), repeat('x', 4001))$$,
  '23514', null, '4,001 characters are refused'
);
select throws_ok(
  $$update public.messages set content = 'edited'$$,
  '42501', null, 'messages cannot be edited'
);
select throws_ok($$delete from public.messages$$, '42501', null, 'messages cannot be deleted');

select pg_temp.as_user('33333333-0000-0000-0000-000000000003'); -- cai
select throws_ok(
  $$select pg_temp.send(current_setting('test.ab'), gen_random_uuid(), 'let me in')$$,
  '42501', null, 'someone outside the conversation cannot send into it'
);
select is((select count(*)::int from public.messages), 0, 'someone outside the conversation cannot read it');
select is((select count(*)::int from public.messages_page(current_setting('test.ab')::uuid)), 0,
  '... not through messages_page either');

-- Reading -------------------------------------------------------------------------------
select pg_temp.as_user('22222222-0000-0000-0000-000000000002'); -- ben
select is((select count(*)::int from public.messages), 2, 'the other member reads the messages');
select lives_ok(
  $$select pg_temp.send(current_setting('test.ab'), 'bbbbbbbb-0000-0000-0000-000000000001', 'Hi Ana')$$,
  'and can reply'
);
select lives_ok(
  $$select pg_temp.send(current_setting('test.ab'), 'aaaaaaaa-0000-0000-0000-000000000001', 'Same id, other sender')$$,
  'client ids only need to be unique per sender'
);
select throws_ok(
  $$select pg_temp.send(current_setting('test.ad'), gen_random_uuid(), 'peek')$$,
  '42501', null, 'a friend of ana cannot send into her conversation with someone else'
);

-- The chat list ----------------------------------------------------------------------------
select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana
select is(
  (select array_agg(display_name) from public.my_conversations()),
  array['Ben', 'Dee'],
  'the chat list has every conversation, the most recently active first'
);
select is(
  (select last_content from public.my_conversations() where display_name = 'Ben'),
  'Same id, other sender',
  '... with its last message'
);
select is(
  (select count(*)::int from public.my_conversations(current_setting('test.ad')::uuid)), 1,
  'my_conversations can return a single conversation'
);

-- Unfriend: history stays, sending stops ---------------------------------------------------------
select public.unfriend('22222222-0000-0000-0000-000000000002');
select throws_ok(
  $$select pg_temp.send(current_setting('test.ab'), gen_random_uuid(), 'still there?')$$,
  '42501', null, 'after unfriending, nobody can send'
);
select is((select count(*)::int from public.messages), 4, 'after unfriending, the history is still readable');
select is(
  (select is_friend from public.my_conversations(current_setting('test.ab')::uuid)), false,
  'the chat list marks the conversation as no longer friends'
);

-- Block: the same ---------------------------------------------------------------------------------
select pg_temp.as_user('44444444-0000-0000-0000-000000000004'); -- dee
select pg_temp.send(current_setting('test.ad'), gen_random_uuid(), 'Hello Ana');
select public.block_user('11111111-0000-0000-0000-000000000001');
select throws_ok(
  $$select pg_temp.send(current_setting('test.ad'), gen_random_uuid(), 'one more')$$,
  '42501', null, 'after a block, nobody can send'
);
select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana
select is(
  (select count(*)::int from public.messages where conversation_id = current_setting('test.ad')::uuid), 1,
  'the blocked person can still read the history'
);

-- Paging ------------------------------------------------------------------------------------------------
-- 120 messages from ana to ben, inserted as the owner: two per timestamp, so
-- the id is what breaks ties.
reset role;
insert into public.messages (conversation_id, sender_id, client_id, content, created_at)
select current_setting('test.ab')::uuid, '11111111-0000-0000-0000-000000000001', gen_random_uuid(),
       'paged ' || i, '2026-01-01'::timestamptz + (i / 2) * interval '1 second'
from generate_series(1, 120) i;
set local role authenticated;
select pg_temp.as_user('22222222-0000-0000-0000-000000000002'); -- ben

create temp table pages on commit drop as select * from public.messages limit 0;
grant all on pages to authenticated;
do $$
declare
  last public.messages;
begin
  loop
    insert into pages
      select * from public.messages_page(current_setting('test.ab')::uuid, last.created_at, last.id, 50);
    select * into last from pages order by created_at, id limit 1;
    exit when (select count(*) from pages) >= (select count(*) from public.messages
                                               where conversation_id = current_setting('test.ab')::uuid);
  end loop;
end;
$$;
select is((select count(*)::int from pages), 124, 'paging returns every message');
select is((select count(distinct id)::int from pages), 124, '... each exactly once, even with equal timestamps');
select is(
  (select count(*)::int from public.messages_page(current_setting('test.ab')::uuid)), 50,
  'a page has 50 messages by default'
);
select is(
  (select content from public.messages_page(current_setting('test.ab')::uuid, null, null, 1)),
  'Same id, other sender',
  'the first page starts with the newest message'
);

-- Account deletion -----------------------------------------------------------------------------------------
reset role;
delete from auth.users where id = '22222222-0000-0000-0000-000000000002';
select is(
  (select count(*)::int from public.messages where conversation_id = current_setting('test.ab')::uuid and sender_id is null), 2,
  'a deleted account''s messages stay, with no sender ("Deleted user")'
);
set local role authenticated;
select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana
select is(
  (select array[coalesce(display_name, 'Deleted user')] from public.my_conversations(current_setting('test.ab')::uuid)),
  array['Deleted user'],
  'the chat list shows the other person as deleted'
);
reset role;
delete from auth.users where id = '11111111-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.messages where conversation_id in (current_setting('test.ab')::uuid, current_setting('test.ad')::uuid)),
  1,
  'when both have deleted their accounts, the conversation''s messages go too; others stay'
);

select * from finish();
rollback;
