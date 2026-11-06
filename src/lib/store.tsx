// App state: the game state, saved on the phone with AsyncStorage.
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { deleteRun, GameState, importRuns, newState, processRun, RunInput, RunResult } from './game';
import { distanceM, kmPerTile, LatLng, simplify } from './geo';

const KEY = 'stravaplus.game.v1';
const PKEY = 'stravaplus.profile.v1';

export type Profile = { name: string; avatar: string; homeTown: string; weeklyGoalKm: number };
export const defaultProfile: Profile = { name: '', avatar: '🏃', homeTown: '', weeklyGoalKm: 20 };

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
};
const StoreCtx = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GameState>(newState);
  const [ready, setReady] = useState(false);
  const [lastResult, setLastResult] = useState<RunResult | null>(null);
  const [profile, setProfileState] = useState<Profile>(defaultProfile);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(KEY), AsyncStorage.getItem(PKEY)])
      .then(([raw, praw]) => {
        if (raw) setState({ ...newState(), ...JSON.parse(raw) });
        if (praw) setProfileState({ ...defaultProfile, ...JSON.parse(praw) });
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const setProfile = useCallback((p: Partial<Profile>) => {
    setProfileState((cur) => {
      const next = { ...cur, ...p };
      AsyncStorage.setItem(PKEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const persist = useCallback((s: GameState) => {
    stateRef.current = s;
    setState(s);
    AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {});
  }, []);

  const addRun = useCallback((r: RunInput) => {
    const { state: s, result } = processRun(stateRef.current, r);
    persist(s);
    setLastResult(result);
    return result;
  }, [persist]);

  const doImport = useCallback((rs: RunInput[]) => {
    const r = importRuns(stateRef.current, rs);
    if (r.added) persist(r.state);
    return { added: r.added, xpGained: r.xpGained };
  }, [persist]);

  const value = useMemo<Ctx>(() => ({
    ready, state, lastResult, addRun, importRuns: doImport, profile, setProfile,
    removeRun: (id) => persist(deleteRun(stateRef.current, id)),
    clearResult: () => setLastResult(null),
    reset: () => persist(newState()),
  }), [ready, state, lastResult, addRun, doImport, profile, setProfile, persist]);

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
