-- LevelUp+ — a tapped notification opens the right screen; nudges are capped per receiver
-- Run once in Supabase SQL Editor, after 0009. Safe to run again.
--   • Tile alerts still open the Battle map. A nudge now opens the Run tab.
--   • Nobody receives more than 3 nudges a day, however many friends they have.

drop function if exists public._send_push(uuid, text, text);

create or replace function public._send_push(p_user uuid, p_title text, p_body text, p_screen text default 'territory') returns boolean
language plpgsql security definer set search_path = public as $$
declare v_msgs jsonb;
begin
  select jsonb_agg(jsonb_build_object('to', token, 'title', p_title, 'body', p_body, 'sound', 'default',
                                      'data', jsonb_build_object('screen', p_screen)))
    into v_msgs from public.push_tokens where user_id = p_user;
  if v_msgs is null then return false; end if;
  perform net.http_post(url := 'https://exp.host/--/api/v2/push/send', body := v_msgs,
                        headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb);
  return true;
exception when others then
  raise warning 'LevelUp+ push failed: %', sqlerrm;
  return false;
end $$;
revoke all on function public._send_push(uuid, text, text, text) from public, anon, authenticated;

-- Returns 'sent', 'already' (you nudged them today), 'full' (they've had 3 nudges today),
-- 'no_phone' (they haven't turned alerts on) or 'not_friends'.
create or replace function public.nudge_friend(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_name text; v_today date := (now() at time zone 'Asia/Singapore')::date;
begin
  if v_me is null or p_user = v_me or not public.are_friends(v_me, p_user) then return 'not_friends'; end if;
  if exists (select 1 from public.nudges where from_id = v_me and to_id = p_user and day = v_today) then return 'already'; end if;
  if not exists (select 1 from public.push_tokens where user_id = p_user) then return 'no_phone'; end if;
  if (select count(*) from public.nudges where to_id = p_user and day = v_today) >= 3 then return 'full'; end if;
  insert into public.nudges (from_id, to_id, day) values (v_me, p_user, v_today);
  select username into v_name from public.profiles where id = v_me;
  perform public._send_push(p_user, format('@%s nudged you', v_name), 'Time for a run? Your tiles won''t defend themselves.', 'run');
  return 'sent';
end $$;
revoke all on function public.nudge_friend(uuid) from public, anon;
grant execute on function public.nudge_friend(uuid) to authenticated;

notify pgrst, 'reload schema';
