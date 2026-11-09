// GPS run tracker.
// - In a development/production build it uses background location updates, so
//   tracking continues with the screen locked.
// - In Expo Go (where background location isn't available on iOS) it falls back
//   to foreground tracking and keeps the screen awake.
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { distanceM, kmPerTile, LatLng, simplify } from './geo';

const TASK = 'strava-plus-run-location';
const MAX_ACCURACY_M = 35;     // ignore fuzzy fixes
const MAX_SPEED_MS = 7.5;      // ~2:13/km; faster jumps are GPS glitches or vehicles
const MIN_STEP_M = 2;

export type TrackerSnapshot = {
  status: 'idle' | 'running' | 'paused';
  mode: 'background' | 'foreground' | null;
  distanceM: number;
  elapsedSec: number;
  route: LatLng[];
  current: LatLng | null;
  gpsAccuracy: number | null;
};

type Session = {
  status: 'idle' | 'running' | 'paused';
  mode: 'background' | 'foreground' | null;
  startedAt: number;
  activeMs: number;          // accumulated running time before the current segment
  segmentStart: number | null;
  distanceM: number;
  route: LatLng[];
  last: { p: LatLng; t: number } | null;
  current: LatLng | null;
  accuracy: number | null;
  sub: Location.LocationSubscription | null;
};

const S: Session = {
  status: 'idle', mode: null, startedAt: 0, activeMs: 0, segmentStart: null, distanceM: 0,
  route: [], last: null, current: null, accuracy: null, sub: null,
};
const listeners = new Set<(s: TrackerSnapshot) => void>();

export function snapshot(): TrackerSnapshot {
  const seg = S.segmentStart ? Date.now() - S.segmentStart : 0;
  return {
    status: S.status, mode: S.mode, distanceM: S.distanceM, elapsedSec: (S.activeMs + seg) / 1000,
    // Copies: React Native freezes whatever is passed to the map in development,
    // so the tracker must never hand out its own working arrays/objects.
    route: S.route.slice(), current: S.current ? { ...S.current } : null, gpsAccuracy: S.accuracy,
  };
}
const emit = () => { const snap = snapshot(); listeners.forEach((l) => l(snap)); };
export function subscribe(fn: (s: TrackerSnapshot) => void) { listeners.add(fn); fn(snapshot()); return () => { listeners.delete(fn); }; }

function handle(locs: Location.LocationObject[]) {
  for (const l of locs) {
    const p = { latitude: l.coords.latitude, longitude: l.coords.longitude };
    const acc = l.coords.accuracy ?? 999;
    S.current = { ...p }; S.accuracy = acc;
    if (S.status !== 'running' || acc > MAX_ACCURACY_M) continue;
    if (!S.last) { const pt = { ...p }; S.last = { p: pt, t: l.timestamp }; S.route.push(pt); continue; }
    const d = distanceM(S.last.p, p);
    const dt = Math.max(0.5, (l.timestamp - S.last.t) / 1000);
    if (d < MIN_STEP_M) continue;
    if (d / dt > MAX_SPEED_MS) { S.last = { p, t: l.timestamp }; continue; } // jump: re-anchor, don't count
    const pt = { latitude: p.latitude, longitude: p.longitude };
    S.route.push(pt);
    S.last = { p: pt, t: l.timestamp };
    S.distanceM += d; // counted only after the point is safely stored
  }
  emit();
}

// Must be defined at app start-up (imported from index.ts) so the OS can wake it.
if (!TaskManager.isTaskDefined(TASK)) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
    if (error || !data) return;
    handle(data.locations);
  });
}

export async function requestPermissions(): Promise<{ ok: boolean; background: boolean; message?: string }> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return { ok: false, background: false, message: 'Location permission is needed to track your run.' };
  let background = false;
  try { background = (await Location.requestBackgroundPermissionsAsync()).status === 'granted'; } catch { background = false; }
  return { ok: true, background };
}

export async function start(): Promise<{ ok: boolean; message?: string }> {
  if (S.status !== 'idle') return { ok: true };
  const perm = await requestPermissions();
  if (!perm.ok) return { ok: false, message: perm.message };
  Object.assign(S, { status: 'running', startedAt: Date.now(), activeMs: 0, segmentStart: Date.now(), distanceM: 0, route: [], last: null });

  let mode: 'background' | 'foreground' = 'foreground';
  if (perm.background) {
    try {
      await Location.startLocationUpdatesAsync(TASK, {
        accuracy: Location.Accuracy.BestForNavigation,
        activityType: Location.ActivityType.Fitness,
        distanceInterval: 5,
        timeInterval: 2000,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: { notificationTitle: 'LevelUp+ is tracking your run', notificationBody: 'Keep going! 🏃', notificationColor: '#FF6A2B' },
      });
      mode = 'background';
    } catch { mode = 'foreground'; }
  }
  if (mode === 'foreground') {
    S.sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 3, timeInterval: 1000 },
      (l) => handle([l]),
    );
  }
  try { await activateKeepAwakeAsync('run'); } catch {}
  S.mode = mode;
  emit();
  return { ok: true };
}

export function pause() {
  if (S.status !== 'running') return;
  if (S.segmentStart) S.activeMs += Date.now() - S.segmentStart;
  S.segmentStart = null; S.status = 'paused'; S.last = null; // don't bridge the gap while paused
  emit();
}
export function resume() {
  if (S.status !== 'paused') return;
  S.status = 'running'; S.segmentStart = Date.now();
  emit();
}

async function stopUpdates() {
  S.sub?.remove(); S.sub = null;
  try { if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK); } catch {}
  try { deactivateKeepAwake('run'); } catch {}
}

export type FinishedRun = { startedAt: number; durationSec: number; km: number; route: LatLng[]; tiles: Record<string, number> };

export async function finish(): Promise<FinishedRun> {
  if (S.segmentStart) S.activeMs += Date.now() - S.segmentStart;
  await stopUpdates();
  const out: FinishedRun = {
    startedAt: S.startedAt, durationSec: S.activeMs / 1000, km: S.distanceM / 1000,
    route: simplify(S.route), tiles: kmPerTile(S.route),
  };
  discardState();
  return out;
}

export async function discard() { await stopUpdates(); discardState(); }
function discardState() {
  Object.assign(S, { status: 'idle', mode: null, activeMs: 0, segmentStart: null, distanceM: 0, route: [], last: null });
  emit();
}

/** One-off position for centring maps. */
export async function currentPosition(): Promise<LatLng | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    const last = await Location.getLastKnownPositionAsync();
    const l = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return { latitude: l.coords.latitude, longitude: l.coords.longitude };
  } catch { return null; }
}
