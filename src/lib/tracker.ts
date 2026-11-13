// GPS run tracker.
// - In a development/production build it uses background location updates, so
//   tracking continues with the screen locked.
// - In Expo Go (where background location isn't available on iOS) it falls back
//   to foreground tracking and keeps the screen awake.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo';
import { AppState, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { fmtPace } from './game';
import { distanceM, kmPerTile, LatLng, simplify } from './geo';
import { localNotify } from './push';

const TASK = 'strava-plus-run-location';
const MAX_ACCURACY_M = 35;     // ignore fuzzy fixes
const MAX_SPEED_MS = 7.5;      // ~2:13/km; faster jumps are GPS glitches or vehicles
const MIN_STEP_M = 2;
const SAVE_KEY = 'levelup.run.active';   // the run in progress, so it survives the app being closed
const SAVE_EVERY_MS = 10_000;
const STALE_MS = 30 * 60_000;            // no GPS saved for this long while the app was closed → resume as paused

export type TrackerSnapshot = {
  status: 'idle' | 'running' | 'paused';
  mode: 'background' | 'foreground' | null;
  distanceM: number;
  elapsedSec: number;
  route: LatLng[];
  /** The route split at every pause/gap, so nothing is drawn or counted across a gap. */
  segments: LatLng[][];
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
  segments: LatLng[][];      // a new segment starts after every pause or gap
  last: { p: LatLng; t: number } | null;
  current: LatLng | null;
  accuracy: number | null;
  sub: Location.LocationSubscription | null;
};

const S: Session = {
  status: 'idle', mode: null, startedAt: 0, activeMs: 0, segmentStart: null, distanceM: 0,
  segments: [], last: null, current: null, accuracy: null, sub: null,
};
const listeners = new Set<(s: TrackerSnapshot) => void>();

export function snapshot(): TrackerSnapshot {
  const seg = S.segmentStart ? Date.now() - S.segmentStart : 0;
  return {
    status: S.status, mode: S.mode, distanceM: S.distanceM, elapsedSec: (S.activeMs + seg) / 1000,
    // Copies: React Native freezes whatever is passed to the map in development,
    // so the tracker must never hand out its own working arrays/objects.
    route: S.segments.flat(), segments: S.segments.map((g) => g.slice()),
    current: S.current ? { ...S.current } : null, gpsAccuracy: S.accuracy,
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
    if (!S.last) { const pt = { ...p }; S.last = { p: pt, t: l.timestamp }; S.segments.push([pt]); continue; } // first fix, or first after a pause
    const d = distanceM(S.last.p, p);
    const dt = Math.max(0.5, (l.timestamp - S.last.t) / 1000);
    if (d < MIN_STEP_M) continue;
    if (d / dt > MAX_SPEED_MS) { S.last = { p, t: l.timestamp }; continue; } // jump: re-anchor, don't count
    const pt = { latitude: p.latitude, longitude: p.longitude };
    const seg = S.segments[S.segments.length - 1];
    if (seg) seg.push(pt); else S.segments.push([pt]);
    S.last = { p: pt, t: l.timestamp };
    const kmBefore = Math.floor(S.distanceM / 1000);
    S.distanceM += d; // counted only after the point is safely stored
    const kmNow = Math.floor(S.distanceM / 1000);
    if (kmNow > kmBefore) kmCue(kmNow);
  }
  save();
  emit();
}

// ---------- a cue every km: a buzz with the app open, a notification with the screen locked ----------
function kmCue(km: number) {
  try {
    if (AppState.currentState === 'active') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } else {
      const sec = (S.activeMs + (S.segmentStart ? Date.now() - S.segmentStart : 0)) / 1000;
      localNotify(`${km} km`, `Average pace ${fmtPace(sec / 60 / (S.distanceM / 1000))}`);
    }
  } catch { /* never interrupt tracking */ }
}

