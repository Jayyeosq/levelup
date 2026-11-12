-- LevelUp+ — push notifications, post-run battle summary, step counts
-- Run once in Supabase SQL Editor, after 0007. Safe to run again.
--
-- What it adds:
--   • push_tokens: which phone to notify for each runner (only the server can read it).
--   • Every time a run is saved, the server works out what it did on the Battle map:
--       - run_results: tiles you took, claimed, defended (shown on the post-run screen)
--       - tile_events: "X took N of your tiles" / "X is close to taking N of your tiles"
--     and sends a push to the runners affected (never more than 4 a day or 1 per 30 minutes each).
--   • runs.steps: step count for phone-tracked runs (used to spot bike rides).

do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net is not available here: pushes will be skipped (%).', sqlerrm;
end $$;

alter table public.runs add column if not exists steps int;

-- ---------- push tokens ----------
create table if not exists public.push_tokens (
  token      text primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  platform   text,
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_user on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;   -- no policies: only the functions below touch it

-- A phone belongs to whoever is logged in on it now.
create or replace function public.register_push_token(p_token text, p_platform text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not logged in'; end if;
  if p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_:\-]+\]$' then raise exception 'Not a push token'; end if;
  insert into public.push_tokens (token, user_id, platform) values (p_token, auth.uid(), p_platform)
  on conflict (token) do update set user_id = auth.uid(), platform = excluded.platform, updated_at = now();
end $$;
revoke all on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;

