// The game rules. Pure functions only (no React, no storage) so they are easy
// to test and can later move to the server unchanged.
import { areaOfTile, LatLng } from './geo';

export const DAY_MS = 86_400_000;
export const TILE_WINDOW_DAYS = 30;
export const WEEK_SOFT_CAP_KM = 60;
export const MIN_PACE_MIN_PER_KM = 2.5; // faster than this average = flagged (bike/car)
// Runs tracked by the phone's GPS have no proof they were on foot, so they get a stricter limit.
// Watch runs (Apple Health) are recorded as running workouts by the watch.
export const APP_MIN_PACE_MIN_PER_KM = 3 + 20 / 60; // 3:20/km = 18 km/h, over 2 km or more
// Personal bests: must be a real step up, and each kind pays out at most once a week.
export const PB_MIN_KM = 3;
export const PB_LONG_STEP_KM = 0.5;
export const PB_PACE_STEP_MIN = 5 / 60; // 5 seconds per km

export type Run = {
  id: string;
  startedAt: number;
  durationSec: number;
  km: number;
  route: LatLng[];
  tiles: Record<string, number>; // tile id -> km in this run
  xp: number;
  breakdown: [string, number | null][];
  early: boolean;
  flagged?: string;
  test?: boolean;
  source?: 'app' | 'strava' | 'test' | 'health';
  stravaId?: number;
};

export type GameState = {
  v: 1;
  xp: number;
  runs: Run[];
  streak: number;
  bestStreak: number;
  lastRunDay: number | null;
  freezes: number;
  badges: Record<string, number>;
  bests: { longestKm: number; paceMinKm: number | null; longWeek?: number | null; paceWeek?: number | null };
  tiles: Record<string, [number, number][]>; // tile -> [day, km][] within window
  visited: Record<string, 1>; // every tile ever run through
};

export const newState = (): GameState => ({
  v: 1, xp: 0, runs: [], streak: 0, bestStreak: 0, lastRunDay: null, freezes: 0, badges: {},
  bests: { longestKm: 0, paceMinKm: null }, tiles: {}, visited: {},
});

// ---------- time ----------
export const dayOf = (ms: number) => Math.floor((ms - new Date(ms).getTimezoneOffset() * 60_000) / DAY_MS);
export const weekOf = (day: number) => Math.floor((day + 3) / 7); // weeks start Monday

// ---------- levels & titles ----------
export const xpForLevel = (L: number) => Math.round(25 * Math.pow(L - 1, 1.8));
export function levelOf(xp: number) {
  let L = 1;
  while (xpForLevel(L + 1) <= xp) L++;
  return L;
}
export const TITLES: [number, string][] = [
  [1, 'Shuffler'], [6, 'Jogger'], [11, 'Pacer'], [21, 'Strider'], [36, 'Road Warrior'], [50, 'Legend'],
];
export const titleOf = (L: number) => TITLES.filter((t) => L >= t[0]).pop()![1];

// ---------- tiles ----------
const tileScore = (e: [number, number][], today: number) =>
  e.reduce((m, [d, k]) => (d > today - TILE_WINDOW_DAYS ? m + k : m), 0);
export function heldTiles(s: GameState, today: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id in s.tiles) {
    const v = tileScore(s.tiles[id], today);
    if (v > 0) out[id] = v;
  }
  return out;
}
export function areasHeld(s: GameState, today: number): [string, number][] {
  const c: Record<string, number> = {};
  for (const id in heldTiles(s, today)) {
    const a = areaOfTile(id);
    c[a] = (c[a] || 0) + 1;
  }
  return Object.entries(c).sort((a, b) => b[1] - a[1]);
}
export function pruneTiles(s: GameState, today: number) {
  for (const id in s.tiles) {
    s.tiles[id] = s.tiles[id].filter(([d]) => d > today - TILE_WINDOW_DAYS);
    if (!s.tiles[id].length) delete s.tiles[id];
  }
}

