begin;
create extension if not exists pgtap with schema extensions;

select plan(36);

-- Fixtures -----------------------------------------------------------------------
-- ids sort ana < ben < cai < dee, so "low" and "high" are predictable.
insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-000000000001', 'ana@example.com'),
  ('22222222-0000-0000-0000-000000000002', 'ben@example.com'),
  ('33333333-0000-0000-0000-000000000003', 'cai@example.com'),
  ('44444444-0000-0000-0000-000000000004', 'dee@example.com');
update public.profiles set username = 'pgt_ana' where user_id = '11111111-0000-0000-0000-000000000001';
update public.profiles set username = 'pgt_ben' where user_id = '22222222-0000-0000-0000-000000000002';
update public.profiles set username = 'pgt_cai' where user_id = '33333333-0000-0000-0000-000000000003';
update public.profiles set username = 'pgt_dee' where user_id = '44444444-0000-0000-0000-000000000004';

create function pg_temp.as_user(id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', id, 'role', 'authenticated')::text, true);
$$;

-- Accepting creates the conversation ------------------------------------------------
set local role authenticated;
select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana
select public.send_friend_request('22222222-0000-0000-0000-000000000002');
select is((select count(*)::int from public.conversations), 0, 'a pending request has no conversation yet');

select pg_temp.as_user('22222222-0000-0000-0000-000000000002'); -- ben
select is(
  public.respond_to_friend_request((select id from public.friend_requests where status = 'pending'), true),
  'accepted',
  'ben accepts'
);
select is((select count(*)::int from public.conversations), 1, 'accepting creates one conversation');
select is(
  (select array[user_low_id, user_high_id] from public.direct_conversations),
  array['11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002']::uuid[],
  '... mapped to the pair, lower id first'
);
select is(
  (select array_agg(user_id order by user_id) from public.conversation_members),
  array['11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002']::uuid[],
  '... with both of them as members (each sees the other''s membership)'
);
select set_config('test.conversation', (select id::text from public.conversations), true);

select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana
select is((select count(*)::int from public.conversations), 1, 'ana sees the conversation too');
select ok(
  private.is_conversation_member(current_setting('test.conversation')::uuid),
  'is_conversation_member is true for a member'
);

-- Outsiders and direct writes ------------------------------------------------------------
select pg_temp.as_user('33333333-0000-0000-0000-000000000003'); -- cai
select is((select count(*)::int from public.conversations), 0, 'others cannot see the conversation');
select is((select count(*)::int from public.direct_conversations), 0, 'others cannot see its pair');
select is((select count(*)::int from public.conversation_members), 0, 'others cannot see its members');
select ok(
  not private.is_conversation_member(current_setting('test.conversation')::uuid),
  'is_conversation_member is false for someone else'
);
select throws_ok(
  $$select private.lock_pair('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002')$$,
  '42501', null, 'the other private helpers stay off-limits'
);
select throws_ok($$insert into public.conversations default values$$, '42501', null, 'clients cannot create conversations');
select throws_ok(
  $$insert into public.conversation_members (conversation_id, user_id)
    values (current_setting('test.conversation')::uuid, '33333333-0000-0000-0000-000000000003')$$,
  '42501', null, 'clients cannot add themselves to a conversation'
);
select throws_ok(
  $$insert into public.direct_conversations (conversation_id, user_low_id, user_high_id)
    values (current_setting('test.conversation')::uuid, '33333333-0000-0000-0000-000000000003',
            '44444444-0000-0000-0000-000000000004')$$,
  '42501', null, 'clients cannot write direct_conversations'
);

select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana
select throws_ok(
  $$delete from public.conversation_members where user_id = '22222222-0000-0000-0000-000000000002'$$,
  '42501', null, 'members cannot remove anyone from a conversation'
);

reset role;
set local role anon;
select throws_ok($$select * from public.conversations$$, '42501', null, 'signed-out visitors cannot read conversations');
reset role;

-- Constraints (as the owner) -------------------------------------------------------------------
select throws_ok(
  $$insert into public.direct_conversations (conversation_id, user_low_id, user_high_id)
    values (current_setting('test.conversation')::uuid, '22222222-0000-0000-0000-000000000002',
            '11111111-0000-0000-0000-000000000001')$$,
  '23514', null, 'a pair must be stored lower id first'
);
select throws_ok(
  $$with c as (insert into public.conversations default values returning id)
    insert into public.direct_conversations (conversation_id, user_low_id, user_high_id)
    select id, '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002' from c$$,
  '23505', null, 'a pair cannot have a second conversation'
);

-- Unfriending keeps the history ----------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana
select throws_ok(
  $$select public.unfriend('11111111-0000-0000-0000-000000000001')$$,
  '22023', null, 'you cannot unfriend yourself'
);
select lives_ok($$select public.unfriend('22222222-0000-0000-0000-000000000002')$$, 'ana unfriends ben');
select is((select count(*)::int from public.friendships), 0, 'the friendship is gone');
select lives_ok($$select public.unfriend('22222222-0000-0000-0000-000000000002')$$, 'unfriending twice is harmless');
select is(
  (select count(*)::int from public.conversation_members where conversation_id = current_setting('test.conversation')::uuid),
  2,
  'after unfriending, the conversation and both memberships remain'
);

select pg_temp.as_user('22222222-0000-0000-0000-000000000002'); -- ben
select is((select count(*)::int from public.conversations), 1, 'ben can still read the conversation');

-- Re-friending reuses it -------------------------------------------------------------------------
select public.send_friend_request('11111111-0000-0000-0000-000000000001');
select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana
select is(
  public.send_friend_request('22222222-0000-0000-0000-000000000002'), 'friends',
  'ana and ben become friends again'
);
select is(
  (select array_agg(id) from public.conversations),
  array[current_setting('test.conversation')::uuid],
  're-friending reuses the same conversation'
);
select is(
  (select count(*)::int from public.conversation_members), 2,
  '... without duplicate memberships'
);

-- Blocking keeps the history too ----------------------------------------------------------------
select public.block_user('22222222-0000-0000-0000-000000000002');
select is((select count(*)::int from public.friendships), 0, 'blocking ends the friendship');
select pg_temp.as_user('22222222-0000-0000-0000-000000000002'); -- ben
select is((select count(*)::int from public.conversations), 1, 'the blocked user can still read the history');

-- Account deletion -----------------------------------------------------------------------------------
select pg_temp.as_user('33333333-0000-0000-0000-000000000003'); -- cai
select public.send_friend_request('44444444-0000-0000-0000-000000000004');
select pg_temp.as_user('44444444-0000-0000-0000-000000000004'); -- dee
select public.send_friend_request('33333333-0000-0000-0000-000000000003'); -- accepts cai's
select set_config('test.cai_dee', (select conversation_id::text from public.direct_conversations), true);

reset role;
delete from auth.users where id = '44444444-0000-0000-0000-000000000004';
select is(
  (select array[user_low_id::text, coalesce(user_high_id::text, 'null')] from public.direct_conversations
   where conversation_id = current_setting('test.cai_dee')::uuid),
  array['33333333-0000-0000-0000-000000000003', 'null'],
  'deleting an account nulls their side of the pair; the conversation stays direct'
);
select is(
  (select array_agg(user_id) from public.conversation_members
   where conversation_id = current_setting('test.cai_dee')::uuid),
  array['33333333-0000-0000-0000-000000000003']::uuid[],
  '... and removes only their membership'
);

set local role authenticated;
select pg_temp.as_user('33333333-0000-0000-0000-000000000003'); -- cai
select is((select count(*)::int from public.conversations), 1, 'the remaining person keeps the conversation');

reset role;
delete from auth.users where id = '33333333-0000-0000-0000-000000000003';
select ok(
  not exists (select 1 from public.conversations where id = current_setting('test.cai_dee')::uuid),
  'when the last member deletes their account, the conversation is deleted'
);
select ok(
  exists (select 1 from public.conversations where id = current_setting('test.conversation')::uuid),
  '... while conversations with members are untouched'
);
set local role authenticated;

-- Invariant --------------------------------------------------------------------------------------------
reset role;
select is(
  (select count(*)::int from public.friendships f
   where not exists (
     select 1 from public.direct_conversations d
     join public.conversation_members m1 on m1.conversation_id = d.conversation_id and m1.user_id = f.user_low_id
     join public.conversation_members m2 on m2.conversation_id = d.conversation_id and m2.user_id = f.user_high_id
     where d.user_low_id = f.user_low_id and d.user_high_id = f.user_high_id)),
  0,
  'every friendship has a conversation with both friends as members'
);

select * from finish();
rollback;
