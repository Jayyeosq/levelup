// App state: the game state + profile. Saved on the phone (instant, works
// offline) and synced to your LevelUp+ account in the cloud.
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './auth';
import * as cloud from './cloud';
import { deleteActivitiesForRun, deleteAllMyActivities, postActivities } from './community';
import { deleteRun, GameState, importRuns, levelOf, newState, processRun, rebuild, Run, RunInput, RunResult } from './game';
import { distanceM, kmPerTile, LatLng, simplify } from './geo';

const KEY = 'stravaplus.game.v1';
const PKEY = 'stravaplus.profile.v1';
const OWNER_KEY = 'levelup.cache.owner'; // which account the phone's cached runs belong to

export type Profile = { name: string; avatar: string; homeTown: string; weeklyGoalKm: number };
export const defaultProfile: Profile = { name: '', avatar: '🏃', homeTown: '', weeklyGoalKm: 20 };

export type SyncStatus = 'offline' | 'syncing' | 'synced' | 'error';

type Ctx = {
  ready: boolean;
  state: GameState;
  lastResult: RunResult | null;
  addRun: (r: RunInput) => RunResult;
  importRuns: (rs: RunInput[]) => { added: number; xpGained: number };
  profile: Profile;
  setProfile: (p: Partial<Profile>) => void;
  removeRun: (id: string) => void;
  clearResult: () => void;
  reset: () => void;
  sync: SyncStatus;
  resync: () => Promise<void>;
};
const StoreCtx = createContext<Ctx | null>(null);

