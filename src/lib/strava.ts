// Strava connection.
// The user just taps "Connect with Strava": a Strava login sheet opens, they tap
// Authorize, and they're sent back to the app. The Client Secret lives on our
// small server (supabase/functions/strava-auth), never on users' phones.
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import type { RunInput } from './game';
import { decodePolyline, kmPerTile, simplify } from './geo';

/** Set in app.json → expo.extra.stravaAuthServer */
export const AUTH_SERVER: string = (Constants.expoConfig?.extra as any)?.stravaAuthServer ?? '';
export const isConfigured = () => /^https:\/\//.test(AUTH_SERVER);

const TOK = 'strava.tokens';
export type StravaTokens = {
  access_token: string; refresh_token: string; expires_at: number;
  athlete?: { id: number; firstname?: string; lastname?: string };
};

export async function loadTokens(): Promise<StravaTokens | null> {
  try { const v = await SecureStore.getItemAsync(TOK); return v ? JSON.parse(v) : null; } catch { return null; }
}
const saveTokens = (t: StravaTokens) => SecureStore.setItemAsync(TOK, JSON.stringify(t));

const ERRORS: Record<string, string> = {
  access_denied: 'You cancelled the connection.',
  missing_activity_permission: 'Please leave "View data about your activities" ticked so your runs can be imported.',
};

/** Opens the Strava login sheet. Resolves with tokens, or null if the user closed it. */
export async function connect(): Promise<StravaTokens | null> {
  if (!isConfigured()) throw new Error('Strava login server is not set up yet.');
  const returnUrl = Linking.createURL('strava-connected');
  const res = await WebBrowser.openAuthSessionAsync(`${AUTH_SERVER}/start?redirect=${encodeURIComponent(returnUrl)}`, returnUrl);
  if (res.type !== 'success') return null;
  const q = Linking.parse(res.url).queryParams ?? {};
  const get = (k: string) => (typeof q[k] === 'string' ? (q[k] as string) : '');
  if (get('error')) throw new Error(ERRORS[get('error')] ?? `Strava: ${get('error')}`);
  if (!get('access_token')) throw new Error('Strava did not return a login. Please try again.');
  const t: StravaTokens = {
    access_token: get('access_token'), refresh_token: get('refresh_token'), expires_at: Number(get('expires_at')),
    athlete: { id: Number(get('athlete_id')), firstname: get('firstname'), lastname: get('lastname') },
  };
  await saveTokens(t);
  return t;
}

async function validToken(): Promise<string> {
  const t = await loadTokens();
  if (!t) throw new Error('Not connected to Strava.');
  if (t.expires_at * 1000 > Date.now() + 60_000) return t.access_token;
  const res = await fetch(`${AUTH_SERVER}/refresh`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: t.refresh_token }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error('Your Strava login expired. Please disconnect and connect again.');
  await saveTokens({ ...t, ...j });
  return j.access_token;
}

type StravaActivity = {
  id: number; sport_type?: string; type?: string; distance: number; moving_time: number;
  start_date: string; map?: { summary_polyline?: string | null }; manual?: boolean;
};
const RUN_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun']);

/** Fetches your runs from the last `days` days and converts them to game runs. */
export async function fetchRuns(days: number, onProgress?: (n: number) => void): Promise<RunInput[]> {
  const token = await validToken();
  const after = Math.floor((Date.now() - days * 86_400_000) / 1000);
  const out: RunInput[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 429) throw new Error('Strava rate limit reached — try again in 15 minutes.');
    if (!res.ok) throw new Error(`Couldn't load activities from Strava (${res.status}).`);
    const list = (await res.json()) as StravaActivity[];
    for (const a of list) {
      if (!RUN_TYPES.has(a.sport_type ?? a.type ?? '')) continue;
      const route = a.map?.summary_polyline ? decodePolyline(a.map.summary_polyline) : [];
      out.push({
        startedAt: Date.parse(a.start_date), durationSec: a.moving_time, km: a.distance / 1000,
        route: simplify(route), tiles: route.length > 1 ? kmPerTile(route) : {}, source: 'strava', stravaId: a.id,
      });
    }
    onProgress?.(out.length);
    if (list.length < 100) break;
  }
  return out;
}

export async function disconnect() {
  const t = await loadTokens();
  if (t) {
    try {
      await fetch('https://www.strava.com/oauth/deauthorize', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `access_token=${encodeURIComponent(t.access_token)}`,
      });
    } catch {}
  }
  await SecureStore.deleteItemAsync(TOK);
}
