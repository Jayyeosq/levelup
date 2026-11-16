// Community: friends, activity feed, kudos, weekly leaderboard.
// Everything here is limited by the database privacy rules (0002_community.sql):
// you only ever get usernames, never emails or routes.
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from './supabase';

// ---------- friend requests waiting for you (badge on the Community tab) ----------
let pending = 0;
const pendingSubs = new Set<(n: number) => void>();
const setPending = (n: number) => { pending = n; pendingSubs.forEach((f) => f(n)); };

export async function refreshRequests(me: string | null): Promise<void> {
  if (!me) { setPending(0); return; }
  const { count, error } = await supabase.from('friendships').select('id', { count: 'exact', head: true }).eq('addressee', me).eq('status', 'pending');
  if (!error) setPending(count ?? 0);
}

/** Number of incoming friend requests. With `poll`, also keeps it fresh (use once, in the tab bar). */
export function usePendingRequests(me: string | null, poll = false): number {
  const [n, setN] = useState(pending);
  useEffect(() => {
    pendingSubs.add(setN);
    setN(pending);
    if (!poll) return () => { pendingSubs.delete(setN); };
    const go = () => { refreshRequests(me).catch(() => {}); };
    go();
    const t = setInterval(() => { if (AppState.currentState === 'active') go(); }, 60_000);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') go(); });
    return () => { pendingSubs.delete(setN); clearInterval(t); sub.remove(); };
  }, [me, poll]);
  return n;
}

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
  setPending(rows.filter((r) => r.status === 'pending' && r.addressee === me).length); // keeps the tab badge in step
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
  kudos: { user_id: string; emoji?: string }[];
};

/** Reactions a runner can leave on a friend's post (one per post; they can change it). */
export const REACTIONS = ['👍', '🔥', '💪', '👏', '👑'] as const;

export async function fetchFeed(): Promise<Activity[]> {
  const q = (kudos: string) => supabase.from('activities')
    .select(`id, user_id, kind, data, created_at, profiles!activities_user_id_fkey(username, avatar), kudos(${kudos})`)
    .order('created_at', { ascending: false }).limit(60);
  let res = await q('user_id, emoji');
  if (res.error && /emoji/i.test(res.error.message)) res = await q('user_id'); // database not updated yet (0009)
  if (res.error) throw res.error;
  return (res.data ?? []) as unknown as Activity[];
}

export async function postActivities(rows: { kind: Activity['kind']; data: Record<string, unknown>; run_client_id?: string }[]) {
  if (!rows.length) return;
  const { error } = await supabase.from('activities').insert(rows);
  if (error) throw error;
}

export async function deleteActivitiesForRun(clientId: string) {
  await supabase.from('activities').delete().eq('run_client_id', clientId);
}

/** Sets, changes or (with null) removes your reaction on a post. */
export async function setReaction(activityId: string, emoji: string | null) {
  const me = (await supabase.auth.getSession()).data.session?.user.id ?? '';
  if (!emoji) {
    const { error } = await supabase.from('kudos').delete().eq('activity_id', activityId).eq('user_id', me);
    if (error) throw error;
    return;
  }
  let { error } = await supabase.from('kudos').upsert({ activity_id: activityId, user_id: me, emoji }, { onConflict: 'activity_id,user_id' });
  if (error && /emoji/i.test(error.message)) ({ error } = await supabase.from('kudos').insert({ activity_id: activityId })); // database not updated yet (0009)
  if (error && !/duplicate/i.test(error.message)) throw error;
}

// ---------- runner card, friend requests from a card, nudges ----------
export type RunnerCardData = {
  username: string; avatar: string; home_town: string | null; level: number;
  tiles_held: number; king_of: string[]; week_xp: number;
  friendship: 'self' | 'friends' | 'sent' | 'incoming' | 'none';
};

export async function fetchRunnerCard(userId: string): Promise<RunnerCardData | null> {
  const { data, error } = await supabase.rpc('runner_card', { p_user: userId });
  if (error) throw error;
  const r = (data as any[] | null)?.[0];
  return r ? { ...r, tiles_held: Number(r.tiles_held), week_xp: Number(r.week_xp), king_of: r.king_of ?? [] } : null;
}

export async function requestFriend(otherId: string) {
  const { error } = await supabase.from('friendships').insert({ addressee: otherId });
  if (error && !/duplicate/i.test(error.message)) throw error;
}

export async function acceptFrom(otherId: string, me: string) {
  const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('requester', otherId).eq('addressee', me);
  if (error) throw error;
  refreshRequests(me).catch(() => {});
}

export type NudgeResult = 'sent' | 'already' | 'full' | 'no_phone' | 'not_friends';
/** Sends a friend a "time for a run?" notification. Once a day per friend. */
export async function nudge(otherId: string): Promise<NudgeResult> {
  const { data, error } = await supabase.rpc('nudge_friend', { p_user: otherId });
  if (error) throw new Error(/nudge_friend/i.test(error.message) ? 'Nudges need the latest database update.' : error.message);
  return data as NudgeResult;
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
