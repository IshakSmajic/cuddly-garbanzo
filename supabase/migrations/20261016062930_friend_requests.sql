-- Milestone 4: user discovery, friend requests and blocking (spec sections 3
-- and 5). Also creates friendships, because accepting a request and blocking
-- both change them; the friend list, unfriending and the direct conversation
-- created on accept come in milestone 5.
--
-- Clients only read these tables. Every change goes through the security
-- definer functions below, which enforce who may do what and the allowed
-- status transitions (a CHECK constraint can limit values, not transitions).
--
-- Error codes the app tells apart. Custom codes in a class of our own ("TB");
-- PostgREST answers them with HTTP 400.
--   42501  not signed in, not onboarded, or not your request (HTTP 403)
--   22023  bad argument: yourself, unknown user, malformed search (HTTP 400)
--   TB001  a block exists between the two users (either direction)
--   TB002  already friends
--   TB003  the request is no longer pending
--   TB004  rate limit reached
--   TB005  they declined your last request less than 24 hours ago

-- Tables -------------------------------------------------------------------------

create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (user_id) on delete cascade,
  recipient_id uuid not null references public.profiles (user_id) on delete cascade,
  status text not null default 'pending'
    constraint friend_requests_status check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friend_requests_not_self check (requester_id <> recipient_id),
  -- Pending exactly when nobody has responded yet.
  constraint friend_requests_responded check ((status = 'pending') = (responded_at is null))
);

comment on table public.friend_requests is
  'Workflow and history. Whether two users are friends now is answered only by friendships.';

-- At most one pending request per pair, whichever way it points: indexing the
-- sorted pair makes A→B and B→A the same key. Partial (WHERE pending), so the
-- history of answered requests can hold any number of rows.
create unique index friend_requests_one_pending_per_pair
  on public.friend_requests (least(requester_id, recipient_id), greatest(requester_id, recipient_id))
  where status = 'pending';

-- "Requests I sent" (and the hourly rate limit) and "requests I received".
create index friend_requests_requester on public.friend_requests (requester_id, created_at);
create index friend_requests_recipient on public.friend_requests (recipient_id, created_at);

-- A row exists only while the friendship is active. Each pair is stored once,
-- lower id first, so a reversed duplicate is impossible.
create table public.friendships (
  user_low_id uuid not null references public.profiles (user_id) on delete cascade,
  user_high_id uuid not null references public.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_low_id, user_high_id),
  constraint friendships_ordered check (user_low_id < user_high_id)
);

-- The primary key serves lookups by user_low_id; this serves the other side.
create index friendships_high on public.friendships (user_high_id);

create table public.blocks (
  blocker_id uuid not null references public.profiles (user_id) on delete cascade,
  blocked_id uuid not null references public.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

create index blocks_blocked on public.blocks (blocked_id);

-- One row per search, for the per-minute limit. Old rows are pruned by
-- search_users itself. Clients can't read or write it at all.
create table public.search_events (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now()
);

create index search_events_user on public.search_events (user_id, created_at);

-- Prefix search on username. The UNIQUE index can't serve LIKE 'abc%' under
-- the database's default collation; text_pattern_ops compares character by
-- character, which is what a prefix match needs.
create index profiles_username_prefix on public.profiles (username text_pattern_ops);

-- Privileges -----------------------------------------------------------------------
-- Start from nothing (Supabase grants everything on new tables by default).

revoke all on public.friend_requests, public.friendships, public.blocks, public.search_events
  from anon, authenticated;
grant select on public.friend_requests, public.friendships, public.blocks to authenticated;

-- Row Level Security -----------------------------------------------------------------

alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.blocks enable row level security;
alter table public.search_events enable row level security; -- no policies: nothing visible

create policy "Users see requests they sent or received"
  on public.friend_requests for select
  to authenticated
  using ((select auth.uid()) in (requester_id, recipient_id));

create policy "Users see their own friendships"
  on public.friendships for select
  to authenticated
  using ((select auth.uid()) in (user_low_id, user_high_id));

-- Only blocks you made: nobody can read the table to learn who blocked them.
create policy "Users see the blocks they made"
  on public.blocks for select
  to authenticated
  using (blocker_id = (select auth.uid()));

-- Internal helpers -------------------------------------------------------------------
-- In a schema the API doesn't expose, with no usage granted, so clients can't
-- call them; the public functions (running as their owner) can.

create schema private;
revoke all on schema private from public;

-- The signed-in, onboarded caller, or an error.
create function private.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = uid and p.username is not null) then
    raise exception 'Finish onboarding first' using errcode = '42501';
  end if;
  return uid;
end;
$$;

