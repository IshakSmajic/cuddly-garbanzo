begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

select hasnt_table('public', 'messages', 'demo messages table is gone');
select hasnt_table('public', 'profiles', 'demo profiles table is gone');
select is(
  (select count(*)::int from auth.users where email in ('alice@test.com', 'bob@test.com')),
  0,
  'demo test accounts are deleted'
);

select * from finish();
rollback;
