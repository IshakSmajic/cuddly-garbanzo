begin;
create extension if not exists pgtap with schema extensions;

select plan(37);

-- Fixtures -----------------------------------------------------------------------
-- ana and ben are friends; cai is friends with nobody; dee is ana's friend
-- until ana unfriends her below.
insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-000000000001', 'ana@example.com'),
  ('22222222-0000-0000-0000-000000000002', 'ben@example.com'),
  ('33333333-0000-0000-0000-000000000003', 'cai@example.com'),
  ('44444444-0000-0000-0000-000000000004', 'dee@example.com');
update public.profiles set username = 'pgt_' || split_part(u.email, '@', 1)
  from auth.users u
  where u.id = profiles.user_id
    and u.id in ('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002',
                 '33333333-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000004');
select private.make_friends('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002');
select private.make_friends('11111111-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000004');
select set_config('test.ab', (select conversation_id::text from public.direct_conversations
  where user_high_id = '22222222-0000-0000-0000-000000000002'), true);
select set_config('test.ad', (select conversation_id::text from public.direct_conversations
  where user_high_id = '44444444-0000-0000-0000-000000000004'), true);

-- Direct SQL deletes from storage.objects are blocked unless this is set (the
-- storage server deletes through its own role), so the delete policy itself
-- is what's tested.
select set_config('storage.allow_delete_query', 'true', true);

create function pg_temp.as_user(id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', id, 'role', 'authenticated')::text, true);
$$;
-- A path in a conversation's folder, the way the app names files.
create function pg_temp.img(conversation text, file text, ext text default 'webp') returns text language sql as $$
  select conversation || '/' || file || '.' || ext;
$$;
-- An upload as the current user, with the metadata the storage server records.
create function pg_temp.upload(path text, mime text default 'image/webp', bytes int default 1000)
returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('message-images', path, current_setting('request.jwt.claims')::json ->> 'sub',
          jsonb_build_object('mimetype', mime, 'size', bytes));
$$;
create function pg_temp.send(conversation text, client uuid, path text, caption text default null)
returns public.messages language sql as $$
  select public.send_image_message(conversation::uuid, client, path, 800, 600, caption);
$$;

-- Bucket ---------------------------------------------------------------------------
select ok(not (select public from storage.buckets where id = 'message-images'), 'message-images bucket is private');
select is((select file_size_limit from storage.buckets where id = 'message-images'), 5242880::bigint, 'bucket limit is 5 MB');
select is(
  (select allowed_mime_types from storage.buckets where id = 'message-images'),
  array['image/jpeg', 'image/webp'],
  'bucket accepts only JPEG and WebP'
);

-- Uploading -------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana

select lives_ok(
  $$select pg_temp.upload(pg_temp.img(current_setting('test.ab'), 'a0000000-0000-0000-0000-000000000001'))$$,
  'a friend can upload into the conversation''s folder'
);
select lives_ok(
  $$select pg_temp.upload(pg_temp.img(current_setting('test.ab'), 'a0000000-0000-0000-0000-000000000002'));
    select pg_temp.upload(pg_temp.img(current_setting('test.ab'), 'a0000000-0000-0000-0000-000000000003'), 'image/jpeg');
    select pg_temp.upload(pg_temp.img(current_setting('test.ab'), 'a0000000-0000-0000-0000-000000000004'));
    select pg_temp.upload(pg_temp.img(current_setting('test.ad'), 'a0000000-0000-0000-0000-000000000005'));
    select pg_temp.upload(pg_temp.img(current_setting('test.ad'), 'a0000000-0000-0000-0000-000000000006'));
    select pg_temp.upload(pg_temp.img(current_setting('test.ab'), 'a0000000-0000-0000-0000-000000000007'))$$,
  '... and more files for the tests below'
);
select throws_ok(
  $$select pg_temp.upload(current_setting('test.ab') || '/holiday.webp')$$,
  '42501', null, 'a file name that isn''t a uuid is refused'
);
select throws_ok(
  $$select pg_temp.upload(pg_temp.img(current_setting('test.ab'), 'a0000000-0000-0000-0000-0000000000ff', 'png'))$$,
  '42501', null, 'an extension other than jpg or webp is refused'
);
select throws_ok(
  $$select pg_temp.upload('a0000000-0000-0000-0000-0000000000fe.webp')$$,
  '42501', null, 'a file outside a conversation folder is refused'
);

select pg_temp.as_user('22222222-0000-0000-0000-000000000002'); -- ben
select pg_temp.upload(pg_temp.img(current_setting('test.ab'), 'b0000000-0000-0000-0000-000000000001'));
select is(
  (select count(*)::int from storage.objects where bucket_id = 'message-images'),
  6,
  'a member sees every file in their conversation (5 of ana''s, 1 own), none from others'
);

select pg_temp.as_user('33333333-0000-0000-0000-000000000003'); -- cai
select throws_ok(
  $$select pg_temp.upload(pg_temp.img(current_setting('test.ab'), 'c0000000-0000-0000-0000-000000000001'))$$,
  '42501', null, 'an outsider cannot upload into someone else''s conversation'
);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'message-images'),
  0,
  'an outsider sees none of the conversation''s files'
);

