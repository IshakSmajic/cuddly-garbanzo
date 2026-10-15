-- Milestone 2: profiles (spec section 5).
--
-- One row per auth user, created by a trigger at sign-up. username and
-- display_name stay null until onboarding, so sign-up can never fail on a
-- username collision.

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Stored lowercase, so plain UNIQUE is case-insensitive in effect.
  username text unique
    constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text
    constraint profiles_display_name_length
      check (display_name = btrim(display_name) and char_length(display_name) between 1 and 50),
  bio text
    constraint profiles_bio_length check (char_length(bio) <= 280),
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.profiles.username is
  'Null until onboarding. Lowercase a-z, 0-9 and underscore, 3-20 characters.';

-- Privileges --------------------------------------------------------------
-- Supabase grants everything on new tables to anon and authenticated by
-- default. Start from nothing and grant back only what the app needs.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
-- Column-level: users can change these three fields and nothing else.
grant update (username, display_name, bio) on public.profiles to authenticated;
-- No insert or delete grants: the trigger inserts, account deletion cascades.

-- Row Level Security ------------------------------------------------------
alter table public.profiles enable row level security;

create policy "Signed-in users can read profiles"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Keep updated_at current -------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create a profile for every new auth user --------------------------------
-- security definer: runs as the function owner, because the auth service
-- that inserts into auth.users has no privileges on public.profiles.
-- search_path = '' stops a caller from redirecting unqualified names.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id);
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
