# One-time setup: accounts and cloud sync (about 10 minutes)

All of this happens in your Supabase project `xmaioptoygjbcrwhszkk` at https://supabase.com/dashboard.

## 1. Create the database tables and privacy rules
1. In the dashboard, open **SQL Editor** and click **New query**.
2. Open `supabase/migrations/0001_accounts.sql` from this folder, copy **all** of it, and paste it in.
3. Click **Run**. You should see "Success. No rows returned".

It's safe to run again if you're not sure it worked.

## 2. Email settings (for testing)
Go to **Authentication → Sign In / Providers → Email**:
- Make sure **Email** is enabled.
- Turn **Confirm email** **OFF** for now, then Save. Sign-up then logs you in straight away.

**Turn Confirm email back ON before public launch.** Supabase's built-in email sender only allows a few emails per hour, so you'll need a real email provider then. Claude will help when it's time.

## 3. Copy your public app key
Go to **Project Settings → API Keys** and copy the **Publishable key** (it starts with `sb_publishable_`). If you only see "anon public", copy that instead.

Paste it into `app.json`:
```json
"supabaseKey": "sb_publishable_xxxxxxxx"
```
This key is **meant to be public**, because it's built into every copy of the app. The database privacy rules decide what each user can see. Never put the **secret** or **service_role** key in the app.

## 4. Deploy the username-login server
In Terminal, inside the `levelup-plus` folder:
```
npx supabase@3 functions deploy auth-login --no-verify-jwt --use-api --remote=xmaioptoygjbcrwhszkk
```
Choose **Yes** to confirm.

## 5. Restart the app
```
npx expo start --tunnel ngrok -c
```
Fully close Expo Go, then scan the new QR code.

## 6. Test it
1. **Sign up** with your email, a username (e.g. `RunnerJay`) and a password.
2. Your runs already on the phone are moved into your new account automatically.
3. In Supabase, go to **Table Editor → profiles**. You should see your username, and no email column anywhere.
4. Go to **Profile → Log out**, then log back in with your **username** instead of your email.