-- Serialises everything that touches one pair of users until the transaction
-- ends. A row lock (FOR UPDATE) can't do this: when A and B send each other a
-- request at the same moment there is no row to lock yet. Both ids are sorted,
-- so A,B and B,A take the same lock. Advisory locks are keyed by a bigint, so
-- the pair is hashed; a collision only makes two unrelated pairs wait for each
-- other briefly, it never breaks correctness.
create function private.lock_pair(a uuid, b uuid)
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended(least(a, b)::text || greatest(a, b)::text, 0));
$$;

create function private.blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks k
    where (k.blocker_id = a and k.blocked_id = b) or (k.blocker_id = b and k.blocked_id = a)
  );
$$;

create function private.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships f
    where f.user_low_id = least(a, b) and f.user_high_id = greatest(a, b)
  );
$$;

-- Milestone 5 adds the direct conversation here, in the same transaction.
create function private.make_friends(a uuid, b uuid)
returns void
language sql
set search_path = ''
as $$
  insert into public.friendships (user_low_id, user_high_id)
  values (least(a, b), greatest(a, b))
  on conflict do nothing;
$$;

revoke execute on all functions in schema private from public;

-- How you relate to someone ----------------------------------------------------------
-- Security invoker: it reads only what RLS already shows you, so "blocked"
-- means *you* blocked them. That they blocked you is never revealed here.

create function public.relationship_with(other uuid)
returns table (relation text, request_id uuid)
language sql
stable
set search_path = ''
as $$
  select
    case
      when exists (select 1 from public.blocks k where k.blocker_id = me.id and k.blocked_id = other)
        then 'blocked'
      when exists (
        select 1 from public.friendships f
        where f.user_low_id = least(me.id, other) and f.user_high_id = greatest(me.id, other)
      ) then 'friends'
      when r.requester_id = other then 'incoming'
      when r.requester_id = me.id then 'outgoing'
      else 'none'
    end,
    r.id
  from (select (select auth.uid()) as id) me
  left join public.friend_requests r
    on r.status = 'pending'
    and least(r.requester_id, r.recipient_id) = least(me.id, other)
    and greatest(r.requester_id, r.recipient_id) = greatest(me.id, other);
$$;

-- Search -----------------------------------------------------------------------------
-- Security definer because it must know whether *they* blocked *you*, which
-- RLS hides from you. Search is enumeration by design, so it is limited: a
-- valid username prefix of 3–20 characters, 20 results, 30 searches a minute.

create function public.search_users(query text)
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_path text,
  relation text,
  request_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_user();
  q text := lower(btrim(query));
