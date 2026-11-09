-- LevelUp+ — accounts & cloud sync (MVP part 1)
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
--
-- Privacy rules:
--   • Emails live only in Supabase's private auth.users table. No public table holds an email.
--   • profiles = public game card (username, avatar, town, level). Readable by logged-in users.
--   • runs (incl. exact GPS routes) = private to the owner.

-- ---------- profiles ----------
create table if not exists public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  username       text not null,
  avatar         text not null default '🏃',
  home_town      text,
  weekly_goal_km int  not null default 20 check (weekly_goal_km between 5 and 150),
  xp             int  not null default 0,
  level          int  not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint username_format check (username ~ '^[A-Za-z0-9_]{3,20}$')
);
create unique index if not exists profiles_username_lower on public.profiles (lower(username));

alter table public.profiles enable row level security;

drop policy if exists "profiles readable by logged-in users" on public.profiles;
create policy "profiles readable by logged-in users" on public.profiles
  for select to authenticated using (true);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
-- No insert/delete policies: rows are created by the signup trigger below, removed with the account.

-- Usernames can't be changed by editing the row (keeps them stable for friends/leaderboards).
create or replace function public.protect_profile_columns() returns trigger
language plpgsql as $$
begin
  if new.username is distinct from old.username then
    raise exception 'Username cannot be changed';
  end if;
  new.id := old.id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- Create the profile automatically when someone signs up (username comes from sign-up metadata).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data ->> 'username');
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- "Is this username free?" — answers yes/no only, reveals nothing else.
create or replace function public.username_available(u text) returns boolean
language sql stable security definer set search_path = public as $$
  select u ~ '^[A-Za-z0-9_]{3,20}$'
     and not exists (select 1 from public.profiles where lower(username) = lower(u));
$$;
grant execute on function public.username_available(text) to anon, authenticated;

-- ---------- runs (private) ----------
create table if not exists public.runs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  client_id    text not null,                 -- the phone's run id, used to avoid duplicates
  started_at   timestamptz not null,
  duration_sec int  not null check (duration_sec >= 0),
  km           numeric(7,3) not null check (km >= 0 and km <= 300),
  route        jsonb not null default '[]',   -- exact GPS path: owner only
  tiles        jsonb not null default '{}',   -- tile id -> km
  source       text not null default 'app' check (source in ('app','strava','test')),
  strava_id    bigint,
  created_at   timestamptz not null default now(),
  unique (user_id, client_id)
);
create index if not exists runs_user_started on public.runs (user_id, started_at desc);

alter table public.runs enable row level security;

drop policy if exists "own runs: read" on public.runs;
create policy "own runs: read" on public.runs for select to authenticated using (user_id = auth.uid());
drop policy if exists "own runs: insert" on public.runs;
create policy "own runs: insert" on public.runs for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "own runs: delete" on public.runs;
create policy "own runs: delete" on public.runs for delete to authenticated using (user_id = auth.uid());
-- No update policy: a saved run can't be edited, only deleted.

-- ---------- username login helper (server only) ----------
-- Used by the auth-login server function to find the account behind a username.
-- Not callable from the app: only the server's secret key can run it.
create or replace function public.user_id_for_username(u text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.profiles where lower(username) = lower(u) limit 1;
$$;
revoke all on function public.user_id_for_username(text) from public, anon, authenticated;
