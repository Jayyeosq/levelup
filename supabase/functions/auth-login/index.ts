// LevelUp+ — log in with a USERNAME (Supabase Edge Function, name: "auth-login").
// The phone sends { username, password }. We look up the email on the server,
// sign in, and return only the session tokens — the email never leaves the server.
// Deploy with --no-verify-jwt (people aren't logged in yet when they call this).

const URL_ = Deno.env.get('SUPABASE_URL') ?? '';
const firstKey = (v?: string) => { try { const o = JSON.parse(v ?? ''); return Object.values(o)[0] as string; } catch { return v ?? ''; } };
const SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || firstKey(Deno.env.get('SUPABASE_SECRET_KEYS'));
const PUBLIC = Deno.env.get('SUPABASE_ANON_KEY') || firstKey(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS'));

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, authorization, apikey' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const WRONG = { error: 'Wrong username or password.' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ ok: true, service: 'LevelUp+ login' });
  if (!URL_ || !SECRET || !PUBLIC) return json({ error: 'Login server is missing its keys.' }, 500);

  const { username, password } = await req.json().catch(() => ({}));
  if (typeof username !== 'string' || typeof password !== 'string' || !/^[A-Za-z0-9_]{3,20}$/.test(username) || !password) return json(WRONG, 400);

  const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' };

  // 1) username -> user id (server-only database function)
  const r1 = await fetch(`${URL_}/rest/v1/rpc/user_id_for_username`, { method: 'POST', headers: admin, body: JSON.stringify({ u: username }) });
  const userId = r1.ok ? await r1.json() : null;
  if (!userId) return json(WRONG, 400);

  // 2) user id -> email (admin API, stays on the server)
  const r2 = await fetch(`${URL_}/auth/v1/admin/users/${userId}`, { headers: admin });
  const email = r2.ok ? (await r2.json())?.email : null;
  if (!email) return json(WRONG, 400);

  // 3) sign in with email + password
  const r3 = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: PUBLIC, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  const s = await r3.json().catch(() => ({}));
  if (!r3.ok || !s.access_token) {
    if (s?.error_code === 'email_not_confirmed' || /confirm/i.test(s?.msg ?? '')) return json({ error: 'Please confirm your email first (check your inbox).' }, 400);
    return json(WRONG, 400);
  }
  return json({ access_token: s.access_token, refresh_token: s.refresh_token });
});
