-- Chat demo: profiles, messages, realtime, and two test accounts.

create extension if not exists pgcrypto with schema extensions;

-- Profiles (public display names; auth.users isn't readable from the client)
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique
);

alter table public.profiles enable row level security;

create policy "Signed-in users can read profiles"
  on public.profiles for select
  to authenticated
  using (true);

-- Messages (single shared room)
create table public.messages (
  id bigint generated always as identity primary key,
  sender_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index messages_created_at_idx on public.messages (created_at);

alter table public.messages enable row level security;

create policy "Signed-in users can read messages"
  on public.messages for select
  to authenticated
  using (true);

create policy "Users can send messages as themselves"
  on public.messages for insert
  to authenticated
  with check (sender_id = (select auth.uid()));

-- Broadcast inserts over the Realtime websocket
alter publication supabase_realtime add table public.messages;

-- Test accounts (password for both: password123)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'alice@test.com',
   extensions.crypt('password123', extensions.gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}', '{}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'bob@test.com',
   extensions.crypt('password123', extensions.gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}', '{}',
   now(), now(), '', '', '', '');

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data,
  last_sign_in_at, created_at, updated_at
)
values
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111',
   '11111111-1111-1111-1111-111111111111', 'email',
   '{"sub":"11111111-1111-1111-1111-111111111111","email":"alice@test.com","email_verified":true}',
   now(), now(), now()),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222',
   '22222222-2222-2222-2222-222222222222', 'email',
   '{"sub":"22222222-2222-2222-2222-222222222222","email":"bob@test.com","email_verified":true}',
   now(), now(), now());

insert into public.profiles (id, username)
values
  ('11111111-1111-1111-1111-111111111111', 'alice'),
  ('22222222-2222-2222-2222-222222222222', 'bob');
