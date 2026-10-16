begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

-- Milestone 6 created a new public.messages; the demo's global room (no
-- conversation, no client_id, one index on created_at) must not be what's there.
select has_column('public', 'messages', 'conversation_id', 'messages is the milestone 6 table, not the demo''s global room');
select hasnt_index('public', 'messages', 'messages_created_at_idx', 'the demo''s index is gone');
select is(
  (select count(*)::int from auth.users where email in ('alice@test.com', 'bob@test.com')),
  0,
  'demo test accounts are deleted'
);

select * from finish();
rollback;
