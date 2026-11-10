-- LevelUp+ — Bot runners for testing (fake users that run, claim tiles and raid yours)
-- Run once in Supabase: SQL Editor → New query → paste → Run. Safe to run again.
--
-- Everything is controlled from the SQL Editor:
--   select public.seed_bots(20, 'Yishun');           -- create 20 bots (half around Yishun) with 4 weeks of runs
--   select public.bot_raid('jaeakareborn', 3);       -- a bot takes 3 of your tiles right now
--   select public.bots_tick();                       -- one "hour" of bot activity (the cron job calls this)
--   select public.delete_bots();                     -- remove every bot and all their runs
-- Optional: run bots automatically every hour (see the bottom of this file).
--
-- Bots are clearly marked: usernames start with "bot_" and their avatar is 🤖.
-- Real users can't take a "bot_" username.

alter table public.profiles add column if not exists is_bot boolean not null default false;

-- Reserve the bot_ prefix for bots
create or replace function public.username_available(u text) returns boolean
language sql stable security definer set search_path = public as $$
  select u ~ '^[A-Za-z0-9_]{3,20}$'
     and lower(u) not like 'bot\_%'
     and not exists (select 1 from public.profiles where lower(username) = lower(u));
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare uname text := new.raw_user_meta_data ->> 'username';
        bot boolean := coalesce((new.raw_user_meta_data ->> 'bot')::boolean, false);
begin
  if lower(uname) like 'bot\_%' and not bot then
    raise exception 'Usernames starting with bot_ are reserved';
  end if;
  insert into public.profiles (id, username, avatar, is_bot)
  values (new.id, uname, case when bot then '🤖' else '🏃' end, bot);
  return new;
end $$;

-- ---------- route generator ----------
-- mode 'walk': a wandering run around (c_lat, c_lng).
-- mode 'raid': run in from ~600 m away, lap tightly around the target point, run back out
--              (start/end are far from the target so the laps count on the public map).
create or replace function public._bot_route(c_lat float8, c_lng float8, km float8, mode text default 'walk', laps int default 0)
returns table (route jsonb, tiles jsonb, total_km float8)
language plpgsql volatile set search_path = public as $$
declare
  mlat constant float8 := 110574;
  mlng float8 := 111320 * cos(radians(c_lat));
  step constant float8 := 12;            -- metres per step
  lat float8; lng float8; h float8; d float8; i int; n int;
  pts jsonb := '[]'; t jsonb := '{}'; key text; hq int; hr int;
  r constant float8 := 45;               -- lap radius (m), stays inside one hex
  ang float8; lap_steps int;
  procedure_dummy int;
begin
  total_km := 0;
  if mode = 'raid' then
    h := random() * 2 * pi();
    -- approach: from 600 m away straight to the edge of the lap circle
    lat := c_lat + (600 * cos(h)) / mlat; lng := c_lng + (600 * sin(h)) / mlng;
    n := floor((600 - r) / step);
    for i in 0..n loop
      lat := c_lat + ((600 - i * step) * cos(h)) / mlat; lng := c_lng + ((600 - i * step) * sin(h)) / mlng;
      if i % 3 = 0 then pts := pts || jsonb_build_array(jsonb_build_object('latitude', round(lat::numeric, 6), 'longitude', round(lng::numeric, 6))); end if;
      if i > 0 then
        select q, x.r into hq, hr from public.hex_of(lat, lng) x;
        key := hq || ':' || hr; t := jsonb_set(t, array[key], to_jsonb(coalesce((t ->> key)::float8, 0) + step / 1000)); total_km := total_km + step / 1000;
      end if;
    end loop;
    -- laps
    lap_steps := ceil(2 * pi() * r / step);
    for i in 1..(laps * lap_steps) loop
      ang := h + (i::float8 / lap_steps) * 2 * pi();
      lat := c_lat + (r * cos(ang)) / mlat; lng := c_lng + (r * sin(ang)) / mlng;
      if i % 3 = 0 then pts := pts || jsonb_build_array(jsonb_build_object('latitude', round(lat::numeric, 6), 'longitude', round(lng::numeric, 6))); end if;
      select q, x.r into hq, hr from public.hex_of(lat, lng) x;
      key := hq || ':' || hr; t := jsonb_set(t, array[key], to_jsonb(coalesce((t ->> key)::float8, 0) + step / 1000)); total_km := total_km + step / 1000;
    end loop;
    -- exit: straight back out the other way
    h := h + pi() * (0.6 + random() * 0.8);
    for i in 0..n loop
      lat := c_lat + ((r + i * step) * cos(h)) / mlat; lng := c_lng + ((r + i * step) * sin(h)) / mlng;
      if i % 3 = 0 or i = n then pts := pts || jsonb_build_array(jsonb_build_object('latitude', round(lat::numeric, 6), 'longitude', round(lng::numeric, 6))); end if;
      select q, x.r into hq, hr from public.hex_of(lat, lng) x;
      key := hq || ':' || hr; t := jsonb_set(t, array[key], to_jsonb(coalesce((t ->> key)::float8, 0) + step / 1000)); total_km := total_km + step / 1000;
    end loop;
  else
    -- wander, staying within ~2.5 km of the centre
    lat := c_lat + ((random() - 0.5) * 1600) / mlat; lng := c_lng + ((random() - 0.5) * 1600) / mlng;
    h := random() * 2 * pi();
    n := greatest(20, floor(km * 1000 / step));
    for i in 0..n loop
      if i > 0 then
        h := h + (random() - 0.5) * 0.5;
        d := sqrt(((lat - c_lat) * mlat) ^ 2 + ((lng - c_lng) * mlng) ^ 2);
        if d > 2500 then h := atan2((c_lng - lng) * mlng, (c_lat - lat) * mlat) + (random() - 0.5) * 0.4; end if;
        lat := lat + (step * cos(h)) / mlat; lng := lng + (step * sin(h)) / mlng;
        select q, x.r into hq, hr from public.hex_of(lat, lng) x;
        key := hq || ':' || hr; t := jsonb_set(t, array[key], to_jsonb(coalesce((t ->> key)::float8, 0) + step / 1000)); total_km := total_km + step / 1000;
      end if;
      if i % 3 = 0 or i = n then pts := pts || jsonb_build_array(jsonb_build_object('latitude', round(lat::numeric, 6), 'longitude', round(lng::numeric, 6))); end if;
    end loop;
  end if;
  route := pts; tiles := t;
  return next;
