// Apple Health import (iPhone only, needs the LevelUp+ development/App Store build —
// Apple Health isn't available inside Expo Go).
// Reads running workouts + their GPS routes from Apple Health, so runs from
// Apple Watch, Garmin, Coros, etc. count in LevelUp+ — including on the shared
// map and leaderboards (the user agrees to this before connecting).
// Runs that Strava wrote into Apple Health are skipped (Strava's API rules).
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform, TurboModuleRegistry } from 'react-native';
import type { RunInput } from './game';
import { kmPerTile, LatLng, simplify } from './geo';

const CONNECTED_KEY = 'levelup.health.connected';
const LAST_SYNC_KEY = 'levelup.health.lastSync';

// Loaded lazily: in Expo Go the native module doesn't exist and importing it would crash.
let HK: any | null | undefined;
function hk(): any | null {
  if (HK !== undefined) return HK;
  if (Platform.OS !== 'ios') return (HK = null);
  // Expo Go has no Apple Health module. Check BEFORE loading the library:
  // in development, a failed require shows a red error screen even inside try/catch.
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return (HK = null);
  try { if (!TurboModuleRegistry.get('NitroModules')) return (HK = null); } catch { return (HK = null); }
  try { HK = require('@kingstinct/react-native-healthkit'); } catch { HK = null; }
  return HK;
}

/** True when this build can talk to Apple Health (iPhone, not Expo Go). */
export function healthSupported(): boolean {
  const m = hk();
  if (!m) return false;
  try { return !!m.isHealthDataAvailable(); } catch { return false; }
}

export const isConnected = async () => (await AsyncStorage.getItem(CONNECTED_KEY)) === '1';
export const lastSync = async () => Number((await AsyncStorage.getItem(LAST_SYNC_KEY)) ?? 0) || null;

/** Shows Apple's permission sheet. */
export async function connect(): Promise<void> {
  const m = hk();
  if (!m) throw new Error('Apple Health needs the LevelUp+ app build. It does not work inside Expo Go.');
  await m.requestAuthorization({
    toRead: ['HKWorkoutTypeIdentifier', 'HKWorkoutRouteTypeIdentifier', 'HKQuantityTypeIdentifierDistanceWalkingRunning'],
  });
  await AsyncStorage.setItem(CONNECTED_KEY, '1');
}

export async function disconnect() {
  await AsyncStorage.multiRemove([CONNECTED_KEY, LAST_SYNC_KEY]);
}

const toKm = (q?: { quantity: number; unit: string }) => {
  if (!q) return 0;
  const u = q.unit.toLowerCase();
  if (u === 'm') return q.quantity / 1000;
  if (u === 'km') return q.quantity;
  if (u === 'mi') return q.quantity * 1.609344;
  if (u === 'yd') return q.quantity * 0.0009144;
  return q.quantity / 1000;
};
const toSec = (q: { quantity: number; unit: string } | undefined, start: Date, end: Date) => {
  if (q?.unit === 's') return q.quantity;
  if (q?.unit === 'min') return q.quantity * 60;
  if (q?.unit === 'hr') return q.quantity * 3600;
  return (end.getTime() - start.getTime()) / 1000;
};

export type HealthFetch = { runs: RunInput[]; skippedStrava: number; found: number; sources: string[] };

/** Running workouts from the last `days` days, converted to LevelUp+ runs. */
export async function fetchRuns(days: number): Promise<HealthFetch> {
  const m = hk();
  if (!m) throw new Error('Apple Health is not available in this build.');
  const workouts = await m.queryWorkoutSamples({
    limit: 0,
    ascending: false,
    filter: { workoutActivityType: m.WorkoutActivityType.running, date: { startDate: new Date(Date.now() - days * 86_400_000) } },
  });
  const runs: RunInput[] = [];
  let skippedStrava = 0;
  const sources = new Set<string>();
  for (const w of workouts) {
    const bundle: string = w.sourceRevision?.source?.bundleIdentifier ?? '';
    const name: string = w.sourceRevision?.source?.name ?? '';
    if (name) sources.add(name);
    if (/strava/i.test(bundle) || /strava/i.test(name)) { skippedStrava++; continue; }
    const start = new Date(w.startDate), end = new Date(w.endDate);
    const km = toKm(w.totalDistance);
    if (km < 0.2) continue;
    let route: LatLng[] = [];
    try {
      const routes = await w.getWorkoutRoutes();
      route = routes.flatMap((r: any) => r.locations.map((l: any) => ({ latitude: l.latitude, longitude: l.longitude })));
    } catch { route = []; }
    runs.push({
      startedAt: start.getTime(),
      durationSec: toSec(w.duration, start, end),
      km,
      route: simplify(route),
      tiles: route.length > 1 ? kmPerTile(route) : {},
      source: 'health',
    });
  }
  await AsyncStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
  return { runs, skippedStrava, found: workouts.length, sources: [...sources] };
}