-- Sending -----------------------------------------------------------------------------
select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana

select lives_ok(
  $$select pg_temp.send(current_setting('test.ab'), 'ce000000-0000-0000-0000-000000000001',
      pg_temp.img(current_setting('test.ab'), 'a0000000-0000-0000-0000-000000000001'), 'Look')$$,
  'a friend can send an uploaded image with a caption'
);
select results_eq(
  $$select m.sender_id, m.content, a.mime_type, a.size_bytes, a.width, a.height
    from public.messages m join public.message_attachments a on a.message_id = m.id
    where m.client_id = 'ce000000-0000-0000-0000-000000000001'$$,
  $$values ('11111111-0000-0000-0000-000000000001'::uuid, 'Look'::text, 'image/webp'::text, 1000, 800, 600)$$,
  'the message and its attachment are stored; type and size come from Storage'
);
select is(
  (pg_temp.send(current_setting('test.ab'), 'ce000000-0000-0000-0000-000000000001',
     pg_temp.img(current_setting('test.ab'), 'a0000000-0000-0000-0000-000000000001'), 'Look')).id,
  (select id from public.messages where client_id = 'ce000000-0000-0000-0000-000000000001'),
  'a retry with the same client_id returns the stored message'
);
select is((select count(*)::int from public.messages), 1, '... and creates no duplicate');
select throws_ok(
  $$select pg_temp.send(current_setting('test.ab'), gen_random_uuid(),
      pg_temp.img(current_setting('test.ab'), 'a0000000-0000-0000-0000-000000000001'))$$,
  '22023', 'Image already sent', 'a file can belong to only one message'
);
select throws_ok(
  $$select pg_temp.send(current_setting('test.ab'), gen_random_uuid(),
      pg_temp.img(current_setting('test.ad'), 'a0000000-0000-0000-0000-000000000005'))$$,
  '22023', 'Invalid image path', 'a file from another conversation cannot be attached'
);
select throws_ok(
  $$select pg_temp.send(current_setting('test.ab'), gen_random_uuid(),
      pg_temp.img(current_setting('test.ab'), 'a0000000-0000-0000-0000-0000000000aa'))$$,
  '22023', 'Image file not found', 'a file that was never uploaded cannot be attached'
);
select throws_ok(
  $$select pg_temp.send(current_setting('test.ab'), gen_random_uuid(),
      pg_temp.img(current_setting('test.ab'), 'b0000000-0000-0000-0000-000000000001'))$$,
  '22023', 'Image file not found', 'someone else''s upload cannot be attached'
);
select throws_ok(
  $$select pg_temp.send(current_setting('test.ab'), gen_random_uuid(),
      pg_temp.img(current_setting('test.ab'), 'a0000000-0000-0000-0000-000000000003'))$$,
  '22023', 'Image type does not match its name', 'the stored type must match the extension'
);
select throws_ok(
  $$select pg_temp.send(current_setting('test.ab'), gen_random_uuid(),
      pg_temp.img(current_setting('test.ab'), 'a0000000-0000-0000-0000-000000000002'), '   ')$$,
  '23514', null, 'a caption follows the text rules'
);
select throws_ok(
  $$select public.send_image_message(current_setting('test.ab')::uuid, gen_random_uuid(),
      pg_temp.img(current_setting('test.ab'), 'a0000000-0000-0000-0000-000000000002'), 0, 600)$$,
  '23514', null, 'the size hint must be a real size'
);
select is(
  (select count(*)::int from public.messages),
  1,
  'a failed attachment insert rolls back its message too'
);
select is(
  (pg_temp.send(current_setting('test.ab'), 'ce000000-0000-0000-0000-000000000002',
     pg_temp.img(current_setting('test.ab'), 'a0000000-0000-0000-0000-000000000002'), '')).content,
  null,
  'an image needs no caption (an empty one is stored as none)'
);
select throws_ok(
  $$insert into public.messages (conversation_id, client_id) values (current_setting('test.ab')::uuid, gen_random_uuid())$$,
  '42501', null, 'a message without text cannot be inserted directly'
);
select throws_ok(
  $$insert into public.message_attachments (message_id, storage_path, mime_type, size_bytes, width, height)
    values ((select id from public.messages limit 1), 'x', 'image/webp', 1, 1, 1)$$,
  '42501', null, 'clients cannot write attachments directly'
);