end $$;

-- Insert one run for a bot (tiles are indexed onto the shared map by the runs trigger)
create or replace function public._bot_insert_run(p_bot uuid, p_route jsonb, p_tiles jsonb, p_km float8, p_started timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare pace float8 := 5.0 + random() * 2.0;   -- min/km
begin
  insert into public.runs (user_id, client_id, started_at, duration_sec, km, route, tiles, source, xp)
  values (p_bot, 'bot-' || gen_random_uuid(), p_started, round(p_km * pace * 60), round(p_km::numeric, 3), p_route, p_tiles, 'app', round(p_km * 10));
end $$;

create or replace function public._bot_refresh_stats() returns void
language sql security definer set search_path = public as $$
  update public.profiles p set xp = s.xp,
    level = (select max(l) from generate_series(1, 99) l where round(25 * power(l - 1, 1.8)) <= s.xp)
  from (select user_id, coalesce(sum(xp), 0)::int xp from public.runs group by user_id) s
  where p.id = s.user_id and p.is_bot;
$$;

-- ---------- seed ----------
create or replace function public.seed_bots(how_many int default 20, focus_town text default 'Yishun')
returns text language plpgsql security definer set search_path = public as $$
declare
  names text[] := array['ravi','meiling','darren','siti','kelvin','priya','junhao','farah','marcus','huimin',
                        'daniel','aisyah','weijie','rachel','hafiz','cheryl','bryan','aaron','nadia','ethan',
                        'sarah','irfan','jolene','vikram','zihao','amanda','faizal','grace','shawn','lina'];
  focus record; town record; uid uuid; uname text; created int := 0; d int; km float8; rr record; i int;
begin
  select * into focus from public.towns where lower(name) = lower(focus_town);
  for i in 1..least(how_many, array_length(names, 1)) loop
    uname := 'bot_' || names[i];
    if exists (select 1 from public.profiles where lower(username) = uname) then continue; end if;
    uid := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            uname || '@bots.levelup.invalid', '{"provider":"email","providers":["email"]}',
            jsonb_build_object('username', uname, 'bot', true), now(), now());
    -- half the bots live near the focus town, the rest anywhere in Singapore
    if focus.name is not null and i % 2 = 1 then town := focus;
    else select * into town from public.towns order by random() limit 1; end if;
    update public.profiles set home_town = town.name where id = uid;
    -- ~4 weeks of history, 2–4 runs a week
    for d in 1..28 loop
      if random() < 0.42 then
        km := 3 + random() * 7;
        select * into rr from public._bot_route(town.lat + (random() - 0.5) * 0.01, town.lng + (random() - 0.5) * 0.01, km, 'walk');
        perform public._bot_insert_run(uid, rr.route, rr.tiles, rr.total_km, now() - make_interval(days => d, hours => floor(random() * 14)::int));
      end if;
    end loop;
    created := created + 1;
  end loop;
  perform public._bot_refresh_stats();
  return format('Created %s bots (%s total)', created, (select count(*) from public.profiles where is_bot));
