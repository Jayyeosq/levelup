-- 0011: each runner's own accent colour for the app (orange by default).
alter table public.profiles add column if not exists accent text not null default 'orange';

notify pgrst, 'reload schema';