const toInput = (r: Run): RunInput & { id: string } => ({
  id: r.id, startedAt: r.startedAt, durationSec: r.durationSec, km: r.km, route: r.route, tiles: r.tiles,
  test: r.test, source: r.source, stravaId: r.stravaId,
});

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const { userId } = useAuth();
  const [state, setState] = useState<GameState>(newState);
  const [ready, setReady] = useState(false);
  const [lastResult, setLastResult] = useState<RunResult | null>(null);
  const [profile, setProfileState] = useState<Profile>(defaultProfile);
  const [sync, setSync] = useState<SyncStatus>('offline');
  const stateRef = useRef(state);
  stateRef.current = state;
  const userRef = useRef<string | null>(null);
  userRef.current = userId;

  // ---- local cache ----
  useEffect(() => {
    Promise.all([AsyncStorage.getItem(KEY), AsyncStorage.getItem(PKEY)])
      .then(([raw, praw]) => {
        if (raw) setState({ ...newState(), ...JSON.parse(raw) });
        if (praw) setProfileState({ ...defaultProfile, ...JSON.parse(praw) });
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const persist = useCallback((s: GameState) => {
    stateRef.current = s;
    setState(s);
    AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {});
  }, []);
  const persistProfile = useCallback((p: Profile) => {
    setProfileState(p);
    AsyncStorage.setItem(PKEY, JSON.stringify(p)).catch(() => {});
  }, []);

  const pushStats = useCallback((s: GameState) => {
    const uid = userRef.current;
    if (uid) cloud.updateProfile(uid, { xp: s.xp, level: levelOf(s.xp) }).catch(() => {});
  }, []);

  // ---- full two-way sync (on login / app start / pull to refresh) ----
  const resync = useCallback(async () => {
    const uid = userRef.current;
    if (!uid) return;
    setSync('syncing');
    try {
      const owner = await AsyncStorage.getItem(OWNER_KEY);
      // Runs cached on this phone from before you had an account are moved into your account.
      // Runs cached for a DIFFERENT account are never uploaded into yours.
      const local = owner === null || owner === uid ? stateRef.current.runs : [];
      const [rows, prof] = await Promise.all([cloud.fetchRuns(), cloud.fetchProfile(uid)]);
      const have = new Set(rows.map((r) => r.client_id));
      const toUpload = local.filter((r) => !have.has(r.id)).map((r) => cloud.toRow(r));
      if (toUpload.length) await cloud.uploadRuns(toUpload);
      const all = [...rows.map(cloud.fromRow), ...toUpload.map(cloud.fromRow)];
      const s = rebuild(all);
      persist(s);
      await AsyncStorage.setItem(OWNER_KEY, uid);
      if (prof) {
        persistProfile({ name: prof.username, avatar: prof.avatar, homeTown: prof.home_town ?? '', weeklyGoalKm: prof.weekly_goal_km });
        if (prof.xp !== s.xp || prof.level !== levelOf(s.xp)) await cloud.updateProfile(uid, { xp: s.xp, level: levelOf(s.xp) });
      }
      setSync('synced');
    } catch {
      setSync('error');
    }
  }, [persist, persistProfile]);

  const prevUser = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (userId) resync();
    else {
      setSync('offline');
      // Logged out: clear this account's data from the screen and the phone.
      if (prevUser.current) { persist(newState()); persistProfile(defaultProfile); }
    }
    prevUser.current = userId;
  }, [ready, userId, resync, persist, persistProfile]);

  // ---- actions ----
  const addRun = useCallback((r: RunInput) => {
    const { state: s, result } = processRun(stateRef.current, r);
    persist(s);
    setLastResult(result);
    if (userRef.current) {
      cloud.uploadRuns([cloud.toRow(result.run)])
        .then(() => {
          pushStats(s);
          // Share to friends' feeds (never the route; never Strava-imported runs)
          const run = result.run;
          if (run.flagged || run.source === 'strava') return;
          const posts: Parameters<typeof postActivities>[0] = [
            { kind: 'run', run_client_id: run.id, data: { km: run.km, xp: run.xp, duration_sec: run.durationSec, test: !!run.test } },
          ];
          if (result.levelAfter > result.levelBefore) posts.push({ kind: 'level_up', run_client_id: run.id, data: { level: result.levelAfter, title: result.titleAfter } });
          for (const b of result.newBadges) posts.push({ kind: 'badge', run_client_id: run.id, data: { badge_id: b.id, name: b.name } });
          return postActivities(posts);
        })
        .catch(() => setSync('error'));
    }
    return result;
  }, [persist, pushStats]);

  const doImport = useCallback((rs: RunInput[]) => {
    const before = new Set(stateRef.current.runs.map((r) => r.id));
    const r = importRuns(stateRef.current, rs);
    if (r.added) {
      persist(r.state);
      if (userRef.current) {
        const fresh = r.state.runs.filter((x) => !before.has(x.id)).map((x) => cloud.toRow(toInput(x)));
        cloud.uploadRuns(fresh).then(() => pushStats(r.state)).catch(() => setSync('error'));
      }
    }
    return { added: r.added, xpGained: r.xpGained };
  }, [persist, pushStats]);

  const setProfile = useCallback((p: Partial<Profile>) => {
    setProfileState((cur) => {
      const next = { ...cur, ...p, name: cur.name }; // username is fixed at sign-up
      AsyncStorage.setItem(PKEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
    const uid = userRef.current;
    if (uid) {
      const patch: Partial<cloud.CloudProfile> = {};
      if (p.avatar !== undefined) patch.avatar = p.avatar;
      if (p.homeTown !== undefined) patch.home_town = p.homeTown || null;
      if (p.weeklyGoalKm !== undefined) patch.weekly_goal_km = p.weeklyGoalKm;
      if (Object.keys(patch).length) cloud.updateProfile(uid, patch).catch(() => setSync('error'));
    }
  }, []);

  const removeRun = useCallback((id: string) => {
    const s = deleteRun(stateRef.current, id);
    persist(s);
    if (userRef.current) cloud.deleteRunCloud(id).then(() => { pushStats(s); return deleteActivitiesForRun(id); }).catch(() => setSync('error'));
  }, [persist, pushStats]);

  const reset = useCallback(() => {
    const s = newState();
    persist(s);
    const uid = userRef.current;
    if (uid) cloud.deleteAllRunsCloud(uid).then(() => { pushStats(s); return deleteAllMyActivities(uid); }).catch(() => setSync('error'));
  }, [persist, pushStats]);

  const value = useMemo<Ctx>(() => ({
    ready, state, lastResult, addRun, importRuns: doImport, profile, setProfile, removeRun,
    clearResult: () => setLastResult(null), reset, sync, resync,
  }), [ready, state, lastResult, addRun, doImport, profile, setProfile, removeRun, reset, sync, resync]);

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const c = useContext(StoreCtx);
  if (!c) throw new Error('useStore must be used inside StoreProvider');
  return c;
}

/** Builds a realistic fake run near `start` for indoor testing. */
export function makeTestRun(start: LatLng): RunInput {
  const targetKm = 3 + Math.random() * 6;
  const route: LatLng[] = [start];
  let heading = Math.random() * Math.PI * 2, p = start, d = 0;
  while (d < targetKm * 1000) {
    heading += (Math.random() - 0.5) * 0.6;
    const step = 12;
    const next = {
      latitude: p.latitude + (step * Math.cos(heading)) / 110574,
      longitude: p.longitude + (step * Math.sin(heading)) / (111320 * Math.cos((p.latitude * Math.PI) / 180)),
    };
    d += distanceM(p, next);
    route.push(next); p = next;
  }
  const km = d / 1000;
  return {
    startedAt: Date.now() - km * 6 * 60_000, durationSec: km * (5.2 + Math.random() * 1.6) * 60, km,
    route: simplify(route), tiles: kmPerTile(route), test: true,
  };
}
