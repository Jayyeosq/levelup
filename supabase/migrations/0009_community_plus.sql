-- LevelUp+ — Community: reactions, runner cards, nudges
-- Run once in Supabase SQL Editor, after 0008. Safe to run again.

-- ---------- reactions: one per person per post, with a choice of emoji ----------
alter table public.kudos add column if not exists emoji text not null default '👍';
do $$ begin
  alter table public.kudos add constraint kudos_emoji_allowed check (emoji in ('👍', '🔥', '💪', '👏', '👑'));
exception when duplicate_object then null; end $$;

drop policy if exists "kudos: change own" on public.kudos;
create policy "kudos: change own" on public.kudos for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- runner card: what anyone logged in may see about a runner ----------
-- Same information the leaderboard and Battle map already show (never email, runs or routes).
create or replace function public.runner_card(p_user uuid)
returns table (username text, avatar text, home_town text, level int, tiles_held bigint, king_of text[], week_xp bigint, friendship text)
language sql stable security definer set search_path = public as $$
  with mine as (
    select distinct s.tile_id from public.tile_scores s
    where s.user_id = p_user and s.day > (now() at time zone 'Asia/Singapore')::date - 30
  ),
  held as (
    select count(*) as n from public._tile_standing(array(select tile_id from mine)) t where t.owner_id = p_user
  ),
  wk as (select (date_trunc('week', now() at time zone 'Asia/Singapore') at time zone 'Asia/Singapore') as start),
  xp as (
    select coalesce(sum(coalesce(r.xp, round(r.km * 10)::int)), 0) as n
    from public.runs r, wk where r.user_id = p_user and r.started_at >= wk.start and r.source <> 'strava'
  )
  select p.username, p.avatar, p.home_town, p.level, held.n,
         coalesce((select array_agg(k.town order by k.town) from public.town_kings() k where k.king_id = p_user), '{}'),
         xp.n,
         case
           when p.id = auth.uid() then 'self'
           when exists (select 1 from public.friendships f where f.status = 'accepted' and auth.uid() in (f.requester, f.addressee) and p.id in (f.requester, f.addressee)) then 'friends'
           when exists (select 1 from public.friendships f where f.status = 'pending' and f.requester = auth.uid() and f.addressee = p.id) then 'sent'
           when exists (select 1 from public.friendships f where f.status = 'pending' and f.requester = p.id and f.addressee = auth.uid()) then 'incoming'
           else 'none'
         end
  from public.profiles p, held, xp
  where p.id = p_user and auth.uid() is not null;
$$;
revoke all on function public.runner_card(uuid) from public, anon;
grant execute on function public.runner_card(uuid) to authenticated;

-- ---------- nudges: "go for a run" to a friend, once a day each ----------
create table if not exists public.nudges (
  from_id uuid not null references public.profiles (id) on delete cascade,
  to_id   uuid not null references public.profiles (id) on delete cascade,
  day     date not null default (now() at time zone 'Asia/Singapore')::date,
  primary key (from_id, to_id, day)
);
alter table public.nudges enable row level security;   -- no policies: only the function below touches it

-- Returns 'sent', 'already' (nudged today), 'no_phone' (they haven't turned alerts on) or 'not_friends'.
create or replace function public.nudge_friend(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_name text; v_today date := (now() at time zone 'Asia/Singapore')::date;
begin
  if v_me is null or p_user = v_me or not public.are_friends(v_me, p_user) then return 'not_friends'; end if;
  if exists (select 1 from public.nudges where from_id = v_me and to_id = p_user and day = v_today) then return 'already'; end if;
  if not exists (select 1 from public.push_tokens where user_id = p_user) then return 'no_phone'; end if;
  insert into public.nudges (from_id, to_id, day) values (v_me, p_user, v_today);
  select username into v_name from public.profiles where id = v_me;
  perform public._send_push(p_user, format('@%s nudged you', v_name), 'Time for a run? Your tiles won''t defend themselves.');
  return 'sent';
end $$;
revoke all on function public.nudge_friend(uuid) from public, anon;
grant execute on function public.nudge_friend(uuid) to authenticated;

notify pgrst, 'reload schema';