// ---------- badges ----------
const maxRun = (s: GameState) => s.runs.reduce((m, r) => (r.flagged ? m : Math.max(m, r.km)), 0);
const totalKm = (s: GameState) => s.runs.reduce((m, r) => (r.flagged ? m : m + r.km), 0);
export type Badge = { id: string; label?: string; icon?: string; name: string; desc: string; test: (s: GameState, today: number) => boolean };
export const BADGES: Badge[] = [
  { id: 'first', icon: 'play', name: 'First Steps', desc: 'Finish your first run', test: (s) => s.runs.some((r) => !r.flagged) },
  { id: 'k5', label: '5K', name: '5K Club', desc: 'Run 5 km in one go', test: (s) => maxRun(s) >= 5 },
  { id: 'k10', label: '10K', name: 'Double Digits', desc: 'Run 10 km in one go', test: (s) => maxRun(s) >= 10 },
  { id: 'half', label: '21K', name: 'Half Marathoner', desc: 'Run 21.1 km in one go', test: (s) => maxRun(s) >= 21.1 },
  { id: 's3', label: '3d', name: 'On Fire', desc: '3-day streak', test: (s) => s.bestStreak >= 3 },
  { id: 's7', label: '7d', name: 'Unstoppable', desc: '7-day streak', test: (s) => s.bestStreak >= 7 },
  { id: 'early', icon: 'sunrise', name: 'Sunrise Runner', desc: 'Start a run before 8am', test: (s) => s.runs.some((r) => r.early && !r.flagged) },
  { id: 't50', label: '50', name: '50 km Total', desc: 'Run 50 km overall', test: (s) => totalKm(s) >= 50 },
  { id: 't100', label: '100', name: 'Century', desc: 'Run 100 km overall', test: (s) => totalKm(s) >= 100 },
  { id: 'land', icon: 'flag', name: 'Land Grabber', desc: 'Hold 10 tiles at once', test: (s, t) => Object.keys(heldTiles(s, t)).length >= 10 },
  { id: 'explorer', icon: 'compass', name: 'Explorer', desc: 'Run through 50 different tiles', test: (s) => Object.keys(s.visited).length >= 50 },
  { id: 'towns', icon: 'map', name: 'Town Hopper', desc: 'Hold tiles in 3 different towns', test: (s, t) => areasHeld(s, t).length >= 3 },
];

// ---------- streak ----------
export function liveStreak(s: GameState, today: number) {
  if (s.lastRunDay === null) return 0;
  const gap = today - s.lastRunDay;
  if (gap <= 1) return s.streak;
  return gap - 1 <= s.freezes ? s.streak : 0;
}

export const fmtPace = (minPerKm: number) => {
  const m = Math.floor(minPerKm), sec = Math.round((minPerKm - m) * 60);
  return `${m}:${String(sec === 60 ? 59 : sec).padStart(2, '0')}/km`;
};

// ---------- the main rule: turning a run into XP ----------
export type RunInput = {
  startedAt: number; durationSec: number; km: number; route: LatLng[]; tiles: Record<string, number>;
  test?: boolean; source?: 'app' | 'strava' | 'test' | 'health'; stravaId?: number;
};
export type RunResult = {
  run: Run; levelBefore: number; levelAfter: number; titleBefore: string; titleAfter: string;
  newBadges: Badge[]; tilesCaptured: number; usedFreezes: number; earnedFreeze: boolean;
};

