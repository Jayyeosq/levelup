# LevelUp+ (Phase 1)

A running app with game mechanics: run → earn XP → level up → unlock titles and badges → claim hex tiles on the map of Singapore.

## Run it on your phone (about 10 minutes the first time)

**On your laptop**

1. Install **Node.js** (the "LTS" version) from https://nodejs.org
2. Unzip this folder somewhere easy, e.g. your Desktop.
3. Open a terminal in the folder:
   - **Mac:** open Terminal, type `cd ` (with a space), drag the folder into the window, press Enter.
   - **Windows:** open the folder, click the address bar, type `cmd`, press Enter.
4. Run these two commands (the first one takes a few minutes, but only the first time):
   ```
   npm install
   npx expo start
   ```
   A QR code appears in the terminal.

**On your phone**

5. Install **Expo Go** from the App Store or Google Play.
6. Scan the QR code:
   - **iPhone:** use the normal Camera app, then tap the banner.
   - **Android:** open Expo Go and tap "Scan QR code".
7. When asked, allow location **"While Using the App"**.

Your phone and laptop must be on the **same Wi-Fi**. If the QR code won't connect, stop with `Ctrl+C` and run `npx expo start --tunnel` instead.

The laptop only needs to be on while you load the app. After it opens, you can take the phone out for a run. If Expo Go reloads, it needs the laptop again.

## What's in Phase 1

- **Live GPS tracking:** distance, time, pace, your route on the map, and pause/resume.
- **XP:** 10 XP per km, plus bonuses for streaks, runs that start before 8am, personal bests, new tiles and badges.
- **Levels and titles:** Shuffler → Jogger → Pacer → Strider → Road Warrior → Legend.
- **12 badges** and **streak freezes** (earn 1 for every 7-day streak).
- **Territory:** Singapore is split into hexes about 170 m wide, and every hex you run through is yours for 30 days. The app shows which towns you hold the most tiles in.
- **Anti-cheat:** GPS jumps are ignored, and a run that averages faster than 2:30/km doesn't count.
- **History:** long-press a run to delete it. XP, streaks and tiles are then recalculated.
- **Accounts:** sign up with email + username + password; log in with email **or** username. Other runners only ever see your username. Runs and profile sync to your account (setup: **ACCOUNTS_SETUP.md**).
- **Profile tab:** set your name, avatar, home town and a weekly km goal. Progress toward the goal shows on the Run tab.
- **Connect with Strava** (Profile tab): one tap → Strava login → Authorize → back in the app. Then import your runs from the last 30 days, 90 days or 1 year. They earn XP, badges and tiles like normal, and no run is ever imported twice. One-time developer setup: see **STRAVA_SETUP.md**.
- **Tester tools** (on the Progress tab): add a fake run near you to test indoors, or reset everything.

All data is saved **on your phone only** for now.

## Known limits in Expo Go

- **Keep the app open while running.** The screen stays on while tracking. Expo Go on iPhone can't track with the screen locked. That needs a "development build", which is part of Phase 2 (the app is already set up for it: background location permissions are configured).
- Android in Expo Go may show a notification while tracking. That's normal.

## Phase 2 (next)

Accounts and an online database (Supabase), real players on the map, a "King of <town>" title for whoever holds the most tiles, weekly leagues against real people, push notifications ("someone took your tiles"), tracking with the screen locked, and Apple Health / Health Connect import.

## Project structure

```
index.ts                 starts the background GPS task, then the app
app.json                 app name, permissions
src/app/                 screens (Expo Router: one file = one tab)
  _layout.tsx            tab bar
  index.tsx              Run tab (start/track/finish)
  territory.tsx          Territory map
  progress.tsx           Level, badges, titles, tester tools
  history.tsx            Past runs
  profile.tsx            Profile + Strava connection
src/lib/
  game.ts                all game rules (XP, levels, badges, streaks, tiles)
  geo.ts                 distance + the Singapore hex grid
  tracker.ts             GPS tracking and filtering
  store.tsx              saving data on the phone
  strava.ts              Strava login + run import
supabase/functions/strava-auth/   small login server that keeps the Strava secret safe
supabase/functions/auth-login/    username login (keeps emails private)
supabase/migrations/              database tables + privacy rules
src/lib/auth.tsx, cloud.ts        accounts + cloud sync
src/components/ui.tsx    shared UI pieces and colours
```

To change the game balance, edit the numbers at the top of `src/lib/game.ts`.
