begin;
create extension if not exists pgtap with schema extensions;

select plan(66);

-- Fixtures -----------------------------------------------------------------------
-- ana, ben, cai and dee are onboarded; nul has no username yet; zzz01–zzz25
-- exist to test the result limit and the request rate limit.
insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-000000000001', 'ana@example.com'),
  ('22222222-0000-0000-0000-000000000002', 'ben@example.com'),
  ('33333333-0000-0000-0000-000000000003', 'cai@example.com'),
  ('44444444-0000-0000-0000-000000000004', 'dee@example.com'),
  ('55555555-0000-0000-0000-000000000005', 'nul@example.com');
insert into auth.users (id, email)
  select ('99999999-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid, 'zzz' || i || '@example.com'
  from generate_series(1, 25) i;

update public.profiles set username = 'pgt_ana_one' where user_id = '11111111-0000-0000-0000-000000000001';
update public.profiles set username = 'ben' where user_id = '22222222-0000-0000-0000-000000000002';
update public.profiles set username = 'cai' where user_id = '33333333-0000-0000-0000-000000000003';
-- Matches "pgt_ana_" only if the underscore is treated as a wildcard.
update public.profiles set username = 'pgt_anaxdee' where user_id = '44444444-0000-0000-0000-000000000004';
update public.profiles set username = 'zzz' || lpad(right(user_id::text, 2), 2, '0')
  where user_id::text like '99999999-%';

-- Switch the signed-in user (role authenticated must already be set).
create function pg_temp.as_user(id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', id, 'role', 'authenticated')::text, true);
$$;

-- Clients can only read -------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana

select throws_ok(
  $$insert into public.friend_requests (requester_id, recipient_id)
    values ('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002')$$,
  '42501', null, 'clients cannot insert friend requests directly'
);
select throws_ok(
  $$update public.friend_requests set status = 'accepted'$$,
  '42501', null, 'clients cannot update friend requests directly'
);
select throws_ok(
  $$insert into public.friendships (user_low_id, user_high_id)
    values ('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002')$$,
  '42501', null, 'clients cannot insert friendships directly'
);
select throws_ok(
  $$insert into public.blocks (blocker_id, blocked_id)
    values ('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002')$$,
  '42501', null, 'clients cannot insert blocks directly'
);
select throws_ok($$select * from public.search_events$$, '42501', null, 'clients cannot read search events');
select throws_ok(
  $$select private.lock_pair('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002')$$,
  '42501', null, 'clients cannot call the private helpers'
);

-- Constraints (as the owner, bypassing the functions) ------------------------------------
reset role;
select throws_ok(
  $$insert into public.friendships (user_low_id, user_high_id)
    values ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001')$$,
  '23514', null, 'a friendship must store the lower id first (no reversed duplicates)'
);
select throws_ok(
  $$insert into public.friend_requests (requester_id, recipient_id, status)
    values ('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', 'accepted')$$,
  '23514', null, 'an answered request must have responded_at'
);
select throws_ok(
  $$insert into public.friend_requests (requester_id, recipient_id) values
    ('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002'),
    ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001')$$,
  '23505', null, 'at most one pending request per pair, in either direction'
);
select throws_ok(
  $$insert into public.friend_requests (requester_id, recipient_id)
    values ('11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001')$$,
  '23514', null, 'a request to yourself is impossible'
);

-- Signed-out visitors ---------------------------------------------------------------------
set local role anon;
select throws_ok(
  $$select public.send_friend_request('22222222-0000-0000-0000-000000000002')$$,
  '42501', null, 'anon cannot send requests'
);
select throws_ok($$select * from public.search_users('ben')$$, '42501', null, 'anon cannot search');

-- Sending --------------------------------------------------------------------------------
reset role;
set local role authenticated;

select pg_temp.as_user('55555555-0000-0000-0000-000000000005'); -- nul
select throws_ok(
  $$select public.send_friend_request('22222222-0000-0000-0000-000000000002')$$,
  '42501', null, 'a user without a username cannot send requests'
);

select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana
select throws_ok(
  $$select public.send_friend_request('11111111-0000-0000-0000-000000000001')$$,
  '22023', null, 'you cannot send a request to yourself'
);
select throws_ok(
  $$select public.send_friend_request('55555555-0000-0000-0000-000000000005')$$,
  '22023', null, 'you cannot send a request to someone without a username'
);
select is(
  public.send_friend_request('22222222-0000-0000-0000-000000000002'), 'pending',
  'ana sends ben a request'
);
select is(
  public.send_friend_request('22222222-0000-0000-0000-000000000002'), 'pending',
  'sending the same request again is harmless'
);
select is(
  (select count(*)::int from public.friend_requests where status = 'pending'), 1,
  '... and leaves a single pending request'
);
select is(
  (select relation from public.relationship_with('22222222-0000-0000-0000-000000000002')), 'outgoing',
  'for ana the request is outgoing'
);

select pg_temp.as_user('22222222-0000-0000-0000-000000000002'); -- ben
select is(
  (select relation from public.relationship_with('11111111-0000-0000-0000-000000000001')), 'incoming',
  'for ben the request is incoming'
);

select pg_temp.as_user('33333333-0000-0000-0000-000000000003'); -- cai
select is((select count(*)::int from public.friend_requests), 0, 'other users cannot see the request');

select pg_temp.as_user('22222222-0000-0000-0000-000000000002'); -- ben
select is(
  public.send_friend_request('11111111-0000-0000-0000-000000000001'), 'friends',
  'sending back to someone who already asked accepts their request'
);
select is(
  (select status from public.friend_requests
   where requester_id = '11111111-0000-0000-0000-000000000001' and responded_at is not null),
  'accepted',
  '... marking it accepted, with a response time'
);
select is((select count(*)::int from public.friendships), 1, '... and creating the friendship');

select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana
select is(
  (select relation from public.relationship_with('22222222-0000-0000-0000-000000000002')), 'friends',
  'they are now friends'
);
select throws_ok(
  $$select public.send_friend_request('22222222-0000-0000-0000-000000000002')$$,
  'TB002', null, 'friends cannot send each other requests'
);

-- Answering and cancelling ------------------------------------------------------------------
select is(
  public.send_friend_request('33333333-0000-0000-0000-000000000003'), 'pending',
  'ana sends cai a request'
);
select set_config('test.request', (select id::text from public.friend_requests where status = 'pending'), true);

select pg_temp.as_user('22222222-0000-0000-0000-000000000002'); -- ben
select throws_ok(
  $$select public.respond_to_friend_request(current_setting('test.request')::uuid, true)$$,
  '42501', null, 'someone else cannot answer the request'
);

select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana
select throws_ok(
  $$select public.respond_to_friend_request(current_setting('test.request')::uuid, true)$$,
  '42501', null, 'the requester cannot answer their own request'
);

select pg_temp.as_user('33333333-0000-0000-0000-000000000003'); -- cai
select throws_ok(
  $$select public.respond_to_friend_request(current_setting('test.request')::uuid, null)$$,
  '22023', null, 'the answer must be accept or decline'
);
select is(
  public.respond_to_friend_request(current_setting('test.request')::uuid, false), 'declined',
  'the recipient declines'
);
select throws_ok(
  $$select public.respond_to_friend_request(current_setting('test.request')::uuid, true)$$,
  'TB003', null, 'a declined request cannot be accepted afterwards'
);

select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana
select throws_ok(
  $$select public.send_friend_request('33333333-0000-0000-0000-000000000003')$$,
  'TB005', null, 'after a decline, the requester must wait 24 hours to ask again'
);

select pg_temp.as_user('33333333-0000-0000-0000-000000000003'); -- cai
select is(
  public.send_friend_request('11111111-0000-0000-0000-000000000001'), 'pending',
  'the one who declined may still send a request the other way'
);
select set_config('test.request', (select id::text from public.friend_requests where status = 'pending'), true);

select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana
select throws_ok(
  $$select public.cancel_friend_request(current_setting('test.request')::uuid)$$,
  '42501', null, 'the recipient cannot cancel a request'
);

select pg_temp.as_user('33333333-0000-0000-0000-000000000003'); -- cai
select lives_ok(
  $$select public.cancel_friend_request(current_setting('test.request')::uuid)$$,
  'the requester cancels'
);
select is(
  (select status from public.friend_requests where id = current_setting('test.request')::uuid), 'cancelled',
  '... and the request is cancelled'
);
select throws_ok(
  $$select public.cancel_friend_request(current_setting('test.request')::uuid)$$,
  'TB003', null, 'a cancelled request cannot be cancelled again'
);

-- Blocking ------------------------------------------------------------------------------------
select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana
select is(
  public.send_friend_request('44444444-0000-0000-0000-000000000004'), 'pending',
  'ana sends dee a request'
);

select pg_temp.as_user('44444444-0000-0000-0000-000000000004'); -- dee
select lives_ok($$select public.block_user('11111111-0000-0000-0000-000000000001')$$, 'dee blocks ana');
select lives_ok($$select public.block_user('11111111-0000-0000-0000-000000000001')$$, 'blocking twice is harmless');
select throws_ok(
  $$select public.block_user('44444444-0000-0000-0000-000000000004')$$,
  '22023', null, 'you cannot block yourself'
);
select is(
  (select relation from public.relationship_with('11111111-0000-0000-0000-000000000001')), 'blocked',
  'for dee, ana is blocked'
);
select is((select count(*)::int from public.blocks), 1, 'the blocker sees their block');
select throws_ok(
  $$select public.send_friend_request('11111111-0000-0000-0000-000000000001')$$,
  'TB001', null, 'the blocker cannot send requests to the blocked user'
);

select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana
select is(
  (select status from public.friend_requests where recipient_id = '44444444-0000-0000-0000-000000000004'),
  'cancelled',
  'blocking cancels the pending request'
);
select throws_ok(
  $$select public.send_friend_request('44444444-0000-0000-0000-000000000004')$$,
  'TB001', null, 'the blocked user cannot send requests to the blocker'
);
select is((select count(*)::int from public.blocks), 0, 'the blocked user cannot see the block');
select is(
  (select relation from public.relationship_with('44444444-0000-0000-0000-000000000004')), 'none',
  'relationship_with does not reveal being blocked'
);

select pg_temp.as_user('22222222-0000-0000-0000-000000000002'); -- ben
select lives_ok($$select public.block_user('11111111-0000-0000-0000-000000000001')$$, 'ben blocks his friend ana');
select is((select count(*)::int from public.friendships), 0, 'blocking ends the friendship');
select lives_ok($$select public.unblock_user('11111111-0000-0000-0000-000000000001')$$, 'ben unblocks ana');
select is(
  (select relation from public.relationship_with('11111111-0000-0000-0000-000000000001')), 'none',
  'unblocking does not bring the friendship back'
);

-- Search ---------------------------------------------------------------------------------------
select pg_temp.as_user('33333333-0000-0000-0000-000000000003'); -- cai
select throws_ok($$select * from public.search_users('an')$$, '22023', null, 'search needs at least 3 characters');
select throws_ok($$select * from public.search_users('an%')$$, '22023', null, 'search rejects LIKE wildcards');
select is(
  (select array_agg(username order by username) from public.search_users('pgt_ana')),
  array['pgt_ana_one', 'pgt_anaxdee'],
  'search matches username prefixes'
);
select is(
  (select array_agg(username) from public.search_users('pgt_ana_')),
  array['pgt_ana_one'],
  'an underscore matches only an underscore, not any character'
);
select is(
  (select array_agg(username) from public.search_users('  PGT_ANA_ONE ')),
  array['pgt_ana_one'],
  'search ignores case and surrounding spaces'
);
select is((select count(*)::int from public.search_users('zzz')), 20, 'search returns at most 20 results');

select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana
select is(
  (select count(*)::int from public.search_users('pgt_ana')), 0,
  'search excludes yourself and anyone who blocked you'
);

select pg_temp.as_user('44444444-0000-0000-0000-000000000004'); -- dee
select is(
  (select relation from public.search_users('pgt_ana_one')), 'blocked',
  'people you blocked still appear, marked blocked, so you can unblock them'
);

select pg_temp.as_user('55555555-0000-0000-0000-000000000005'); -- nul
select throws_ok($$select * from public.search_users('ben')$$, '42501', null, 'a user without a username cannot search');

-- Rate limits -------------------------------------------------------------------------------------
reset role;
insert into public.search_events (user_id)
  select '33333333-0000-0000-0000-000000000003' from generate_series(1, 30);
insert into public.search_events (user_id, created_at)
  select '22222222-0000-0000-0000-000000000002', now() - interval '2 minutes' from generate_series(1, 5);
insert into public.friend_requests (requester_id, recipient_id, status, responded_at)
  select '33333333-0000-0000-0000-000000000003', p.user_id, 'cancelled', now()
  from public.profiles p where p.username like 'zzz%' limit 20;

set local role authenticated;
select pg_temp.as_user('33333333-0000-0000-0000-000000000003'); -- cai
select throws_ok($$select * from public.search_users('ben')$$, 'TB004', null, 'more than 30 searches a minute are refused');
select throws_ok(
  $$select public.send_friend_request('22222222-0000-0000-0000-000000000002')$$,
  'TB004', null, 'more than 20 requests an hour are refused'
);

select pg_temp.as_user('22222222-0000-0000-0000-000000000002'); -- ben
select lives_ok($$select * from public.search_users('cai')$$, 'searches older than a minute do not count');
reset role;
select is(
  (select count(*)::int from public.search_events where user_id = '22222222-0000-0000-0000-000000000002'), 1,
  '... and are pruned'
);

select * from finish();
rollback;