begin
  -- Only username characters, so the one LIKE wildcard that can appear is
  -- "_" (which matches any single character); it is escaped below.
  if q is null or q !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Search for 3 to 20 letters, numbers or underscores' using errcode = '22023';
  end if;

  -- Two searches at the same moment can both pass the count; at this scale an
  -- overshoot of one or two is harmless, so no lock.
  if (select count(*) from public.search_events e
      where e.user_id = uid and e.created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Too many searches. Wait a minute and try again.' using errcode = 'TB004';
  end if;
  delete from public.search_events e where e.user_id = uid and e.created_at <= now() - interval '1 minute';
  insert into public.search_events (user_id) values (uid);

  return query
    select p.user_id, p.username, p.display_name, p.avatar_path, rel.relation, rel.request_id
    from public.profiles p
    cross join lateral public.relationship_with(p.user_id) rel
    where p.username like replace(q, '_', '\_') || '%'
      and p.user_id <> uid
      -- Hidden from anyone they blocked. People *you* blocked still appear
      -- (marked "blocked"), so you can find them again to unblock.
      and not exists (select 1 from public.blocks k where k.blocker_id = p.user_id and k.blocked_id = uid)
    order by p.username = q desc, p.username
    limit 20;
end;
$$;

-- Sending -------------------------------------------------------------------------------
-- Returns 'pending' (request sent, or already pending) or 'friends' (they had
-- already asked you, so their request was accepted instead).

create function public.send_friend_request(recipient uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  incoming uuid;
begin
  if recipient is null or recipient = uid then
    raise exception 'Choose someone else' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = recipient and p.username is not null) then
    raise exception 'User not found' using errcode = '22023';
  end if;

  -- From here until commit, nothing else can change this pair.
  perform private.lock_pair(uid, recipient);

  if private.blocked_between(uid, recipient) then
    raise exception 'Can''t send a request to this user' using errcode = 'TB001';
  end if;
  if private.are_friends(uid, recipient) then
    raise exception 'Already friends' using errcode = 'TB002';
  end if;

  select r.id into incoming from public.friend_requests r
  where r.requester_id = recipient and r.recipient_id = uid and r.status = 'pending';
  if found then
    update public.friend_requests set status = 'accepted', responded_at = now() where id = incoming;
    perform private.make_friends(uid, recipient);
    return 'friends';
  end if;

  -- Sending twice is harmless.
  if exists (select 1 from public.friend_requests r
             where r.requester_id = uid and r.recipient_id = recipient and r.status = 'pending') then
    return 'pending';
  end if;

  if exists (select 1 from public.friend_requests r
             where r.requester_id = uid and r.recipient_id = recipient and r.status = 'declined'
               and r.responded_at > now() - interval '24 hours') then
    raise exception 'They declined your last request. Try again later.' using errcode = 'TB005';
  end if;

  -- Counted across all recipients, so sends to different people in parallel
  -- could overshoot by one or two; harmless at this scale.
  if (select count(*) from public.friend_requests r
      where r.requester_id = uid and r.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many requests. Try again in an hour.' using errcode = 'TB004';
  end if;

  insert into public.friend_requests (requester_id, recipient_id) values (uid, recipient);
  return 'pending';
end;
$$;

-- Answering and cancelling -----------------------------------------------------------------
-- Same pattern in both: read the pair, take the pair lock, then re-read the
-- request. The first read may already be stale (it was taken before the
-- lock), so the status check must come after locking.

create function public.respond_to_friend_request(request_id uuid, accept boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  req public.friend_requests;
begin
  if accept is null then
    raise exception 'Choose accept or decline' using errcode = '22023';
  end if;

  select * into req from public.friend_requests r where r.id = request_id;
  -- "Not found" and "not yours" give the same answer.
  if not found or req.recipient_id <> uid then
    raise exception 'Request not found' using errcode = '42501';
  end if;

  perform private.lock_pair(req.requester_id, req.recipient_id);
  select * into req from public.friend_requests r where r.id = request_id;
  if req.status <> 'pending' then
    raise exception 'This request is no longer pending' using errcode = 'TB003';
  end if;

  if accept then
    update public.friend_requests set status = 'accepted', responded_at = now() where id = request_id;
    perform private.make_friends(req.requester_id, req.recipient_id);
    return 'accepted';
  end if;
  update public.friend_requests set status = 'declined', responded_at = now() where id = request_id;
  return 'declined';
end;
$$;

create function public.cancel_friend_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  req public.friend_requests;
begin
  select * into req from public.friend_requests r where r.id = request_id;
  if not found or req.requester_id <> uid then
    raise exception 'Request not found' using errcode = '42501';
  end if;

  perform private.lock_pair(req.requester_id, req.recipient_id);
  select * into req from public.friend_requests r where r.id = request_id;
  if req.status <> 'pending' then
    raise exception 'This request is no longer pending' using errcode = 'TB003';
  end if;

  update public.friend_requests set status = 'cancelled', responded_at = now() where id = request_id;
end;
$$;

-- Blocking ---------------------------------------------------------------------------------
-- Ends the friendship and cancels pending requests, all under the pair lock,
-- so an accept running at the same moment either finishes first (and its
-- friendship is then removed) or waits and finds the request cancelled.
-- Unblocking only removes the block: the friendship doesn't come back.

create function public.block_user(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
begin
  if target is null or target = uid then
    raise exception 'Choose someone else' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = target) then
    raise exception 'User not found' using errcode = '22023';
  end if;

  perform private.lock_pair(uid, target);
  insert into public.blocks (blocker_id, blocked_id) values (uid, target) on conflict do nothing;
  delete from public.friendships f
    where f.user_low_id = least(uid, target) and f.user_high_id = greatest(uid, target);
  update public.friend_requests r set status = 'cancelled', responded_at = now()
    where r.status = 'pending'
      and least(r.requester_id, r.recipient_id) = least(uid, target)
      and greatest(r.requester_id, r.recipient_id) = greatest(uid, target);
end;
$$;

create function public.unblock_user(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
begin
  perform private.lock_pair(uid, target);
  delete from public.blocks k where k.blocker_id = uid and k.blocked_id = target;
end;
$$;

-- Functions are executable by PUBLIC by default; only signed-in users need these.
revoke execute on function
  public.relationship_with(uuid),
  public.search_users(text),
  public.send_friend_request(uuid),
  public.respond_to_friend_request(uuid, boolean),
  public.cancel_friend_request(uuid),
  public.block_user(uuid),
  public.unblock_user(uuid)
from public, anon;
grant execute on function
  public.relationship_with(uuid),
  public.search_users(text),
  public.send_friend_request(uuid),
  public.respond_to_friend_request(uuid, boolean),
  public.cancel_friend_request(uuid),
  public.block_user(uuid),
  public.unblock_user(uuid)
to authenticated;
