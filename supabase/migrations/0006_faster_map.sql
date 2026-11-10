-- LevelUp+ — faster Battle map query (fixes "canceling statement due to statement timeout")
-- Run once in Supabase SQL Editor. Safe to run again.
-- The old version looked up "your km" with a self-join that the planner ran row-by-row
-- (1,000 tiles × 4,000 scores). This version gets it in the same pass with a window function.

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
    select sc.*,
           row_number() over w_rank as rn,
           count(*) over w_tile as contenders,
           coalesce(max(case when sc.user_id = auth.uid() then sc.km end) over w_tile, 0) as mine
    from sc
    window w_tile as (partition by sc.tile_id),
           w_rank as (partition by sc.tile_id order by sc.km desc, sc.user_id)
  )
  select r.tile_id, r.user_id, p.username, p.avatar, round(r.km, 2), round(r.mine, 2), r.contenders, r.user_id = auth.uid()
  from ranked r
  join public.profiles p on p.id = r.user_id
  where r.rn = 1
  limit 3000;
$$;
grant execute on function public.territory_in_box(float8, float8, float8, float8) to authenticated;

create index if not exists tile_scores_day_box on public.tile_scores (day, lat, lng);
analyze public.tile_scores;