end $$;

-- ---------- raid a real runner ----------
-- A bot laps one of the target's tiles until it owns it. Repeats for `how_many` tiles.
create or replace function public.bot_raid(target_username text, how_many int default 1)
returns text language plpgsql security definer set search_path = public as $$
declare
  target uuid; bot uuid; tile record; laps int; rr record; done int := 0; stolen text[] := '{}';
begin
  select id into target from public.profiles where lower(username) = lower(target_username) and not is_bot;
  if target is null then return 'No such runner: ' || target_username; end if;
  for tile in
    with sc as (
      select tile_id, user_id, sum(km) km, min(lat) lat, min(lng) lng from public.tile_scores
      where day > (now() at time zone 'Asia/Singapore')::date - 30 group by tile_id, user_id),
    own as (select *, row_number() over (partition by tile_id order by km desc, user_id) rn from sc)
    select * from own where rn = 1 and user_id = target order by random() limit how_many
  loop
    select id into bot from public.profiles where is_bot order by random() limit 1;
    if bot is null then return 'No bots yet: run select public.seed_bots(); first'; end if;
    laps := ceil((tile.km + 0.3) / (2 * pi() * 45 / 1000.0) / 0.85)::int;
    select * into rr from public._bot_route(tile.lat, tile.lng, 0, 'raid', laps);
    perform public._bot_insert_run(bot, rr.route, rr.tiles, rr.total_km, now() - make_interval(mins => ceil(rr.total_km * 6)::int));
    stolen := stolen || tile.tile_id;
    done := done + 1;
  end loop;
  perform public._bot_refresh_stats();
  return format('Raided %s of %s''s tiles: %s', done, target_username, array_to_string(stolen, ', '));
end $$;

-- ---------- background activity (call hourly) ----------
-- Each bot has a small chance per hour to go for a run in its home town, and a smaller
-- chance to raid a random real runner's tile. Defaults ≈ 1 run every 2 days per bot.
create or replace function public.bots_tick(run_chance float8 default 0.02, raid_chance float8 default 0.004)
returns text language plpgsql security definer set search_path = public as $$
declare b record; town record; km float8; rr record; runs int := 0; raids int := 0; victim text;
begin
  for b in select id, home_town from public.profiles where is_bot loop
    if random() < run_chance then
      select * into town from public.towns where name = b.home_town;
      if town.name is null then select * into town from public.towns order by random() limit 1; end if;
      km := 3 + random() * 7;
      select * into rr from public._bot_route(town.lat, town.lng, km, 'walk');
      perform public._bot_insert_run(b.id, rr.route, rr.tiles, rr.total_km, now() - make_interval(mins => ceil(rr.total_km * 6)::int));
      runs := runs + 1;
    end if;
    if random() < raid_chance then
      select username into victim from public.profiles p
      where not p.is_bot and exists (select 1 from public.tile_scores s where s.user_id = p.id) order by random() limit 1;
      if victim is not null then perform public.bot_raid(victim, 1 + floor(random() * 3)::int); raids := raids + 1; end if;
    end if;
  end loop;
  perform public._bot_refresh_stats();
  return format('%s bot runs, %s raids', runs, raids);
end $$;

-- ---------- cleanup ----------
create or replace function public.delete_bots() returns text
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from public.profiles where is_bot;
  delete from auth.users where id in (select id from public.profiles where is_bot);  -- cascades to runs, tiles, posts
  return format('Deleted %s bots', n);
end $$;

-- Only the SQL Editor / cron (database owner) may run these
revoke all on function public._bot_route(float8, float8, float8, text, int) from public, anon, authenticated;
revoke all on function public._bot_insert_run(uuid, jsonb, jsonb, float8, timestamptz) from public, anon, authenticated;
revoke all on function public._bot_refresh_stats() from public, anon, authenticated;
revoke all on function public.seed_bots(int, text) from public, anon, authenticated;
revoke all on function public.bot_raid(text, int) from public, anon, authenticated;
revoke all on function public.bots_tick(float8, float8) from public, anon, authenticated;
revoke all on function public.delete_bots() from public, anon, authenticated;

-- ---------- optional: automatic hourly bot activity ----------
-- In Supabase: Database → Extensions → enable "pg_cron". Then run:
--   select cron.schedule('levelup-bots', '17 * * * *', $$select public.bots_tick()$$);
-- To stop it:
--   select cron.unschedule('levelup-bots');
