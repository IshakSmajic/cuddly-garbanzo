-- Milestone 5: friendships get their direct conversation (spec sections 3
-- and 5). Accepting a request now also creates the pair's conversation, in
-- the same transaction; re-friending reuses it. Unfriending deletes only the
-- friendship, so history stays readable (sending is checked separately in
-- milestone 6). Messages themselves arrive in milestone 6.

-- Tables -------------------------------------------------------------------------

-- No type column: a conversation is direct exactly when it has a
-- direct_conversations row. Groups would get their own table later.
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- Each pair once, lower id first: UNIQUE makes a second conversation for the
-- same pair impossible. Deleting an account sets that side to null instead of
-- removing the row, so the other person's conversation stays recognisably
-- direct and can show "Deleted user" (decided 16 Oct 2026). Nulls pass both
-- the CHECK and the UNIQUE constraint.
create table public.direct_conversations (
  conversation_id uuid primary key references public.conversations (id) on delete cascade,
  user_low_id uuid references public.profiles (user_id) on delete set null,
  user_high_id uuid references public.profiles (user_id) on delete set null,
  constraint direct_conversations_pair unique (user_low_id, user_high_id),
  constraint direct_conversations_ordered check (user_low_id < user_high_id)
);

-- The UNIQUE index serves lookups by user_low_id; this serves the other side.
create index direct_conversations_high on public.direct_conversations (user_high_id);

-- Reading a conversation requires a membership row. Unfriending and blocking
-- never delete these; deleting an account removes only that user's row.
create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  joined_at timestamptz not null default now(),
  -- Reserved for unread counts and read receipts (milestone 8). No foreign
  -- key yet: messages arrive in milestone 6.
  last_read_message_id bigint,
  primary key (conversation_id, user_id)
);

create index conversation_members_user on public.conversation_members (user_id);

-- Once both people have deleted their accounts, nobody can ever read the
-- conversation again, so it goes (and, from milestone 6, its messages with
-- it). Memberships are only ever removed by account deletion, so this is the
-- only time it fires. Security definer: the cascade from auth.users runs as
-- whichever role deleted the user, which has no rights on conversations.
create function private.delete_empty_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.conversations c
  where c.id = old.conversation_id
    and not exists (select 1 from public.conversation_members m where m.conversation_id = old.conversation_id);
  return null;
end;
$$;

create trigger conversation_members_delete_empty
  after delete on public.conversation_members
  for each row execute function private.delete_empty_conversation();

-- Privileges -----------------------------------------------------------------------

revoke all on public.conversations, public.direct_conversations, public.conversation_members
  from anon, authenticated;
grant select on public.conversations, public.direct_conversations, public.conversation_members
  to authenticated;

-- Membership check for policies --------------------------------------------------------
-- The members table's own policy has to ask "is the caller a member of this
-- conversation?", which means querying conversation_members from inside
-- conversation_members' policy: Postgres refuses that as infinite recursion.
-- A security definer function runs as its owner, which bypasses RLS, so the
-- inner query doesn't trigger the policy again. It only ever answers about the
-- caller, so it reveals nothing they couldn't see anyway.
--
-- Policies run as the querying user, so authenticated needs usage on the
-- private schema and execute on this one function. The other private
-- helpers stay off-limits (execute revoked), and the API doesn't expose the
-- schema at all.

create function private.is_conversation_member(conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = conversation and m.user_id = (select auth.uid())
  );
$$;

-- Functions are executable by PUBLIC by default. Stop that for every future
-- function in this schema, then grant back the one policies need.
alter default privileges in schema private revoke execute on functions from public;
revoke execute on function private.is_conversation_member(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_conversation_member(uuid) to authenticated;

-- Row Level Security -------------------------------------------------------------------

alter table public.conversations enable row level security;
alter table public.direct_conversations enable row level security;
alter table public.conversation_members enable row level security;

create policy "Members see their conversations"
  on public.conversations for select
  to authenticated
  using (private.is_conversation_member(id));

create policy "Members see their conversation's pair"
  on public.direct_conversations for select
  to authenticated
  using (private.is_conversation_member(conversation_id));

-- Including the other member's row, so the app knows who is in it.
create policy "Members see everyone in their conversations"
  on public.conversation_members for select
  to authenticated
  using (private.is_conversation_member(conversation_id));

-- Accepting creates the conversation ------------------------------------------------------
-- Called by send_friend_request (when it accepts the other person's request)
-- and respond_to_friend_request, always under private.lock_pair. Because of
-- that lock, looking for the pair's conversation and then inserting is safe:
-- nobody else can create one in between. The UNIQUE constraint is the
-- backstop: without the lock, the second insert would fail rather than make a
-- duplicate. (INSERT … ON CONFLICT DO NOTHING on the pair alone would not do:
-- the conversation row is inserted first and would be left empty.)

create or replace function private.make_friends(a uuid, b uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  conversation uuid;
begin
  insert into public.friendships (user_low_id, user_high_id)
  values (least(a, b), greatest(a, b))
  on conflict do nothing;

  select d.conversation_id into conversation from public.direct_conversations d
  where d.user_low_id = least(a, b) and d.user_high_id = greatest(a, b);

  if not found then
    insert into public.conversations default values returning id into conversation;
    insert into public.direct_conversations (conversation_id, user_low_id, user_high_id)
    values (conversation, least(a, b), greatest(a, b));
  end if;

  -- Re-friending finds both memberships already there.
  insert into public.conversation_members (conversation_id, user_id)
  values (conversation, a), (conversation, b)
  on conflict do nothing;
end;
$$;

-- Unfriending --------------------------------------------------------------------------------
-- Deletes the friendship row only. Doing it twice is harmless.

create function public.unfriend(other uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
begin
  if other is null or other = uid then
    raise exception 'Choose someone else' using errcode = '22023';
  end if;

  perform private.lock_pair(uid, other);
  delete from public.friendships f
    where f.user_low_id = least(uid, other) and f.user_high_id = greatest(uid, other);
end;
$$;

revoke execute on function public.unfriend(uuid) from public, anon;
grant execute on function public.unfriend(uuid) to authenticated;

-- Friendships made before this migration (milestone 4) get their conversation.
do $$
declare
  f record;
begin
  for f in select user_low_id, user_high_id from public.friendships loop
    perform private.make_friends(f.user_low_id, f.user_high_id);
  end loop;
end;
$$;