-- Reading ------------------------------------------------------------------------------
select pg_temp.as_user('22222222-0000-0000-0000-000000000002'); -- ben
select is((select count(*)::int from public.message_attachments), 2, 'the other member sees the attachments');

select pg_temp.as_user('33333333-0000-0000-0000-000000000003'); -- cai
select is((select count(*)::int from public.message_attachments), 0, 'an outsider sees no attachments');

-- Deleting -----------------------------------------------------------------------------
select pg_temp.as_user('22222222-0000-0000-0000-000000000002'); -- ben
delete from storage.objects where name = pg_temp.img(current_setting('test.ab'), 'a0000000-0000-0000-0000-000000000004');
select is(
  (select count(*)::int from storage.objects where name = pg_temp.img(current_setting('test.ab'), 'a0000000-0000-0000-0000-000000000004')),
  1,
  'a member cannot delete someone else''s upload'
);

select pg_temp.as_user('11111111-0000-0000-0000-000000000001'); -- ana
delete from storage.objects where name = pg_temp.img(current_setting('test.ab'), 'a0000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from storage.objects where name = pg_temp.img(current_setting('test.ab'), 'a0000000-0000-0000-0000-000000000001')),
  1,
  'a sent image cannot be deleted, even by its sender'
);
delete from storage.objects where name = pg_temp.img(current_setting('test.ab'), 'a0000000-0000-0000-0000-000000000004');
select is(
  (select count(*)::int from storage.objects where name = pg_temp.img(current_setting('test.ab'), 'a0000000-0000-0000-0000-000000000004')),
  0,
  'the uploader can delete an image that was never sent'
);

-- After unfriending ---------------------------------------------------------------------
select pg_temp.send(current_setting('test.ad'), 'ce000000-0000-0000-0000-000000000003',
  pg_temp.img(current_setting('test.ad'), 'a0000000-0000-0000-0000-000000000005'));
select public.unfriend('44444444-0000-0000-0000-000000000004');

select throws_ok(
  $$select pg_temp.upload(pg_temp.img(current_setting('test.ad'), 'a0000000-0000-0000-0000-000000000009'))$$,
  '42501', null, 'after unfriending, uploading is refused'
);
select throws_ok(
  $$select pg_temp.send(current_setting('test.ad'), gen_random_uuid(),
      pg_temp.img(current_setting('test.ad'), 'a0000000-0000-0000-0000-000000000006'))$$,
  '42501', null, '... and so is sending a file uploaded before'
);

select pg_temp.as_user('44444444-0000-0000-0000-000000000004'); -- dee
select is(
  (select count(*)::int from public.message_attachments a join storage.objects o on o.name = a.storage_path),
  1,
  'the former friend still sees the image they were sent, and can read its file'
);

-- Signed out --------------------------------------------------------------------------------
reset role;
set local role anon;
select throws_ok(
  'select count(*) from public.message_attachments',
  '42501', null, 'signed-out visitors cannot read attachments'
);

-- Account deletion -----------------------------------------------------------------------------
reset role;
delete from auth.users where id = '22222222-0000-0000-0000-000000000002'; -- ben
select is(
  (select count(*)::int from public.message_attachments a join public.messages m on m.id = a.message_id
   where m.conversation_id = current_setting('test.ab')::uuid),
  2,
  'when one person deletes their account, the other keeps the images'
);
delete from auth.users where id = '11111111-0000-0000-0000-000000000001'; -- ana
select is(
  (select count(*)::int from public.message_attachments a join public.messages m on m.id = a.message_id
   where m.conversation_id = current_setting('test.ab')::uuid),
  0,
  'when both accounts are gone, the conversation''s attachments go with it'
);

select * from finish();
rollback;
