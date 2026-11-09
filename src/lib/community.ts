// Community: friends, activity feed, kudos, weekly leaderboard.
// Everything here is limited by the database privacy rules (0002_community.sql):
// you only ever get usernames, never emails or routes.
import { supabase } from './supabase';

export type Runner = { id: string; username: string; avatar: string; home_town: string | null; level: number };

export type FriendRow = {
  id: string; status: 'pending' | 'accepted'; requester: string; addressee: string;
  other: Runner; incoming: boolean;
};

export async function findRunner(username: string): Promise<Runner | null> {
  const { data, error } = await supabase.rpc('find_runner', { u: username.trim().replace(/^@/, '') });
  if (error) throw error;
  return (data?.[0] as Runner) ?? null;
}

export async function listFriendships(me: string): Promise<FriendRow[]> {
  const { data, error } = await supabase.from('friendships').select('id, status, requester, addressee').order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => (r.requester === me ? r.addressee : r.requester)))];
  if (!ids.length) return [];
  const { data: profs, error: e2 } = await supabase.from('profiles').select('id, username, avatar, home_town, level').in('id', ids);
  if (e2) throw e2;
  const byId = new Map((profs ?? []).map((p) => [p.id, p as Runner]));
  return rows
    .map((r) => {
      const otherId = r.requester === me ? r.addressee : r.requester;
      return { ...r, other: byId.get(otherId)!, incoming: r.addressee === me } as FriendRow;
    })
    .filter((r) => r.other);
}

/** Sends a request — or accepts theirs if they already asked you. */
export async function addFriend(me: string, other: Runner, existing: FriendRow[]): Promise<'sent' | 'accepted' | 'already'> {
  if (other.id === me) throw new Error("That's you.");
  const f = existing.find((x) => x.other.id === other.id);
  if (f?.status === 'accepted') return 'already';
  if (f && f.incoming) { await acceptFriend(f.id); return 'accepted'; }
  if (f) return 'already';
  const { error } = await supabase.from('friendships').insert({ addressee: other.id });
  if (error) throw error;
  return 'sent';
}

export async function acceptFriend(id: string) {
  const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', id);
  if (error) throw error;
}

export async function removeFriendship(id: string) {
  const { error } = await supabase.from('friendships').delete().eq('id', id);
  if (error) throw error;
}

// ---------- feed ----------
export type Activity = {
  id: string; user_id: string; kind: 'run' | 'level_up' | 'badge'; data: any; created_at: string;
  profiles: { username: string; avatar: string } | null;
  kudos: { user_id: string }[];
};

export async function fetchFeed(): Promise<Activity[]> {
  const { data, error } = await supabase.from('activities')
    .select('id, user_id, kind, data, created_at, profiles(username, avatar), kudos(user_id)')
    .order('created_at', { ascending: false }).limit(60);
  if (error) throw error;
  return (data ?? []) as unknown as Activity[];
}

export async function postActivities(rows: { kind: Activity['kind']; data: Record<string, unknown>; run_client_id?: string }[]) {
  if (!rows.length) return;
  const { error } = await supabase.from('activities').insert(rows);
  if (error) throw error;
}

export async function deleteActivitiesForRun(clientId: string) {
  await supabase.from('activities').delete().eq('run_client_id', clientId);
}

export async function setKudos(activityId: string, give: boolean) {
  const q = give
    ? supabase.from('kudos').insert({ activity_id: activityId })
    : supabase.from('kudos').delete().eq('activity_id', activityId).eq('user_id', (await supabase.auth.getUser()).data.user?.id ?? '');
  const { error } = await q;
  if (error && !/duplicate/i.test(error.message)) throw error;
}

// ---------- leaderboard ----------
export type Scope = 'friends' | 'town' | 'all';
export type LeaderRow = { rank: number; user_id: string; username: string; avatar: string; home_town: string | null; level: number; week_xp: number; is_me: boolean };

export async function fetchLeaderboard(scope: Scope): Promise<LeaderRow[]> {
  const { data, error } = await supabase.rpc('weekly_leaderboard', { scope });
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({ ...r, rank: Number(r.rank), week_xp: Number(r.week_xp) }));
}

export async function deleteAllMyActivities(userId: string) {
  await supabase.from('activities').delete().eq('user_id', userId);
}
