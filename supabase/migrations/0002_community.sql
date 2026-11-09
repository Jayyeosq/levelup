-- LevelUp+ — Community: friends, activity feed, kudos, weekly leaderboard (MVP part 2)
-- Run once in Supabase: SQL Editor → New query → paste → Run. Safe to run again.
--
-- Privacy rules:
--   • Friends: you see your own requests and friendships only.
--   • Feed: you see posts from yourself and accepted friends only. Posts never contain routes or emails.
--   • Leaderboard: shows username, avatar, town, level and this week's XP — nothing else.
--   • Runs imported from Strava are never shown to others (Strava's API rules).

-- XP of each run (used for the weekly leaderboard)
alter table public.runs add column if not exists xp int;

-- ---------- friends ----------
create table if not exists public.friendships (
  id          uuid primary key default gen_random_uuid(),
  requester   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  addressee   uuid not null references public.profiles (id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at  timestamptz not null default now(),
  check (requester <> addressee)
);
-- one row per pair, whichever direction
create unique index if not exists friendships_pair on public.friendships (least(requester, addressee), greatest(requester, addressee));

alter table public.friendships enable row level security;
drop policy if exists "friends: see own" on public.friendships;
create policy "friends: see own" on public.friendships for select to authenticated
  using (auth.uid() in (requester, addressee));
drop policy if exists "friends: send request" on public.friendships;
create policy "friends: send request" on public.friendships for insert to authenticated
  with check (requester = auth.uid() and status = 'pending');
drop policy if exists "friends: accept" on public.friendships;
create policy "friends: accept" on public.friendships for update to authenticated
  using (addressee = auth.uid()) with check (addressee = auth.uid() and status = 'accepted');
drop policy if exists "friends: remove" on public.friendships;
create policy "friends: remove" on public.friendships for delete to authenticated
  using (auth.uid() in (requester, addressee));

create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.friendships
    where status = 'accepted' and least(requester, addressee) = least(a, b) and greatest(requester, addressee) = greatest(a, b));
$$;
grant execute on function public.are_friends(uuid, uuid) to authenticated;

-- Find a runner by exact username (any upper/lower case).
create or replace function public.find_runner(u text)
returns table (id uuid, username text, avatar text, home_town text, level int)
language sql stable security definer set search_path = public as $$
  select id, username, avatar, home_town, level from public.profiles where lower(username) = lower(u) limit 1;
$$;
grant execute on function public.find_runner(text) to authenticated;

-- ---------- activity feed ----------
create table if not exists public.activities (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind           text not null check (kind in ('run', 'level_up', 'badge')),
  data           jsonb not null default '{}',   -- e.g. {"km":5.2,"xp":75} — never a route
  run_client_id  text,                          -- links a post to its run (deleted together)
  created_at     timestamptz not null default now()
);
create index if not exists activities_user_time on public.activities (user_id, created_at desc);

alter table public.activities enable row level security;
drop policy if exists "feed: see own and friends" on public.activities;
create policy "feed: see own and friends" on public.activities for select to authenticated
  using (user_id = auth.uid() or public.are_friends(auth.uid(), user_id));
drop policy if exists "feed: post own" on public.activities;
create policy "feed: post own" on public.activities for insert to authenticated
  with check (user_id = auth.uid() and not (data ? 'route'));
drop policy if exists "feed: delete own" on public.activities;
create policy "feed: delete own" on public.activities for delete to authenticated
  using (user_id = auth.uid());

-- ---------- kudos ----------
create table if not exists public.kudos (
  activity_id  uuid not null references public.activities (id) on delete cascade,
  user_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (activity_id, user_id)
);
alter table public.kudos enable row level security;
drop policy if exists "kudos: see on visible posts" on public.kudos;
create policy "kudos: see on visible posts" on public.kudos for select to authenticated
  using (exists (select 1 from public.activities a where a.id = activity_id));
drop policy if exists "kudos: give" on public.kudos;
create policy "kudos: give" on public.kudos for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.activities a where a.id = activity_id));
drop policy if exists "kudos: take back" on public.kudos;
create policy "kudos: take back" on public.kudos for delete to authenticated
  using (user_id = auth.uid());

-- ---------- weekly leaderboard ----------
-- Week = Monday 00:00 to Sunday 23:59 Singapore time. scope: 'friends' | 'town' | 'all'.
-- Returns the top 50, plus your own row if you're outside the top 50.
create or replace function public.weekly_leaderboard(scope text default 'all')
returns table (rank bigint, user_id uuid, username text, avatar text, home_town text, level int, week_xp bigint, is_me boolean)
language sql stable security definer set search_path = public as $$
  with me as (select id, home_town from public.profiles where id = auth.uid()),
  wk as (select (date_trunc('week', now() at time zone 'Asia/Singapore') at time zone 'Asia/Singapore') as start),
  xp as (
    select r.user_id, sum(coalesce(r.xp, round(r.km * 10)::int)) as week_xp
    from public.runs r, wk
    where r.started_at >= wk.start and r.source <> 'strava'
    group by r.user_id
  ),
  pool as (
    select p.id, p.username, p.avatar, p.home_town, p.level, coalesce(xp.week_xp, 0) as week_xp
    from public.profiles p left join xp on xp.user_id = p.id, me
    where case scope
      when 'friends' then p.id = me.id or public.are_friends(me.id, p.id)
      when 'town'    then (p.id = me.id or coalesce(xp.week_xp, 0) > 0) and me.home_town is not null and p.home_town = me.home_town
      else p.id = me.id or coalesce(xp.week_xp, 0) > 0
    end
  ),
  ranked as (
    select rank() over (order by week_xp desc) as rank, id, username, avatar, home_town, level, week_xp, (id = auth.uid()) as is_me
    from pool
  )
  select * from ranked where rank <= 50 or is_me order by rank, username;
$$;
grant execute on function public.weekly_leaderboard(text) to authenticated;