export function processRun(prev: GameState, input: RunInput, nowMs = Date.now()): { state: GameState; result: RunResult } {
  const s: GameState = JSON.parse(JSON.stringify(prev));
  const today = dayOf(nowMs);
  const runDay = dayOf(input.startedAt);
  const levelBefore = levelOf(s.xp);
  const km = Math.round(input.km * 100) / 100;
  const paceMin = km > 0 ? input.durationSec / 60 / km : 0;
  const early = new Date(input.startedAt).getHours() < 8;
  const breakdown: [string, number | null][] = [];
  const run: Run = {
    id: input.startedAt.toString(36), startedAt: input.startedAt, durationSec: Math.round(input.durationSec), km,
    route: input.route, tiles: input.tiles, xp: 0, breakdown, early, test: input.test,
    source: input.source ?? (input.test ? 'test' : 'app'), stravaId: input.stravaId,
  };

  // Anti-cheat: too fast on average or too short to count.
  if (km < 0.2) run.flagged = 'Too short to count (under 200 m)';
  else if (km >= 1 && paceMin < MIN_PACE_MIN_PER_KM) run.flagged = `Average pace ${fmtPace(paceMin)} is faster than a human run, so it doesn't count`;
  else if (run.source === 'app' && km >= 2 && paceMin < APP_MIN_PACE_MIN_PER_KM) run.flagged = `Average pace ${fmtPace(paceMin)} looks like a bike ride, so it doesn't count`;
  if (run.flagged) {
    breakdown.push([run.flagged, null]);
    s.runs.unshift(run);
    return { state: s, result: { run, levelBefore, levelAfter: levelBefore, titleBefore: titleOf(levelBefore), titleAfter: titleOf(levelBefore), newBadges: [], tilesCaptured: 0, usedFreezes: 0, earnedFreeze: false } };
  }

  // Streak (one step per calendar day; freezes cover missed days).
  let usedFreezes = 0, earnedFreeze = false;
  if (s.lastRunDay !== runDay) {
    const gap = s.lastRunDay === null ? Infinity : runDay - s.lastRunDay;
    if (gap === 1) s.streak++;
    else if (gap > 1 && gap - 1 <= s.freezes && s.streak > 0) { usedFreezes = gap - 1; s.freezes -= usedFreezes; s.streak++; }
    else s.streak = 1;
    s.lastRunDay = runDay;
    if (s.streak % 7 === 0 && s.freezes < 2) { s.freezes++; earnedFreeze = true; }
  }
  s.bestStreak = Math.max(s.bestStreak, s.streak);

  // Base XP: 10 per km, half rate beyond the weekly soft cap.
  const wk = weekOf(runDay);
  const weekKm = s.runs.filter((r) => !r.flagged && weekOf(dayOf(r.startedAt)) === wk).reduce((m, r) => m + r.km, 0);
  const full = Math.max(0, Math.min(km, WEEK_SOFT_CAP_KM - weekKm));
  const half = km - full;
  const base = 10 * full + 5 * half;
  breakdown.push([`${km.toFixed(2)} km × 10 XP` + (half > 0 ? ` (½ rate past ${WEEK_SOFT_CAP_KM} km this week)` : ''), Math.round(base)]);

  let mult = 1 + Math.min(0.5, 0.1 * (s.streak - 1));
  const multNotes: string[] = [];
  if (s.streak > 1) multNotes.push(`${s.streak}-day streak +${Math.round((mult - 1) * 100)}%`);
  if (early) { mult += 0.2; multNotes.push('Before 8am +20%'); }
  let xp = Math.round(base * mult);
  if (mult > 1) breakdown.push([multNotes.join(' · '), xp - Math.round(base)]);

  // Personal bests.
  if (s.runs.some((r) => !r.flagged) && km >= PB_MIN_KM && km >= s.bests.longestKm + PB_LONG_STEP_KM && s.bests.longWeek !== wk) {
    xp += 100; breakdown.push(['Longest run PB', 100]); s.bests.longWeek = wk;
  }
  s.bests.longestKm = Math.max(s.bests.longestKm, km);
  if (km >= 3) {
    if (s.bests.paceMinKm !== null && paceMin <= s.bests.paceMinKm - PB_PACE_STEP_MIN && s.bests.paceWeek !== wk) {
      xp += 100; breakdown.push([`Fastest pace PB (${fmtPace(paceMin)})`, 100]); s.bests.paceWeek = wk;
    }
    if (s.bests.paceMinKm === null || paceMin < s.bests.paceMinKm) s.bests.paceMinKm = paceMin;
  }

  // Territory.
  pruneTiles(s, today);
  const before = heldTiles(s, today);
  for (const id in input.tiles) {
    const arr = (s.tiles[id] ||= []);
    const last = arr[arr.length - 1];
    if (last && last[0] === runDay) last[1] += input.tiles[id];
    else arr.push([runDay, input.tiles[id]]);
    s.visited[id] = 1;
  }
  const after = heldTiles(s, today);
  const tilesCaptured = Object.keys(after).filter((id) => !(id in before)).length;
  if (tilesCaptured) { xp += tilesCaptured * 5; breakdown.push([`${tilesCaptured} tile${tilesCaptured > 1 ? 's' : ''} captured × 5`, tilesCaptured * 5]); }

  run.xp = xp;
  s.runs.unshift(run);
  if (s.runs.length > 500) s.runs.length = 500;
  s.xp += xp;

  // Badges (+50 each).
  const newBadges: Badge[] = [];
  for (const b of BADGES) {
    if (!s.badges[b.id] && b.test(s, today)) { s.badges[b.id] = nowMs; newBadges.push(b); }
  }
  if (newBadges.length) {
    const bonus = newBadges.length * 50;
    s.xp += bonus; run.xp += bonus;
    breakdown.push([`${newBadges.length} new badge${newBadges.length > 1 ? 's' : ''} × 50`, bonus]);
  }

  const levelAfter = levelOf(s.xp);
  return {
    state: s,
    result: { run, levelBefore, levelAfter, titleBefore: titleOf(levelBefore), titleAfter: titleOf(levelAfter), newBadges, tilesCaptured, usedFreezes, earnedFreeze },
  };
}

