begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

-- Fixtures -------------------------------------------------------------------
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'ana@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'ben@example.com');

-- Direct SQL deletes from storage.objects are blocked unless this is set (the
-- storage server deletes through its own role). Set it so the delete policy
-- itself is what's being tested.
select set_config('storage.allow_delete_query', 'true', true);

-- Bucket -------------------------------------------------------------------------
select ok((select public from storage.buckets where id = 'avatars'), 'avatars bucket exists and is public');
select is((select file_size_limit from storage.buckets where id = 'avatars'), 2097152::bigint, 'bucket limit is 2 MB');
select is(
  (select allowed_mime_types from storage.buckets where id = 'avatars'),
  array['image/jpeg', 'image/png', 'image/webp'],
  'bucket accepts only JPEG, PNG and WebP'
);

-- Act as Ben: one file in his own folder ------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}', true);
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id) values
    ('avatars', 'bbbbbbbb-0000-0000-0000-000000000002/22222222-2222-2222-2222-222222222222.webp',
     'bbbbbbbb-0000-0000-0000-000000000002')$$,
  'user can upload into their own folder'
);

-- Act as Ana ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}', true);

select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id) values
    ('avatars', 'aaaaaaaa-0000-0000-0000-000000000001/11111111-1111-1111-1111-111111111111.webp',
     'aaaaaaaa-0000-0000-0000-000000000001'),
    ('avatars', 'aaaaaaaa-0000-0000-0000-000000000001/11111111-1111-1111-1111-11111111aaaa.jpg',
     'aaaaaaaa-0000-0000-0000-000000000001')$$,
  'Ana uploads two files into her own folder'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id) values
    ('avatars', 'bbbbbbbb-0000-0000-0000-000000000002/33333333-3333-3333-3333-333333333333.webp',
     'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'user cannot upload into another user''s folder'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id) values
    ('avatars', '44444444-4444-4444-4444-444444444444.webp', 'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'user cannot upload outside a folder'
);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'avatars'),
  2,
  'user can list only their own files'
);

-- Ben's file survives Ana's attempts (RLS filters the rows, so 0 rows change).
delete from storage.objects
  where name = 'bbbbbbbb-0000-0000-0000-000000000002/22222222-2222-2222-2222-222222222222.webp';
update storage.objects set name = 'aaaaaaaa-0000-0000-0000-000000000001/stolen.webp'
  where name = 'bbbbbbbb-0000-0000-0000-000000000002/22222222-2222-2222-2222-222222222222.webp';

-- set_avatar -----------------------------------------------------------------------
select is(
  public.set_avatar('aaaaaaaa-0000-0000-0000-000000000001/11111111-1111-1111-1111-111111111111.webp'),
  null,
  'set_avatar accepts an uploaded file in your folder and returns the previous path (none)'
);
select is(
  (select avatar_path from public.profiles where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'aaaaaaaa-0000-0000-0000-000000000001/11111111-1111-1111-1111-111111111111.webp',
  'set_avatar stores the path'
);
select throws_ok(
  $$select public.set_avatar('bbbbbbbb-0000-0000-0000-000000000002/22222222-2222-2222-2222-222222222222.webp')$$,
  '22023',
  null,
  'set_avatar rejects another user''s file'
);
select throws_ok(
  $$select public.set_avatar('aaaaaaaa-0000-0000-0000-000000000001/55555555-5555-5555-5555-555555555555.webp')$$,
  'P0002',
  null,
  'set_avatar rejects a file that was never uploaded'
);
select throws_ok(
  $$select public.set_avatar('aaaaaaaa-0000-0000-0000-000000000001/../bbbbbbbb-0000-0000-0000-000000000002/x.webp')$$,
  '22023',
  null,
  'set_avatar rejects a malformed path'
);
select throws_ok(
  $$select public.set_avatar('aaaaaaaa-0000-0000-0000-000000000001/11111111-1111-1111-1111-111111111111.gif')$$,
  '22023',
  null,
  'set_avatar rejects other extensions'
);
select throws_ok(
  $$select public.set_avatar(null)$$,
  '22023',
  null,
  'set_avatar rejects null (removing uses remove_avatar)'
);
select is(
  public.set_avatar('aaaaaaaa-0000-0000-0000-000000000001/11111111-1111-1111-1111-11111111aaaa.jpg'),
  'aaaaaaaa-0000-0000-0000-000000000001/11111111-1111-1111-1111-111111111111.webp',
  'replacing returns the old path, so the app can delete that file'
);
select throws_ok(
  $$update public.profiles set avatar_path = 'anything'
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'avatar_path still cannot be updated directly'
);

-- remove_avatar --------------------------------------------------------------------
select is(
  public.remove_avatar(),
  'aaaaaaaa-0000-0000-0000-000000000001/11111111-1111-1111-1111-11111111aaaa.jpg',
  'remove_avatar returns the old path'
);
select is(
  (select avatar_path from public.profiles where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  null,
  'remove_avatar clears the path'
);
select is(public.remove_avatar(), null, 'remove_avatar with no avatar is a harmless no-op');

-- Deleting your own file works (checked as the owner below).
delete from storage.objects
  where name = 'aaaaaaaa-0000-0000-0000-000000000001/11111111-1111-1111-1111-111111111111.webp';

-- Signed-out visitors ------------------------------------------------------------------
reset role;
set local role anon;
select throws_ok(
  $$select public.set_avatar('aaaaaaaa-0000-0000-0000-000000000001/11111111-1111-1111-1111-111111111111.webp')$$,
  '42501',
  null,
  'anon cannot call set_avatar'
);
select throws_ok($$select public.remove_avatar()$$, '42501', null, 'anon cannot call remove_avatar');

-- Back as the owner: check what Ana's attempts did to Ben's file ---------------------------
reset role;
select is(
  (select owner_id from storage.objects
   where name = 'bbbbbbbb-0000-0000-0000-000000000002/22222222-2222-2222-2222-222222222222.webp'),
  'bbbbbbbb-0000-0000-0000-000000000002',
  'another user''s file cannot be deleted, renamed or moved'
);

select ok(
  not exists (select 1 from storage.objects
              where name = 'aaaaaaaa-0000-0000-0000-000000000001/11111111-1111-1111-1111-111111111111.webp'),
  'user can delete their own file'
);

select * from finish();
rollback;