// ---------- keeping the run safe if the app is closed mid-run ----------
let lastSave = 0;
function save(force = false) {
  if (S.status === 'idle') return;
  const now = Date.now();
  if (!force && now - lastSave < SAVE_EVERY_MS) return;
  lastSave = now;
  AsyncStorage.setItem(SAVE_KEY, JSON.stringify({
    v: 1, status: S.status, startedAt: S.startedAt, activeMs: S.activeMs, segmentStart: S.segmentStart,
    distanceM: S.distanceM, segments: S.segments, savedAt: now,
  })).catch(() => {});
}

/** Starts GPS updates: in the background when allowed, otherwise while the app is open. */
async function attach(background: boolean): Promise<'background' | 'foreground'> {
  let mode: 'background' | 'foreground' = 'foreground';
  if (background) {
    try {
      if (!(await Location.hasStartedLocationUpdatesAsync(TASK))) {
        await Location.startLocationUpdatesAsync(TASK, {
          accuracy: Location.Accuracy.BestForNavigation,
          activityType: Location.ActivityType.Fitness,
          distanceInterval: 5,
          timeInterval: 2000,
          pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: true,
          foregroundService: { notificationTitle: 'LevelUp+ is tracking your run', notificationBody: 'Keep going! 🏃', notificationColor: '#FF6A2B' },
        });
      }
      mode = 'background';
    } catch { mode = 'foreground'; }
  }
  if (mode === 'foreground') {
    S.sub?.remove();
    S.sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 3, timeInterval: 1000 },
      (l) => handle([l]),
    );
  }
  try { await activateKeepAwakeAsync('run'); } catch {}
  return mode;
}

/** On app start: if a run was in progress when the app closed, pick it up again. */
const restored: Promise<void> = (async () => {
  try {
    const raw = await AsyncStorage.getItem(SAVE_KEY);
    if (!raw || S.status !== 'idle') return;
    const d = JSON.parse(raw);
    if (!d || d.v !== 1 || !Array.isArray(d.segments) || Date.now() - d.savedAt > 12 * 3_600_000) {
      await AsyncStorage.removeItem(SAVE_KEY);
      return;
    }
    let status: 'running' | 'paused' = d.status === 'paused' ? 'paused' : 'running';
    let activeMs: number = d.activeMs ?? 0, segmentStart: number | null = d.segmentStart ?? null;
    if (status === 'running' && Date.now() - d.savedAt > STALE_MS) {
      // The app was closed for a long time: don't count that time as running.
      activeMs += Math.max(0, d.savedAt - (segmentStart ?? d.savedAt));
      segmentStart = null; status = 'paused';
    }
    // last: null → the next GPS fix starts a new segment, so the gap isn't bridged.
    Object.assign(S, { status, startedAt: d.startedAt, activeMs, segmentStart, distanceM: d.distanceM ?? 0, segments: d.segments, last: null });
    let bg = false;
    try { bg = (await Location.getBackgroundPermissionsAsync()).status === 'granted'; } catch {}
    try { S.mode = await attach(bg); } catch { S.mode = 'foreground'; }
    emit();
  } catch { /* a broken save must never stop the app from opening */ }
})();

// Must be defined at app start-up (imported from index.ts) so the OS can wake it.
if (!TaskManager.isTaskDefined(TASK)) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
    if (error || !data) return;
    await restored; // iOS may relaunch the app just to deliver GPS points: load the saved run first
    handle(data.locations);
  });
}

/** 'ask' means the phone hasn't asked about location yet (or will ask again). */
export async function permissionState(): Promise<'granted' | 'ask' | 'denied'> {
  try {
    const p = await Location.getForegroundPermissionsAsync();
    return p.granted ? 'granted' : p.canAskAgain ? 'ask' : 'denied';
  } catch { return 'ask'; }
}

/**
 * Watches GPS before a run starts, so the run begins on a good signal and the first
 * metres aren't lost. Location permission must already be granted. Returns a stop function.
 */
export async function warmUp(onFix: (accuracyM: number) => void): Promise<() => void> {
  const sub = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
    (l) => {
      if (S.status !== 'idle') return;
      S.current = { latitude: l.coords.latitude, longitude: l.coords.longitude };
      S.accuracy = l.coords.accuracy ?? 999;
      emit();
      onFix(S.accuracy);
    },
  );
  return () => sub.remove();
}