const toInput = (r: Run): RunInput => ({
  startedAt: r.startedAt, durationSec: r.durationSec, km: r.km, route: r.route, tiles: r.tiles,
  test: r.test, source: r.source, stravaId: r.stravaId,
});

/** Replays runs in date order so XP, streaks, badges and tiles are always consistent. */
export function rebuild(inputs: RunInput[]): GameState {
  const sorted = inputs.slice().sort((a, b) => a.startedAt - b.startedAt);
  let s = newState();
  for (const r of sorted) s = processRun(s, r, r.startedAt + r.durationSec * 1000).state;
  return s;
}

export function deleteRun(prev: GameState, runId: string): GameState {
  return rebuild(prev.runs.filter((r) => r.id !== runId).map(toInput));
}

/** Adds imported runs (skipping ones already present) and replays history. */
export type ImportResult = { state: GameState; added: number; upgraded: number; replaced: string[]; duplicates: number; xpGained: number };

/**
 * Adds imported runs and replays history.
 * - Same run twice (overlapping by over half its time): counted once.
 * - If a watch/Health run matches a run imported from Strava, the Strava copy is
 *   REPLACED, so the run can count on the Battle map and leaderboards.
 */
export function importRuns(prev: GameState, inputs: RunInput[]): ImportResult {
  const haveStrava = new Set(prev.runs.map((r) => r.stravaId).filter(Boolean));
  const overlapRatio = (a0: number, a1: number, b0: number, b1: number) =>
    (Math.min(a1, b1) - Math.max(a0, b0)) / Math.max(1, Math.min(a1 - a0, b1 - b0));
  const replaced = new Set<string>();
  const fresh: RunInput[] = [];
  let duplicates = 0, upgraded = 0;
  for (const i of inputs) {
    if (i.stravaId && haveStrava.has(i.stravaId)) { duplicates++; continue; }
    const a0 = i.startedAt, a1 = i.startedAt + i.durationSec * 1000;
    const same = prev.runs.filter((r) =>
      Math.round(r.startedAt / 60000) === Math.round(a0 / 60000) ||
      overlapRatio(a0, a1, r.startedAt, r.startedAt + r.durationSec * 1000) > 0.5);
    const alsoNew = fresh.some((f) => overlapRatio(a0, a1, f.startedAt, f.startedAt + f.durationSec * 1000) > 0.5);
    if (alsoNew) { duplicates++; continue; }
    if (!same.length) { fresh.push(i); continue; }
    const upgrade = i.source !== 'strava' && same.every((r) => r.source === 'strava');
    if (upgrade) { same.forEach((r) => replaced.add(r.id)); fresh.push(i); upgraded++; }
    else duplicates++;
  }
  if (!fresh.length) return { state: prev, added: 0, upgraded: 0, replaced: [], duplicates, xpGained: 0 };
  const keep = prev.runs.filter((r) => !replaced.has(r.id)).map(toInput);
  const state = rebuild([...keep, ...fresh]);
  return { state, added: fresh.length - upgraded, upgraded, replaced: [...replaced], duplicates, xpGained: state.xp - prev.xp };
}
