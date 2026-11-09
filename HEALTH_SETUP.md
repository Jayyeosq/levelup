# Apple Health: build LevelUp+ as a real iPhone app (one-time, about 1 hour plus Apple's approval)

Apple Health doesn't work inside Expo Go. You need your own build of LevelUp+ (a "development build"), which installs on your iPhone like a normal app. You still edit and reload it from your Mac, the same as now.

Bonus: in this build, **run tracking keeps going with the screen locked**.

## 1. Join the Apple Developer Program (US$99/year)
1. Go to https://developer.apple.com/programs/enroll and enroll as an **Individual**.
2. Use your normal Apple ID. Two-factor authentication must be on.
3. Approval usually takes **1–2 days**. You'll get an email.

## 2. Run the database update
In Supabase, go to **SQL Editor → New query**, paste all of `supabase/migrations/0004_health_source.sql`, and click **Run**.

## 3. Connect the project to Expo (Terminal, in the levelup-plus folder)
```
npx expo login
npx eas-cli@latest init
```
Create a free Expo account if you don't have one. `init` adds a project ID to `app.json`. That's expected.

## 4. Register your iPhone
```
npx eas-cli@latest device:create
```
Choose **Website**. Open the link or QR code **on your iPhone**, tap **Allow**, then go to **Settings → General → VPN & Device Management** (or the "Profile Downloaded" banner in Settings) and **Install** the profile.

## 5. Build the app in the cloud (about 15–30 minutes)
```
npx eas-cli@latest build --profile development --platform ios
```
- When asked, **log in with your Apple ID**, and say **Yes** to letting EAS create certificates and profiles.
- You can close Terminal while it builds; you'll get a link when it's done.

## 6. Install it on your iPhone
1. Open the build link from step 5 **on your iPhone** and tap **Install**.
2. First time only: go to **Settings → Privacy & Security → Developer Mode**, turn it **on**, and restart the phone.
3. Open **LevelUp+**. It has its own icon, separate from Expo Go.

## 7. Run it
On your Mac:
```
npx expo start --dev-client --tunnel ngrok
```
Open the **LevelUp+** app on your iPhone (not Expo Go). It finds your Mac automatically, or you can scan the QR code with the iPhone Camera.

## 8. Connect Apple Health
Go to **Profile → Apple Health → Connect Apple Health**, read the consent screen, tap **Agree and connect**, and allow **Workouts** and **Workout Routes** on Apple's sheet. Your last 90 days of runs are imported, and new watch runs sync automatically whenever you open the app.

### Good to know
- You only need to rebuild (step 5) when native features change. Normal code updates still reload over the tunnel.
- Each tester's iPhone must be registered (step 4) before a build will install on it, up to 100 devices. For a bigger group, use TestFlight later.
- Runs that Strava wrote into Apple Health are skipped automatically.
- If the same run comes from both your phone and your watch, it's counted once.
