// LevelUp+ — Strava login server (Supabase Edge Function, name: "strava-auth").
// Keeps the Strava Client Secret off users' phones.
//
// Routes:
//   GET  /strava-auth/start?redirect=<app link>   → sends the user to Strava's login/authorize page
//   GET  /strava-auth/callback?code=…&state=…     → Strava returns here; we swap the code for tokens
//                                                   and send the user back into the app
//   POST /strava-auth/refresh {refresh_token}     → gives the app a fresh access token
//
// Secrets to set in Supabase: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET
// IMPORTANT: turn OFF "Verify JWT" for this function (browsers can't send a login header).

const CLIENT_ID = Deno.env.get('STRAVA_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('STRAVA_CLIENT_SECRET') ?? '';
const BASE = `${Deno.env.get('SUPABASE_URL')}/functions/v1/strava-auth`;

// Only ever send people back to our own app (Expo Go during testing, or the real app).
const ALLOWED = [/^exps?:\/\//, /^levelup:\/\//, /^levelup-dev:\/\//];
const safeRedirect = (r: string | null) => (r && ALLOWED.some((re) => re.test(r)) ? r : null);

const b64e = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64d = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

function backToApp(appUrl: string, params: Record<string, string>) {
  const u = appUrl + (appUrl.includes('?') ? '&' : '?') + new URLSearchParams(params).toString();
  return new Response(null, { status: 302, headers: { Location: u } });
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...body }).toString(),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, authorization, apikey' };

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (!CLIENT_ID || !CLIENT_SECRET) return new Response('Server not configured: add STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET secrets.', { status: 500 });

  // 1) Start: bounce to Strava
  if (path.endsWith('/start')) {
    const redirect = safeRedirect(url.searchParams.get('redirect'));
    if (!redirect) return new Response('Bad redirect', { status: 400 });
    const q = new URLSearchParams({
      client_id: CLIENT_ID, response_type: 'code', redirect_uri: `${BASE}/callback`,
      approval_prompt: 'auto', scope: 'read,activity:read_all',
      state: b64e(JSON.stringify({ r: redirect, n: crypto.randomUUID() })),
    });
    return new Response(null, { status: 302, headers: { Location: `https://www.strava.com/oauth/authorize?${q}` } });
  }

  // 2) Callback from Strava
  if (path.endsWith('/callback')) {
    let redirect: string | null = null;
    try { redirect = safeRedirect(JSON.parse(b64d(url.searchParams.get('state') ?? '')).r); } catch { /* ignore */ }
    if (!redirect) return new Response('Bad state', { status: 400 });
    const err = url.searchParams.get('error');
    if (err) return backToApp(redirect, { error: err });
    const scope = url.searchParams.get('scope') ?? '';
    if (!scope.includes('activity:read')) return backToApp(redirect, { error: 'missing_activity_permission' });
    const code = url.searchParams.get('code');
    if (!code) return backToApp(redirect, { error: 'no_code' });
    const { ok, json } = await tokenRequest({ code, grant_type: 'authorization_code' });
    if (!ok) return backToApp(redirect, { error: json?.message ?? 'token_exchange_failed' });
    return backToApp(redirect, {
      access_token: json.access_token, refresh_token: json.refresh_token, expires_at: String(json.expires_at),
      athlete_id: String(json.athlete?.id ?? ''), firstname: json.athlete?.firstname ?? '', lastname: json.athlete?.lastname ?? '',
    });
  }

  // 3) Refresh
  if (path.endsWith('/refresh') && req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    if (!body?.refresh_token) return new Response(JSON.stringify({ error: 'refresh_token required' }), { status: 400, headers: cors });
    const { ok, json } = await tokenRequest({ refresh_token: body.refresh_token, grant_type: 'refresh_token' });
    return new Response(JSON.stringify(ok ? { access_token: json.access_token, refresh_token: json.refresh_token, expires_at: json.expires_at } : { error: json?.message ?? 'refresh_failed' }),
      { status: ok ? 200 : 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  return new Response('LevelUp+ auth server is running ✅', { status: 200, headers: cors });
});
