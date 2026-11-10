# Bot runners (for testing)

Bots are fake runners that claim tiles, appear on leaderboards and raid your tiles, so you can feel what LevelUp+ is like with other people on the map. They're clearly marked: usernames start with `bot_` and their avatar is 🤖. Real users can't pick a `bot_` username.

## Set up (once)
Supabase → **SQL Editor → New query** → paste all of `supabase/migrations/0005_bots.sql` → **Run**.

## Commands (paste into the SQL Editor, one at a time)

| What | Command |
|---|---|
| Create 20 bots, half around Yishun, each with 4 weeks of runs | `select public.seed_bots(20, 'Yishun');` |
| A bot takes 3 of your tiles right now | `select public.bot_raid('jaeakareborn', 3);` |
| One hour's worth of bot activity | `select public.bots_tick();` |
| A busy hour (lots of runs and raids) | `select public.bots_tick(0.5, 0.2);` |
| Remove all bots and everything they did | `select public.delete_bots();` |

After a raid, open **Territory → Battle** in the app. You'll see "@bot_x took N of your tiles", with those tiles outlined in red.

## Optional: bots run on their own every hour
1. Supabase → **Database → Extensions** → enable **pg_cron**.
2. In the SQL Editor:
   ```
   select cron.schedule('levelup-bots', '17 * * * *', $$select public.bots_tick()$$);
   ```
   Each bot then runs about every 2 days near its home town, and sometimes raids a real runner.
3. To stop: `select cron.unschedule('levelup-bots');`

**Before real testers join,** run `select public.delete_bots();` (and unschedule the cron job), or keep a few bots and tell testers they're bots.
