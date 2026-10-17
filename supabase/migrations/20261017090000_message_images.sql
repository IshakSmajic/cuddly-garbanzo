-- Milestone 9: image messages (spec sections 2, 5 and 7).
--
-- Files live in a private Storage bucket; message_attachments points at them.
-- Storage and Postgres don't share a transaction, so the app uploads the file
-- first and then calls send_image_message, which creates the message and its
-- attachment together (see src/lib/imageUpload.ts). One image per message for
-- now; the function enforces that, not the table, so more can come later.

-- Bucket ---------------------------------------------------------------------
-- Private, unlike avatars: files are read through the API (RLS below) or
-- through short-lived signed URLs, never through a public URL. The app always
-- re-encodes to WebP or JPEG, at most 2048 px, so 5 MB is generous. The type
-- is the one the client reports; send_image_message checks it again.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('message-images', 'message-images', false, 5 * 1024 * 1024, array['image/jpeg', 'image/webp']);

-- Paths are {conversation_id}/{random uuid}.{ext}: the folder says which
-- conversation a file belongs to. Null for anything else, so a malformed name
-- can't make the uuid cast fail inside a policy.
create function private.image_conversation(name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|webp)$'
    then split_part(name, '/', 1)::uuid
  end;
$$;

-- Attachment table ---------------------------------------------------------------
-- width and height aren't in the spec's table: they let the chat reserve an
-- image's space before it loads, so the view doesn't jump. They come from the
-- client and are only a layout hint. mime_type and size_bytes come from
-- Storage's own record of the file (see send_image_message).

create table public.message_attachments (
  id bigint generated always as identity primary key,
  -- Attachments live and die with their message (and so with the conversation).
  message_id bigint not null references public.messages (id) on delete cascade,
  storage_path text not null constraint message_attachments_path unique,
  mime_type text not null
    constraint message_attachments_type check (mime_type in ('image/jpeg', 'image/webp')),
  size_bytes integer not null
    constraint message_attachments_size check (size_bytes between 1 and 5 * 1024 * 1024),
  width integer not null constraint message_attachments_width check (width between 1 and 4096),
  height integer not null constraint message_attachments_height check (height between 1 and 4096),
  created_at timestamptz not null default now()
);

create index message_attachments_message on public.message_attachments (message_id);

-- Read-only to clients; send_image_message is the only way in.
revoke all on public.message_attachments from anon, authenticated;
grant select on public.message_attachments to authenticated;

alter table public.message_attachments enable row level security;

-- The subquery runs under the messages policy, so it finds the message only
-- if you're a member of its conversation.
create policy "Members see their conversation's attachments"
  on public.message_attachments for select
  to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id));

-- Whether a file is in use. Security definer so the answer doesn't depend on
-- what the caller can read (used by the delete policy below).
create function private.image_attached(path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.message_attachments a where a.storage_path = path);
$$;

grant execute on function private.image_conversation(text), private.image_attached(text) to authenticated;

-- Storage policies -------------------------------------------------------------
-- Same rules as text: reading needs membership (former friends keep their
-- history), uploading needs a current friendship. No update policy: files are
-- never overwritten.

create policy "Members read their conversation's images"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'message-images'
    and private.is_conversation_member(private.image_conversation(name))
  );

create policy "Friends upload images into their conversation"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'message-images'
    and private.can_send_in(private.image_conversation(name))
  );

-- Only to clean up after a send that failed: your own file, never one a
-- message uses.
create policy "Users delete their own unsent images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'message-images'
    and owner_id = (select auth.uid())::text
    and not private.image_attached(name)
  );

-- Sending ------------------------------------------------------------------------
-- "Text or at least one attachment" spans two tables, which no CHECK can
-- express, so image messages are only created here, in one transaction. The
-- text insert policy on messages still requires content, so a message
-- without text can't be made any other way.

create function public.send_image_message(
  conversation uuid,
  client_id uuid,
  path text,
  width integer,
  height integer,
  caption text default null
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  file_meta jsonb;
  file_type text;
  expected_type text;
  sent public.messages;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  -- A retry of a send that already went through (only the answer was lost):
  -- return the stored message. By now its file is attached, so the checks
  -- below would refuse it.
  select m.* into sent from public.messages m
  where m.sender_id = uid and m.client_id = send_image_message.client_id;
  if found then
    if sent.conversation_id is distinct from conversation then
      raise exception 'Client id already used' using errcode = '22023';
    end if;
    return sent;
  end if;

  -- The same rule as the text insert policy: a current friendship.
  if not private.can_send_in(conversation) then
    raise exception 'Not allowed to send in this conversation' using errcode = '42501';
  end if;

  if private.image_conversation(path) is distinct from conversation then
    raise exception 'Invalid image path' using errcode = '22023';
  end if;

  select o.metadata into file_meta from storage.objects o
  where o.bucket_id = 'message-images' and o.name = path and o.owner_id = uid::text;
  if not found then
    raise exception 'Image file not found' using errcode = '22023';
  end if;

  -- Trust Storage's record (the bytes it received), not what the app claims.
  file_type := file_meta ->> 'mimetype';
  if path like '%.webp' then
    expected_type := 'image/webp';
  else
    expected_type := 'image/jpeg';
  end if;
  if file_type is distinct from expected_type then
    raise exception 'Image type does not match its name' using errcode = '22023';
  end if;

  if private.image_attached(path) then
    raise exception 'Image already sent' using errcode = '22023';
  end if;

  -- An empty caption is no caption; otherwise the messages_content CHECK
  -- applies, as for text.
  insert into public.messages (conversation_id, sender_id, client_id, content)
  values (conversation, uid, send_image_message.client_id, nullif(caption, ''))
  returning * into sent;

  -- A send racing another one for the same file hits the unique constraint
  -- here, and the whole transaction (message included) rolls back.
  insert into public.message_attachments (message_id, storage_path, mime_type, size_bytes, width, height)
  values (sent.id, path, file_type, (file_meta ->> 'size')::integer, width, height);

  return sent;
end;
$$;

revoke execute on function public.send_image_message(uuid, uuid, text, integer, integer, text) from public, anon;
grant execute on function public.send_image_message(uuid, uuid, text, integer, integer, text) to authenticated;

comment on table public.message_attachments is
  'Images in messages. Created only by send_image_message; files are in the message-images bucket.';
