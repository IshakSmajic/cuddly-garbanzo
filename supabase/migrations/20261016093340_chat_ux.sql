-- Milestone 8: unread counts, read receipts, typing, online status, and
-- read-only switching live.
--
-- Typing and online status use Realtime Broadcast and Presence, which do not
-- go through table RLS. They run on *private channels*, authorized by
-- policies on realtime.messages that look at the channel name
-- (realtime.topic()). RLS is on for that table with no policies so far, so
-- every private channel was closed until now. Two kinds of channel:
--
--   conversation:<id>  members listen; members who are still friends send
--                      (typing). The database also sends "read" and
--                      "relationship" events here.
--   user:<id>          that user and their current friends listen (online
--                      status); only that user announces presence.
--
-- Realtime checks these policies when a client joins a channel.

-- Reading position -------------------------------------------------------------------

alter table public.conversation_members
  add constraint conversation_members_last_read_message
  foreign key (last_read_message_id) references public.messages (id) on delete set null;

-- Moves the caller's reading position forward to `message` (never back, so an
-- old tab can't undo it) and tells the conversation. The event is sent by the
-- database, so nobody can fake a read receipt for someone else.
create function public.mark_read(conversation uuid, message bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  target public.messages;
  current_at timestamptz;
  current_id bigint;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  -- Membership first, so an outsider learns nothing about which messages
  -- exist. Lock your row so two tabs marking at once can't both read the
  -- old position.
  select r.created_at, r.id into current_at, current_id
  from public.conversation_members cm
  left join public.messages r on r.id = cm.last_read_message_id
  where cm.conversation_id = conversation and cm.user_id = uid
  for update of cm;
  if not found then
    raise exception 'Not a member of this conversation' using errcode = '42501';
  end if;

  select * into target from public.messages m where m.id = message and m.conversation_id = conversation;
  if not found then
    raise exception 'Message not found in this conversation' using errcode = '22023';
  end if;

  if current_id is not null and (target.created_at, target.id) <= (current_at, current_id) then
    return; -- already read that far
  end if;

  update public.conversation_members set last_read_message_id = message
  where conversation_id = conversation and user_id = uid;

  perform realtime.send(
    jsonb_build_object('user_id', uid, 'message_id', target.id, 'created_at', target.created_at),
    'read',
    'conversation:' || conversation,
    true
  );
end;
$$;

revoke execute on function public.mark_read(uuid, bigint) from public, anon;
grant execute on function public.mark_read(uuid, bigint) to authenticated;

-- The chat list gains unread counts -------------------------------------------------------
-- (A changed return type means drop and create, not replace.)

drop function public.my_conversations(uuid);

create function public.my_conversations(only_conversation uuid default null)
returns table (
  conversation_id uuid,
  other_id uuid,
  username text,
  display_name text,
  avatar_path text,
  is_friend boolean,
  last_content text,
  last_sender_id uuid,
  last_at timestamptz,
  unread_count integer
)
language sql
stable
set search_path = ''
as $$
  select
    c.id,
    o.user_id,
    o.username,
    o.display_name,
    o.avatar_path,
    exists (
      select 1 from public.friendships f
      where f.user_low_id = d.user_low_id and f.user_high_id = d.user_high_id
    ),
    last.content,
    last.sender_id,
    last.created_at,
    -- Messages not from you after your reading position (a deleted user's
    -- messages have no sender and count too).
    (
      select count(*)::integer from public.messages m
      where m.conversation_id = c.id
        and m.sender_id is distinct from me.user_id
        and (r.id is null or (m.created_at, m.id) > (r.created_at, r.id))
    )
  from public.conversation_members me
  join public.conversations c on c.id = me.conversation_id
  join public.direct_conversations d on d.conversation_id = c.id
  left join public.messages r on r.id = me.last_read_message_id
  left join public.profiles o
    on o.user_id = case when d.user_low_id = me.user_id then d.user_high_id else d.user_low_id end
  left join lateral (
    select m.content, m.sender_id, m.created_at
    from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc, m.id desc
    limit 1
  ) last on true
  where me.user_id = (select auth.uid())
    and (only_conversation is null or c.id = only_conversation)
  order by coalesce(last.created_at, c.created_at) desc;
$$;

revoke execute on function public.my_conversations(uuid) from public, anon;
grant execute on function public.my_conversations(uuid) to authenticated;

-- Channel authorization ------------------------------------------------------------------------

-- The id in a channel name like "conversation:<uuid>", or null when the name
-- has another shape (so a malformed name is simply refused, not an error).
create function private.topic_id(kind text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select case
    when realtime.topic() ~ ('^' || kind || ':[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      then split_part(realtime.topic(), ':', 2)::uuid
  end;
$$;

-- Same rule as the messages insert policy: a member whose friendship with the
-- other person still exists. Runs as the caller (both tables are readable
-- for their own rows), so no security definer is needed.
create function private.can_send_in(conversation uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.direct_conversations d
    join public.friendships f on f.user_low_id = d.user_low_id and f.user_high_id = d.user_high_id
    where d.conversation_id = conversation
      and (select auth.uid()) in (d.user_low_id, d.user_high_id)
  );
$$;

-- Policies run as the subscriber, so these helpers need execute for
-- authenticated (the rest of the private schema stays locked).
grant execute on function
  private.topic_id(text),
  private.can_send_in(uuid),
  private.are_friends(uuid, uuid)
to authenticated;

create policy "Members listen to their conversation"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and private.is_conversation_member(private.topic_id('conversation'))
  );

create policy "Friends broadcast in their conversation"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and private.can_send_in(private.topic_id('conversation'))
  );

create policy "Friends see each other's presence"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension = 'presence'
    and (
      private.topic_id('user') = (select auth.uid())
      or private.are_friends((select auth.uid()), private.topic_id('user'))
    )
  );

create policy "Users announce only their own presence"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and private.topic_id('user') = (select auth.uid())
  );

-- Read-only, live ---------------------------------------------------------------------------------
-- Whenever a friendship starts or ends (accept, unfriend, block, account
-- deletion), tell the pair's conversation, so an open chat switches between
-- read-only and writable at once. friendships itself can't be published
-- (its deletes would leak who unfriended whom); this event carries nothing.

create function private.announce_friendship_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pair public.friendships := coalesce(new, old);
  conversation uuid;
begin
  select d.conversation_id into conversation from public.direct_conversations d
  where d.user_low_id = pair.user_low_id and d.user_high_id = pair.user_high_id;
  -- A first friendship has no conversation yet at this point; nobody can
  -- have it open.
  if found then
    perform realtime.send('{}'::jsonb, 'relationship', 'conversation:' || conversation, true);
  end if;
  return null;
end;
$$;

create trigger friendships_announce
  after insert or delete on public.friendships
  for each row execute function private.announce_friendship_change();
