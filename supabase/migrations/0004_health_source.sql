-- LevelUp+ — allow runs imported from Apple Health / Health Connect.
-- Run once in Supabase SQL Editor. Safe to run again.
alter table public.runs drop constraint if exists runs_source_check;
alter table public.runs add constraint runs_source_check check (source in ('app', 'strava', 'test', 'health'));
notify pgrst, 'reload schema';
