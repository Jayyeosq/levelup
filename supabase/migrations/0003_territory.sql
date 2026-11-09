-- LevelUp+ — Area Battle: shared territory, tile owners, King of each town (MVP part 3)
-- Run once in Supabase: SQL Editor → New query → paste → Run. Safe to run again.
--
-- How it works:
--   • Every run's tiles (tile id → km) are copied into tile_scores by the server.
--   • A tile belongs to whoever ran the most km in it over the last 30 days.
--   • The King of a town is whoever holds the most tiles in that town.
-- Privacy:
--   • Tiles within ~2 hexes (~300 m) of where each run STARTS and ENDS are never shown
--     to others, so the map can't reveal where someone lives.
--   • Runs imported from Strava never count on the shared map (Strava's API rules).
--   • tile_scores can't be read directly; the app only gets owners' usernames and km totals.

-- ---------- hex grid (same maths as src/lib/geo.ts) ----------
create or replace function public.hex_of(lat float8, lng float8, out q int, out r int)
language plpgsql immutable as $$
declare
  mlat constant float8 := 110574;
  mlng constant float8 := 111320 * cos(radians(1.3521));
  rad  constant float8 := 90;
  x float8; y float8; qf float8; rf float8; sf float8; si int; dq float8; dr float8; ds float8;
begin
  x := (lng - 103.8198) * mlng;
  y := (lat - 1.3521) * mlat;
  qf := ((sqrt(3) / 3) * x - y / 3) / rad;
  rf := ((2.0 / 3) * y) / rad;
  sf := -qf - rf;
  q := floor(qf + 0.5); r := floor(rf + 0.5); si := floor(sf + 0.5);   -- same rounding as JS Math.round
  dq := abs(q - qf); dr := abs(r - rf); ds := abs(si - sf);
  if dq > dr and dq > ds then q := -r - si;
  elsif dr > ds then r := -q - si;
  end if;
end $$;

create or replace function public.hex_center(q int, r int, out lat float8, out lng float8)
language sql immutable as $$
  select 1.3521 + (90 * 1.5 * r) / 110574.0,
         103.8198 + (90 * sqrt(3) * (q + r / 2.0)) / (111320 * cos(radians(1.3521)));
$$;

create or replace function public.hex_dist(q1 int, r1 int, q2 int, r2 int) returns int
language sql immutable as $$ select (abs(q1 - q2) + abs(r1 - r2) + abs(q1 + r1 - q2 - r2)) / 2 $$;

-- ---------- towns ----------
create table if not exists public.towns (name text primary key, lat float8 not null, lng float8 not null);
alter table public.towns enable row level security;
drop policy if exists "towns readable" on public.towns;
create policy "towns readable" on public.towns for select to authenticated using (true);
insert into public.towns (name, lat, lng) values
  ('Ang Mo Kio',1.3691,103.8454),('Bedok',1.3236,103.9273),('Bishan',1.3508,103.8485),('Bukit Batok',1.359,103.7637),
  ('Bukit Merah',1.2819,103.8239),('Bukit Panjang',1.3774,103.7719),('Bukit Timah',1.3294,103.8021),('Choa Chu Kang',1.384,103.747),
  ('Clementi',1.3162,103.7649),('Geylang',1.3201,103.8918),('Hougang',1.3612,103.8863),('Jurong East',1.3329,103.7436),
  ('Jurong West',1.3404,103.709),('Kallang',1.31,103.8651),('Marine Parade',1.302,103.9072),('Pasir Ris',1.3721,103.9474),
  ('Punggol',1.3984,103.9072),('Queenstown',1.2942,103.7861),('Sembawang',1.4491,103.8185),('Sengkang',1.3868,103.8914),
  ('Serangoon',1.3554,103.8679),('Tampines',1.3496,103.9568),('Toa Payoh',1.3343,103.8563),('Woodlands',1.4382,103.789),
  ('Yishun',1.4304,103.8354),('Downtown',1.284,103.851)
on conflict (name) do nothing;

create or replace function public.town_of(lat float8, lng float8) returns text
language sql stable set search_path = public as $$
  select case when sqrt(d) * 110574 > 6000 then 'Outside SG towns' else name end
  from (select name, (t.lat - town_of.lat) ^ 2 + ((t.lng - town_of.lng) * cos(radians(t.lat))) ^ 2 as d from public.towns t) x
  order by d limit 1;
$$;

-- ---------- tile scores (server-maintained, not readable directly) ----------
create table if not exists public.tile_scores (
  run_id   uuid not null references public.runs (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  tile_id  text not null,
  q        int  not null,
  r        int  not null,
  lat      float8 not null,
  lng      float8 not null,
  town     text not null,
  day      date not null,
  km       numeric(8,3) not null,
  primary key (run_id, tile_id)
);
create index if not exists tile_scores_day on public.tile_scores (day);
create index if not exists tile_scores_box on public.tile_scores (lat, lng);
create index if not exists tile_scores_tile on public.tile_scores (tile_id);
create index if not exists tile_scores_user on public.tile_scores (user_id, day);
alter table public.tile_scores enable row level security;   -- no policies: only the functions below read it

create or replace function public.index_run_tiles(p_run uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  rr public.runs%rowtype;
  sq int; sr int; eq int; er int; trim_ends boolean := false;
begin
  delete from public.tile_scores where run_id = p_run;
  select * into rr from public.runs where id = p_run;
  if not found or rr.source = 'strava' or jsonb_typeof(rr.tiles) <> 'object' then return; end if;
  if jsonb_typeof(rr.route) = 'array' and jsonb_array_length(rr.route) > 0 then
    select h.q, h.r into sq, sr from public.hex_of((rr.route -> 0 ->> 'latitude')::float8, (rr.route -> 0 ->> 'longitude')::float8) h;
    select h.q, h.r into eq, er from public.hex_of((rr.route -> -1 ->> 'latitude')::float8, (rr.route -> -1 ->> 'longitude')::float8) h;
    trim_ends := true;
  end if;
  insert into public.tile_scores (run_id, user_id, tile_id, q, r, lat, lng, town, day, km)
  select rr.id, rr.user_id, t.tile_id, t.q, t.r, c.lat, c.lng, public.town_of(c.lat, c.lng),
         (rr.started_at at time zone 'Asia/Singapore')::date, t.km
  from (
    select key as tile_id, split_part(key, ':', 1)::int as q, split_part(key, ':', 2)::int as r, value::numeric as km
    from jsonb_each_text(rr.tiles)
    where key ~ '^-?\d+:-?\d+$' and value ~ '^[0-9.]+$'
  ) t
  cross join lateral public.hex_center(t.q, t.r) c
  where t.km > 0
    and (not trim_ends or (public.hex_dist(t.q, t.r, sq, sr) > 2 and public.hex_dist(t.q, t.r, eq, er) > 2));
end $$;
revoke all on function public.index_run_tiles(uuid) from public, anon, authenticated;

create or replace function public.trg_index_run_tiles() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public.index_run_tiles(new.id); return new; end $$;
drop trigger if exists runs_index_tiles on public.runs;
create trigger runs_index_tiles after insert on public.runs for each row execute function public.trg_index_run_tiles();
-- (deleting a run deletes its tile_scores automatically)

-- Backfill runs saved before this migration
do $$ declare x uuid; begin
  for x in select id from public.runs where not exists (select 1 from public.tile_scores s where s.run_id = runs.id) loop
    perform public.index_run_tiles(x);
  end loop;
end $$;

-- ---------- read functions for the app ----------
-- Tile owners inside the visible map area (max ~30 km across).
create or replace function public.territory_in_box(min_lat float8, min_lng float8, max_lat float8, max_lng float8)
returns table (tile_id text, owner_id uuid, username text, avatar text, owner_km numeric, my_km numeric, contenders bigint, is_mine boolean)
language sql stable security definer set search_path = public as $$
  with sc as (
    select s.tile_id, s.user_id, sum(s.km) as km
    from public.tile_scores s
    where s.day > (now() at time zone 'Asia/Singapore')::date - 30
      and s.lat between min_lat and max_lat and s.lng between min_lng and max_lng
      and (max_lat - min_lat) <= 0.3 and (max_lng - min_lng) <= 0.3
    group by s.tile_id, s.user_id
  ),
  ranked as (
    select sc.*, row_number() over (partition by sc.tile_id order by sc.km desc, sc.user_id) as rn,
           count(*) over (partition by sc.tile_id) as contenders
    from sc
  )
  select r.tile_id, r.user_id, p.username, p.avatar, round(r.km, 2), round(coalesce(m.km, 0), 2), r.contenders, r.user_id = auth.uid()
  from ranked r
  join public.profiles p on p.id = r.user_id
  left join sc m on m.tile_id = r.tile_id and m.user_id = auth.uid()
  where r.rn = 1
  limit 3000;
$$;
grant execute on function public.territory_in_box(float8, float8, float8, float8) to authenticated;

-- Every tile you've run in (last 30 days) and who owns it now — powers "X took your tiles".
create or replace function public.my_tiles()
returns table (tile_id text, my_km numeric, owner_id uuid, owner_username text, owner_km numeric)
language sql stable security definer set search_path = public as $$
  with mine as (
    select tile_id, sum(km) km from public.tile_scores
    where user_id = auth.uid() and day > (now() at time zone 'Asia/Singapore')::date - 30
    group by tile_id
  ),
  sc as (
    select s.tile_id, s.user_id, sum(s.km) km from public.tile_scores s
    where s.tile_id in (select tile_id from mine) and s.day > (now() at time zone 'Asia/Singapore')::date - 30
    group by s.tile_id, s.user_id
  ),
  ranked as (select sc.*, row_number() over (partition by tile_id order by km desc, user_id) rn from sc)
  select m.tile_id, round(m.km, 2), r.user_id, p.username, round(r.km, 2)
  from mine m join ranked r on r.tile_id = m.tile_id and r.rn = 1 join public.profiles p on p.id = r.user_id;
$$;
grant execute on function public.my_tiles() to authenticated;

-- King of each town (most tiles held), plus how many tiles you hold there.
create or replace function public.town_kings()
returns table (town text, king_id uuid, king_username text, king_avatar text, king_tiles bigint, my_tiles bigint, total_tiles bigint)
language sql stable security definer set search_path = public as $$
  with sc as (
    select tile_id, user_id, min(town) town, sum(km) km from public.tile_scores
    where day > (now() at time zone 'Asia/Singapore')::date - 30
    group by tile_id, user_id
  ),
  owners as (
    select tile_id, user_id, town from (
      select sc.*, row_number() over (partition by tile_id order by km desc, user_id) rn from sc
    ) x where rn = 1
  ),
  counts as (select town, user_id, count(*) tiles from owners group by town, user_id),
  best as (select counts.*, row_number() over (partition by town order by tiles desc, user_id) rn from counts),
  totals as (select town, count(*) total from owners group by town)
  select b.town, b.user_id, p.username, p.avatar, b.tiles,
         coalesce((select c.tiles from counts c where c.town = b.town and c.user_id = auth.uid()), 0),
         t.total
  from best b join public.profiles p on p.id = b.user_id join totals t on t.town = b.town
  where b.rn = 1 and b.town <> 'Outside SG towns'
  order by b.town;
$$;
grant execute on function public.town_kings() to authenticated;
