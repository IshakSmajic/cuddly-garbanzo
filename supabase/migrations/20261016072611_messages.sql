-- Milestone 6: direct messages (spec sections 3, 5 and 8).
--
-- Reading needs membership; sending needs a current friendship. They are
-- separate rules, so unfriending or blocking stops new messages at once and
-- leaves the history readable by both people. Clients insert messages
-- directly under RLS; editing and deleting are out of MVP scope, so there are
-- no update or delete rights at all.

create table public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  -- Filled in by the database (clients have no insert right on this column).
  -- Null once the sender deletes their account: "Deleted user".
  sender_id uuid default auth.uid(),
  -- Made by the client before sending, so a retry can't create a duplicate.
  client_id uuid not null,
  -- Nullable for image messages later (milestone 9); the insert policy
  -- requires text for now. At least one non-space character.
  content text
    constraint messages_content check (char_length(content) between 1 and 4000 and content ~ '\S'),
  created_at timestamptz not null default now(),
  -- The sender must be a member of the conversation. When the membership row
  -- goes (account deletion), only sender_id is set to null: the message
  -- stays for the other person.
  constraint messages_sender_member foreign key (conversation_id, sender_id)
    references public.conversation_members (conversation_id, user_id)
    on delete set null (sender_id),
  constraint messages_client_id unique (sender_id, client_id)
);

-- Newest first within a conversation: serves the latest page, every older
-- page (keyset: "before this message") and the chat list's last message.
create index messages_conversation_order on public.messages (conversation_id, created_at desc, id desc);

-- Privileges -----------------------------------------------------------------------
-- Clients may supply three columns. id, sender_id and created_at come from
-- the database, so nobody can send as someone else or backdate a message,
-- whatever the policy says.

revoke all on public.messages from anon, authenticated;
grant select on public.messages to authenticated;
grant insert (conversation_id, client_id, content) on public.messages to authenticated;

-- Row Level Security -------------------------------------------------------------------

alter table public.messages enable row level security;

create policy "Members read their conversation's messages"
  on public.messages for select
  to authenticated
  using (private.is_conversation_member(conversation_id));

-- The friendship is checked when the insert runs. A send that races an
-- unfriend by milliseconds counts as sent before it, which is what both
-- people would see anyway.
create policy "Friends send text in their conversation"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = (select auth.uid())
    and content is not null
    and exists (
      select 1
      from public.direct_conversations d
      join public.friendships f
        on f.user_low_id = d.user_low_id and f.user_high_id = d.user_high_id
      where d.conversation_id = messages.conversation_id
        and (select auth.uid()) in (d.user_low_id, d.user_high_id)
    )
  );

-- Paging ------------------------------------------------------------------------------
-- Keyset paging: "the page before this message", not "skip N rows", so
-- messages arriving meanwhile never shift pages. (created_at, id) is unique
-- and matches the display order; two messages in the same microsecond are
-- still ordered by id. Security invoker: RLS decides what you can read.

create function public.messages_page(
  conversation uuid,
  before_created_at timestamptz default null,
  before_id bigint default null,
  page_size integer default 50
)
returns setof public.messages
language sql
stable
set search_path = ''
as $$
  select m.*
  from public.messages m
  where m.conversation_id = conversation
    and (before_created_at is null or (m.created_at, m.id) < (before_created_at, before_id))
  order by m.created_at desc, m.id desc
  limit least(greatest(page_size, 1), 100);
$$;

-- The chat list --------------------------------------------------------------------------
-- Every conversation you're in, newest activity first, with the other person
-- (null after they deleted their account), whether you're still friends, and
-- the last message. Pass a conversation id to get just that one. Security
-- invoker: it sees only what RLS lets you see.

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
  last_at timestamptz
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
    last.created_at
  from public.conversation_members me
  join public.conversations c on c.id = me.conversation_id
  join public.direct_conversations d on d.conversation_id = c.id
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

revoke execute on function
  public.messages_page(uuid, timestamptz, bigint, integer),
  public.my_conversations(uuid)
from public, anon;
grant execute on function
  public.messages_page(uuid, timestamptz, bigint, integer),
  public.my_conversations(uuid)
to authenticated;