create or replace function public.unregister_push_token(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
$$;
revoke all on function public.unregister_push_token(text) from public, anon;
grant execute on function public.unregister_push_token(text) to authenticated;

-- ---------- what a run did on the Battle map ----------
create table if not exists public.run_results (
  run_id        uuid primary key references public.runs (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  client_id     text not null,
  captured      int not null default 0,   -- taken from another runner
  captured_from uuid references public.profiles (id) on delete set null,  -- who lost the most
  claimed       int not null default 0,   -- nobody held them
  defended      int not null default 0,   -- already yours, still yours
  contested     int not null default 0,   -- ran there, someone else still holds it
  created_at    timestamptz not null default now()
);
create index if not exists run_results_user on public.run_results (user_id, client_id);
alter table public.run_results enable row level security;
drop policy if exists "run results: own" on public.run_results;
create policy "run results: own" on public.run_results for select to authenticated using (user_id = auth.uid());

create table if not exists public.tile_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,   -- who it happened to
  kind       text not null check (kind in ('captured', 'attack')),
  actor_id   uuid references public.profiles (id) on delete cascade,            -- who did it
  tiles      int  not null,
  town       text,
  run_id     uuid references public.runs (id) on delete cascade,
  pushed     boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists tile_events_user on public.tile_events (user_id, created_at desc);
alter table public.tile_events enable row level security;
drop policy if exists "tile events: own" on public.tile_events;
create policy "tile events: own" on public.tile_events for select to authenticated using (user_id = auth.uid());

-- Owner and runner-up of each tile (last 30 days).
create or replace function public._tile_standing(p_tiles text[])
returns table (tile_id text, owner_id uuid, owner_km numeric)
language sql stable security definer set search_path = public as $$
  with sc as (
    select s.tile_id, s.user_id, sum(s.km) as km from public.tile_scores s
    where s.tile_id = any (p_tiles) and s.day > (now() at time zone 'Asia/Singapore')::date - 30
    group by s.tile_id, s.user_id
  ),
  r as (select sc.*, row_number() over (partition by sc.tile_id order by sc.km desc, sc.user_id) as rn from sc)
  select r.tile_id, r.user_id, r.km from r where r.rn = 1;
$$;
revoke all on function public._tile_standing(text[]) from public, anon, authenticated;

-- Sends pushes through Expo's push service. Never raises.
create or replace function public._send_push(p_user uuid, p_title text, p_body text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_msgs jsonb;
begin
  select jsonb_agg(jsonb_build_object('to', token, 'title', p_title, 'body', p_body, 'sound', 'default',
                                      'data', jsonb_build_object('screen', 'territory')))
    into v_msgs from public.push_tokens where user_id = p_user;
  if v_msgs is null then return false; end if;
  perform net.http_post(url := 'https://exp.host/--/api/v2/push/send', body := v_msgs,
                        headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb);
  return true;
exception when others then
  raise warning 'LevelUp+ push failed: %', sqlerrm;
  return false;
end $$;
revoke all on function public._send_push(uuid, text, text) from public, anon, authenticated;

-- Works out what a just-saved run changed, records it, and notifies the runners affected.
create or replace function public._after_run(p_run uuid, p_user uuid, p_client text, p_started timestamptz, p_before jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  ATTACK_RATIO constant numeric := 0.7;   -- same as the app's "under attack" colour
  MAX_PER_DAY  constant int := 4;
  MIN_GAP      constant interval := '30 minutes';
  v_rows jsonb; v_actor text; v record; v_title text; v_body text; v_n text;
begin
  with mine as (select t.tile_id, t.km as run_km, t.town from public.tile_scores t where t.run_id = p_run),
  st as (select * from public._tile_standing(array(select tile_id from mine))),
  tot as (
    select s.tile_id, sum(s.km) as km from public.tile_scores s
    where s.user_id = p_user and s.tile_id in (select tile_id from mine)
      and s.day > (now() at time zone 'Asia/Singapore')::date - 30
    group by s.tile_id
  ),
  j as (
    select m.tile_id, m.town, m.run_km, st.owner_id, st.owner_km, coalesce(tot.km, 0) as my_km,
           nullif(p_before ->> m.tile_id, '')::uuid as prev_owner
    from mine m join st on st.tile_id = m.tile_id left join tot on tot.tile_id = m.tile_id
  )
  select jsonb_agg(jsonb_build_object(
    'town', j.town,
    'kind', case when j.owner_id = p_user and j.prev_owner is null then 'claimed'
                 when j.owner_id = p_user and j.prev_owner = p_user then 'defended'
                 when j.owner_id = p_user then 'captured'
                 when j.my_km >= ATTACK_RATIO * j.owner_km and j.my_km - j.run_km < ATTACK_RATIO * j.owner_km then 'attack'
                 else 'contested' end,
    'other', case when j.owner_id = p_user then j.prev_owner else j.owner_id end))
  into v_rows from j;
  if v_rows is null then return; end if;

  insert into public.run_results (run_id, user_id, client_id, captured, captured_from, claimed, defended, contested)
  select p_run, p_user, p_client,
         count(*) filter (where x.kind = 'captured'),
         mode() within group (order by x.other) filter (where x.kind = 'captured'),
         count(*) filter (where x.kind = 'claimed'),
         count(*) filter (where x.kind = 'defended'),
         count(*) filter (where x.kind in ('contested', 'attack'))
  from jsonb_to_recordset(v_rows) as x(town text, kind text, other uuid)
  on conflict (run_id) do nothing;

  select username into v_actor from public.profiles where id = p_user;

  for v in
    select x.other as victim,
           count(*) filter (where x.kind = 'captured') as taken,
           count(*) filter (where x.kind = 'attack') as close,
           mode() within group (order by x.town) as town
    from jsonb_to_recordset(v_rows) as x(town text, kind text, other uuid)
    join public.profiles p on p.id = x.other and not coalesce(p.is_bot, false)
    where x.kind in ('captured', 'attack') and x.other <> p_user
    group by x.other
  loop
    if v.taken > 0 then insert into public.tile_events (user_id, kind, actor_id, tiles, town, run_id) values (v.victim, 'captured', p_user, v.taken, v.town, p_run); end if;
    if v.close > 0 then insert into public.tile_events (user_id, kind, actor_id, tiles, town, run_id) values (v.victim, 'attack', p_user, v.close, v.town, p_run); end if;

    -- Old runs (history imports) change the map quietly. Fresh runs notify, within limits.
    continue when p_started < now() - interval '3 days';
    continue when (select count(distinct e.run_id) from public.tile_events e where e.user_id = v.victim and e.pushed and e.created_at > now() - interval '24 hours') >= MAX_PER_DAY;
    continue when exists (select 1 from public.tile_events e where e.user_id = v.victim and e.pushed and e.created_at > now() - MIN_GAP);

    if v.taken > 0 then
      v_title := format('@%s took %s of your tiles', v_actor, v.taken);
      v_body := format('In %s.%s Run there to win them back.', v.town,
                       case when v.close > 0 then format(' They''re close to taking %s more.', v.close) else '' end);
    else
      v_n := case when v.close = 1 then '1 of your tiles' else v.close || ' of your tiles' end;
      v_title := 'Your tiles are under attack';
      v_body := format('@%s is close to taking %s in %s. Run there to defend them.', v_actor, v_n, v.town);
    end if;
    if public._send_push(v.victim, v_title, v_body) then
      update public.tile_events set pushed = true where run_id = p_run and user_id = v.victim;
    end if;
  end loop;
end $$;
revoke all on function public._after_run(uuid, uuid, text, timestamptz, jsonb) from public, anon, authenticated;

-- Replaces the trigger from 0003: note who held each tile, index the run, then compare.
create or replace function public.trg_index_run_tiles() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  begin
    if new.source <> 'strava' and jsonb_typeof(new.tiles) = 'object' then
      select coalesce(jsonb_object_agg(t.tile_id, t.owner_id), '{}'::jsonb) into v_before
      from public._tile_standing(array(select jsonb_object_keys(new.tiles))) t;
    end if;
  exception when others then v_before := null;
  end;
  perform public.index_run_tiles(new.id);
  if v_before is not null then
    begin
      perform public._after_run(new.id, new.user_id, new.client_id, new.started_at, v_before);
    exception when others then
      raise warning 'LevelUp+ battle summary failed: %', sqlerrm;   -- never block saving a run
    end;
  end if;
  return new;
end $$;

-- The post-run screen asks: what did this run do on the map?
create or replace function public.run_battle(p_client_id text)
returns table (captured int, captured_from text, claimed int, defended int, contested int)
language sql stable security definer set search_path = public as $$
  select r.captured, p.username, r.claimed, r.defended, r.contested
  from public.run_results r left join public.profiles p on p.id = r.captured_from
  where r.user_id = auth.uid() and r.client_id = p_client_id
  order by r.created_at desc limit 1;
$$;
revoke all on function public.run_battle(text) from public, anon;
grant execute on function public.run_battle(text) to authenticated;

-- Developer tool (SQL Editor only): send yourself a test notification.
--   select public.push_test('your_username');
create or replace function public.push_test(p_username text) returns text
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n int;
begin
  select id into v_id from public.profiles where lower(username) = lower(p_username);
  if v_id is null then return 'No runner with that username.'; end if;
  select count(*) into v_n from public.push_tokens where user_id = v_id;
  if v_n = 0 then return 'That runner has no phone registered. Turn on alerts in the app first (Profile tab).'; end if;
  if public._send_push(v_id, 'LevelUp+ test', 'Notifications are working.') then return format('Sent to %s phone(s).', v_n); end if;
  return 'Could not send. Check that the pg_net extension is enabled (Database → Extensions).';
end $$;
revoke all on function public.push_test(text) from public, anon, authenticated;

notify pgrst, 'reload schema';
