# One-time Strava setup (you, the developer, do this once)

Your users never see any of this. They just tap **Connect with Strava → Authorize** and they're back in the app.

You'll set up two things:
- **A Strava API app**, which gives you a Client ID and a Client Secret. It needs a Strava subscription.
- **A free Supabase project**, which runs the small login server that keeps the Secret safe. This is also the backend for Phase 2.

---

## 1. Create a Supabase project (free)

1. Sign up at https://supabase.com and create a **New project**. Pick the Singapore region, and choose any database password (save it somewhere).
2. When it's ready, open **Project Settings → General** and copy the **Project ID** (also called the reference ID). It's about 20 letters, e.g. `abcdefghijklmnopqrst`.

Your login server address will be:
```
https://<PROJECT-ID>.supabase.co/functions/v1/strava-auth
```

## 2. Create the Strava API app

1. Go to https://www.strava.com/settings/api
2. Fill in:
   - **Application name:** LevelUp+
   - **Category:** Training
   - **Website:** any, e.g. `https://<PROJECT-ID>.supabase.co`
   - **Authorization Callback Domain:** `<PROJECT-ID>.supabase.co` ← important
3. Save. Keep this page open, because you'll need the **Client ID** and **Client Secret** in the next step.

## 3. Deploy the login server (Terminal, inside the strava-plus folder)

```
npx supabase@3 login
```
A browser window opens; approve it.

Add your Strava keys as secrets. Paste your own values in place of `XXXX` and `YYYY`:
```
npx supabase@3 secrets set STRAVA_CLIENT_ID=XXXX STRAVA_CLIENT_SECRET=YYYY --remote=<PROJECT-ID>
```

Deploy the server:
```
npx supabase@3 functions deploy strava-auth --no-verify-jwt --use-api --remote=<PROJECT-ID>
```
Type `y` if it asks you to confirm.

**Check that it works:** open `https://<PROJECT-ID>.supabase.co/functions/v1/strava-auth` in your browser. You should see **"LevelUp+ auth server is running ✅"**.

## 4. Point the app at the server

In `app.json`, set:
```json
"extra": {
  "stravaAuthServer": "https://<PROJECT-ID>.supabase.co/functions/v1/strava-auth"
}
```
Then restart with `npx expo start --tunnel ngrok`, and reload the app on your phone.

Done. On the phone, go to **Profile → Connect with Strava**.

---

### Good to know
- New Strava API apps allow **1 athlete** (you). In your Strava API settings you can raise this to **10** yourself, which is enough for beta testers. More than 10 needs Strava's review, which can take weeks.
- Strava only lets each user see their own Strava data. Imported runs count toward that user's own XP, levels and tiles, not toward public leaderboards.
