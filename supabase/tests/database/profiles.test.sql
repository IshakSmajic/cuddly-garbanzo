begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

-- Fixtures: two users created the way the auth service does it -------------
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'ana@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'ben@example.com');

-- Structure ----------------------------------------------------------------
select has_table('public', 'profiles', 'profiles table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'RLS is enabled on profiles'
);

-- Sign-up trigger ------------------------------------------------------------
select is(
  (select count(*)::int from public.profiles
   where user_id in ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002')),
  2,
  'trigger creates a profile for each new user'
);
select is(
  (select username from public.profiles where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  null,
  'new profiles start without a username'
);

-- Signed-out visitors --------------------------------------------------------
set local role anon;
select throws_ok(
  'select * from public.profiles',
  '42501',
  null,
  'anon cannot read profiles'
);
reset role;

-- Act as Ana -----------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}', true);

select is(
  (select count(*)::int from public.profiles
   where user_id in ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002')),
  2,
  'signed-in users can read other profiles'
);

select lives_ok(
  $$update public.profiles set username = 'ana_1', display_name = 'Ana'
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'user can set their own username and display name'
);

-- Username format
select throws_ok(
  $$update public.profiles set username = 'Ana_1' where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '23514', null, 'uppercase usernames are rejected'
);
select throws_ok(
  $$update public.profiles set username = 'an' where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '23514', null, 'usernames under 3 characters are rejected'
);
select throws_ok(
  $$update public.profiles set username = 'ana-1' where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '23514', null, 'usernames with symbols other than underscore are rejected'
);
select throws_ok(
  $$update public.profiles set username = 'a_very_long_username_x' where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '23514', null, 'usernames over 20 characters are rejected'
);

-- Display name and bio
select throws_ok(
  $$update public.profiles set display_name = '   ' where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '23514', null, 'blank display names are rejected'
);
select throws_ok(
  $$update public.profiles set bio = repeat('x', 281) where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '23514', null, 'bios over 280 characters are rejected'
);

-- Columns users may not change
select throws_ok(
  $$update public.profiles set user_id = gen_random_uuid() where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '42501', null, 'user_id cannot be changed'
);
select throws_ok(
  $$update public.profiles set avatar_path = 'x.png' where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '42501', null, 'avatar_path cannot be set directly (milestone 3 adds a safe path)'
);

-- Rows users may not touch
update public.profiles set display_name = 'Hacked'
  where user_id = 'bbbbbbbb-0000-0000-0000-000000000002';
select throws_ok(
  $$insert into public.profiles (user_id) values (gen_random_uuid())$$,
  '42501', null, 'users cannot insert profiles'
);
select throws_ok(
  $$delete from public.profiles where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '42501', null, 'users cannot delete profiles'
);

-- Act as Ben -----------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}', true);

select throws_ok(
  $$update public.profiles set username = 'ana_1' where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'$$,
  '23505', null, 'usernames are unique'
);

reset role;

-- Check results as the database owner ---------------------------------------
select is(
  (select display_name from public.profiles where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  null,
  'a user cannot edit someone else''s profile'
);
select is(
  (select username from public.profiles where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'ana_1',
  'own profile update was saved'
);

select * from finish();
rollback;