export async function requestPermissions(): Promise<{ ok: boolean; background: boolean; message?: string }> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return { ok: false, background: false, message: 'Location permission is needed to track your run.' };
  let background = false;
  try { background = (await Location.requestBackgroundPermissionsAsync()).status === 'granted'; } catch { background = false; }
  return { ok: true, background };
}

export async function start(): Promise<{ ok: boolean; message?: string }> {
  await restored;
  if (S.status !== 'idle') return { ok: true };
  const perm = await requestPermissions();
  if (!perm.ok) return { ok: false, message: perm.message };
  Object.assign(S, { status: 'running', startedAt: Date.now(), activeMs: 0, segmentStart: Date.now(), distanceM: 0, segments: [], last: null });
  S.mode = await attach(perm.background);
  askMotion();
  save(true);
  emit();
  return { ok: true };
}

export function pause() {
  if (S.status !== 'running') return;
  if (S.segmentStart) S.activeMs += Date.now() - S.segmentStart;
  S.segmentStart = null; S.status = 'paused'; S.last = null; // don't bridge the gap while paused
  save(true);
  emit();
}
export function resume() {
  if (S.status !== 'paused') return;
  S.status = 'running'; S.segmentStart = Date.now();
  save(true);
  emit();
}

async function stopUpdates() {
  S.sub?.remove(); S.sub = null;
  try { if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK); } catch {}
  try { deactivateKeepAwake('run'); } catch {}
}

export type FinishedRun = { startedAt: number; durationSec: number; km: number; route: LatLng[]; tiles: Record<string, number>; steps?: number };

export async function finish(): Promise<FinishedRun> {
  if (S.segmentStart) S.activeMs += Date.now() - S.segmentStart;
  await stopUpdates();
  const steps = await stepsBetween(S.startedAt, Date.now());
  const out: FinishedRun = {
    startedAt: S.startedAt, durationSec: S.activeMs / 1000, km: S.distanceM / 1000,
    route: simplify(S.segments.flat()), tiles: tilesOf(S.segments),
    ...(steps !== undefined ? { steps } : {}),
  };
  discardState();
  return out;
}

export async function discard() { await stopUpdates(); discardState(); }
function discardState() {
  Object.assign(S, { status: 'idle', mode: null, activeMs: 0, segmentStart: null, distanceM: 0, segments: [], last: null });
  AsyncStorage.removeItem(SAVE_KEY).catch(() => {});
  emit();
}

/** Km per tile, counted inside each segment only (never across a pause). */
function tilesOf(segments: LatLng[][]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const seg of segments) {
    const t = kmPerTile(seg);
    for (const id in t) out[id] = (out[id] || 0) + t[id];
  }
  return out;
}

// ---------- step count (iPhone): proof the run was on foot ----------
// Needs the app build that includes the motion sensor. Without it, runs simply have no step count.
let PED: any | null | undefined;
function pedometer(): any | null {
  if (PED !== undefined) return PED;
  if (Platform.OS !== 'ios') return (PED = null);
  try { if (!requireOptionalNativeModule('ExponentPedometer')) return (PED = null); } catch { return (PED = null); }
  try { PED = require('expo-sensors').Pedometer ?? null; } catch { PED = null; }
  return PED;
}
function askMotion() {
  const p = pedometer();
  if (p) p.requestPermissionsAsync().catch(() => {});
}
async function stepsBetween(startMs: number, endMs: number): Promise<number | undefined> {
  const p = pedometer();
  if (!p) return undefined;
  try {
    if (!(await p.isAvailableAsync()) || !(await p.getPermissionsAsync()).granted) return undefined;
    const r: any = await Promise.race([
      p.getStepCountAsync(new Date(startMs), new Date(endMs)),
      new Promise((res) => setTimeout(() => res(null), 4000)),
    ]);
    return r && typeof r.steps === 'number' ? Math.round(r.steps) : undefined;
  } catch { return undefined; }
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
