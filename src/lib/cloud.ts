// Cloud sync: runs + profile <-> Supabase. Runs (with GPS routes) are private
// to their owner; the profile row is the public "game card" (username, avatar,
// town, level) — never an email.
import type { Run, RunInput } from './game';
import { supabase } from './supabase';

export type CloudProfile = { username: string; avatar: string; home_town: string | null; weekly_goal_km: number; xp: number; level: number };

type RunRow = {
  client_id: string; started_at: string; duration_sec: number; km: number | string;
  route: any; tiles: any; source: 'app' | 'strava' | 'test' | 'health'; strava_id: number | null; xp?: number | null;
};

export const toRow = (r: Run | (RunInput & { id: string })): RunRow => ({
  client_id: r.id,
  started_at: new Date(r.startedAt).toISOString(),
  duration_sec: Math.round(r.durationSec),
  km: Math.round(r.km * 1000) / 1000,
  route: r.route ?? [],
  tiles: r.tiles ?? {},
  source: r.source ?? (r.test ? 'test' : 'app'),
  strava_id: r.stravaId ?? null,
  xp: 'xp' in r && typeof (r as Run).xp === 'number' ? (r as Run).xp : null,
});

export const fromRow = (row: RunRow): RunInput => ({
  startedAt: Date.parse(row.started_at), durationSec: row.duration_sec, km: Number(row.km),
  route: row.route ?? [], tiles: row.tiles ?? {}, source: row.source, stravaId: row.strava_id ?? undefined,
  test: row.source === 'test',
});

export async function fetchProfile(userId: string): Promise<CloudProfile | null> {
  const { data, error } = await supabase.from('profiles')
    .select('username, avatar, home_town, weekly_goal_km, xp, level').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data as CloudProfile | null;
}

export async function updateProfile(userId: string, patch: Partial<Omit<CloudProfile, 'username'>>) {
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
  if (error) throw error;
}

export async function fetchRuns(): Promise<RunRow[]> {
  const { data, error } = await supabase.from('runs')
    .select('client_id, started_at, duration_sec, km, route, tiles, source, strava_id')
    .order('started_at', { ascending: false }).limit(1000);
  if (error) throw error;
  return (data ?? []) as RunRow[];
}

/** Uploads runs; ones already saved (same client_id) are skipped. */
export async function uploadRuns(rows: RunRow[]) {
  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await supabase.from('runs').upsert(rows.slice(i, i + 50), { onConflict: 'user_id,client_id', ignoreDuplicates: true });
    if (error) throw error;
  }
}

export async function deleteRunCloud(clientId: string) {
  const { error } = await supabase.from('runs').delete().eq('client_id', clientId);
  if (error) throw error;
}

export async function deleteAllRunsCloud(userId: string) {
  const { error } = await supabase.from('runs').delete().eq('user_id', userId);
  if (error) throw error;
}
