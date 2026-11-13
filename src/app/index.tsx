import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import MapView, { Polygon, Polyline } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Btn, C, Card, Icon, IconName, LevelHeader, num, ResultModal, s, SectionLabel, Stat } from '../components/ui';
import { dayOf, fmtPace, heldTiles, levelOf, liveStreak, titleOf, weekOf, xpForLevel } from '../lib/game';
import { useAuth } from '../lib/auth';
import * as battle from '../lib/battle';
import { tileOf, tilePolygon } from '../lib/geo';
import { useStore } from '../lib/store';
import * as tracker from '../lib/tracker';

const GPS_READY_M = 20;    // start once the signal is this accurate
const AREA_HALF = 0.012;   // Battle tiles are loaded about 1.3 km around you

const fmtTime = (sec: number) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = Math.floor(sec % 60);
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(x).padStart(2, '0')}`;
};

export default function RunScreen() {
  const { state, addRun, lastResult, clearResult, profile } = useStore();
  const [snap, setSnap] = useState(tracker.snapshot());
  const [, tick] = useState(0);
  const mapRef = useRef<MapView>(null);
  const { userId } = useAuth();
  // Tiles you actually own on the Battle map (same number as the Territory tab).
  const [owned, setOwned] = useState<number | null>(null);
  const runCount = state.runs.length;
  useFocusEffect(useCallback(() => {
    if (!userId) { setOwned(null); return; }
    let live = true;
    battle.fetchMyTiles()
      .then((m) => { if (live) setOwned(m.filter((t) => t.owner_id === userId).length); })
      .catch(() => {});
    return () => { live = false; };
  }, [userId, runCount]));

  useEffect(() => tracker.subscribe(setSnap), []);
  useEffect(() => {
    if (snap.status !== 'running') return;
    const t = setInterval(() => tick((n) => n + 1), 1000); // refresh the clock
    return () => clearInterval(t);
  }, [snap.status]);
  // The map follows you until you move or zoom it yourself; the re-centre button turns following back on.
  const [following, setFollowing] = useState(true);
  useEffect(() => {
    if (following && snap.current && mapRef.current) mapRef.current.animateCamera({ center: snap.current }, { duration: 500 });
  }, [snap.current, following]);

  const live = tracker.snapshot();
  const km = live.distanceM / 1000;
  const pace = km > 0.05 ? fmtPace(live.elapsedSec / 60 / km) : '–:––';

  // ---- Starting: explain the location prompts (first time), then wait for a good GPS signal ----
  const [prime, setPrime] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locAcc, setLocAcc] = useState<number | null>(null);
  const [slow, setSlow] = useState(false);
  const locatingRef = useRef(false);
  const stopWarm = useRef<(() => void) | null>(null);
  const beginning = useRef(false);
  const wantLocate = useRef(false);

  const endLocate = () => {
    locatingRef.current = false;
    stopWarm.current?.(); stopWarm.current = null;
    setLocating(false); setLocAcc(null); setSlow(false);
  };
  const begin = useCallback(async () => {
    if (beginning.current) return;
    beginning.current = true;
    const r = await tracker.start();
    endLocate();
    beginning.current = false;
    if (!r.ok) Alert.alert('Location needed', r.message ?? 'Please allow location access.');
    else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, []);
  const locate = async () => {
    if (!wantLocate.current) return;
    wantLocate.current = false;
    const r = await tracker.requestPermissions();
    if (!r.ok) {
      Alert.alert('Location is off', 'LevelUp+ needs your location to track a run. Turn it on in Settings.', [
        { text: 'Not now', style: 'cancel' }, { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ]);
      return;
    }
    locatingRef.current = true;
    setLocating(true);
    try {
      const stop = await tracker.warmUp(setLocAcc);
      if (locatingRef.current) stopWarm.current = stop; else stop(); // cancelled while GPS was starting
    } catch { begin(); }
  };
  const onStart = async () => {
    wantLocate.current = true;
    if ((await tracker.permissionState()) === 'ask') setPrime(true); // explain first; continues from the sheet
    else locate();
  };
  const primeContinue = () => {
    setPrime(false);
    setTimeout(locate, 700); // fallback if the sheet's onDismiss doesn't fire
  };
  // Start by itself once the signal is good.
  useEffect(() => { if (locating && locAcc !== null && locAcc <= GPS_READY_M) begin(); }, [locating, locAcc, begin]);
  useEffect(() => {
    if (!locating) return;
    const t = setTimeout(() => setSlow(true), 15_000);
    return () => clearTimeout(t);
  }, [locating]);
  useEffect(() => () => { stopWarm.current?.(); }, []);

  // ---- During the run: lock, and the Battle map around you ----
  const [locked, setLocked] = useState(false);
  const [area, setArea] = useState<battle.BattleTile[]>([]);
  const areaAt = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const active = snap.status !== 'idle';
  useEffect(() => {
    if (!active) { setArea([]); areaAt.current = null; setLocked(false); setFollowing(true); return; }
    const c = snap.current;
    if (!c || !userId) return;
    const b = areaAt.current, now = Date.now();
    const inside = !!b && Math.abs(c.latitude - b.lat) < AREA_HALF * 0.6 && Math.abs(c.longitude - b.lng) < AREA_HALF * 0.6;
    if (b && now - b.at < (inside ? 5 * 60_000 : 20_000)) return; // refresh every 5 min, or when you near the edge
    areaAt.current = { lat: c.latitude, lng: c.longitude, at: now };
    battle.fetchTerritory({ minLat: c.latitude - AREA_HALF, maxLat: c.latitude + AREA_HALF, minLng: c.longitude - AREA_HALF, maxLng: c.longitude + AREA_HALF })
      .then(setArea).catch(() => {});
  }, [active, snap.current, userId]);

  // Tiles this run has passed through so far.
  const runTileSet = useMemo(() => {
    const set = new Set<string>();
    for (const seg of snap.segments) for (const pt of seg) set.add(tileOf(pt));
    return set;
  }, [snap.segments]);
  const runTileCount = runTileSet.size;
  // Rebuilt only when a new tile is entered (not every second), so the map isn't redrawn constantly.
  const runTiles = useMemo(() => [...runTileSet], [runTileCount]); // eslint-disable-line react-hooks/exhaustive-deps
  const tileShapes = useMemo(() => {
    const mine = new Set(runTiles);
    return [
      ...area.filter((t) => !mine.has(t.tile_id)).map((t) => (
        <Polygon key={t.tile_id} coordinates={tilePolygon(t.tile_id)} tappable={false} strokeWidth={1}
          fillColor={t.is_mine ? 'rgba(255,106,43,0.16)' : 'rgba(148,158,172,0.14)'}
          strokeColor={t.is_mine ? 'rgba(255,106,43,0.7)' : 'rgba(148,158,172,0.4)'} />
      )),
      ...runTiles.map((id) => (
        <Polygon key={`run-${id}`} coordinates={tilePolygon(id)} tappable={false} strokeWidth={2}
          fillColor="rgba(255,106,43,0.42)" strokeColor="rgba(255,106,43,1)" />
      )),
    ];
  }, [area, runTiles]);
  // A light tap when you enter a tile that isn't yours yet.
  const seenTiles = useRef(0);
  useEffect(() => {
    if (runTileCount > seenTiles.current && seenTiles.current > 0 && snap.status === 'running' && area.length && AppState.currentState === 'active') {
      const seg = snap.segments[snap.segments.length - 1], pt = seg?.[seg.length - 1];
      const id = pt ? tileOf(pt) : null;
      if (id && !area.some((t) => t.tile_id === id && t.is_mine)) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    seenTiles.current = runTileCount;
  }, [runTileCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const onFinish = () => {
    Alert.alert('Finish run?', `${km.toFixed(2)} km in ${fmtTime(live.elapsedSec)}`, [
      { text: 'Keep running', style: 'cancel' },
      { text: 'Finish & save', onPress: async () => { const run = await tracker.finish(); addRun(run); } },
      // Discarding needs a second, separate confirmation so a run is never lost by a slip of the thumb.
      { text: 'Discard run…', style: 'destructive', onPress: () => Alert.alert('Discard this run?', `${km.toFixed(2)} km will be deleted and can't be recovered.`, [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => tracker.discard() },
      ]) },
    ]);
  };

  const today = dayOf(Date.now());
  const nudges = useMemo(() => {
    const out: [IconName, string][] = [];
    const L = levelOf(state.xp), toNext = (xpForLevel(L + 1) - state.xp) / 10;
    out.push(['trending-up', `${Math.max(0.1, toNext).toFixed(1)} km to Level ${L + 1}` + (titleOf(L + 1) !== titleOf(L) ? ` and the ${titleOf(L + 1)} title` : '')]);
    const st = liveStreak(state, today);
    if (st > 0 && state.lastRunDay === today - 1) out.push(['zap', `Run today to keep your ${st}-day streak`]);
    if (st > 0 && state.lastRunDay === today) out.push(['zap', `${st}-day streak. Run tomorrow to make it ${st + 1}`]);
    if (!state.runs.length) out.push(['flag', 'Finish your first run to start claiming tiles']);
    const ranIn = Object.keys(heldTiles(state, today)).length;
    if (owned) out.push(['flag', `You hold ${owned} tiles on the Battle map. Keep running there to defend them`]);
    else if (ranIn) out.push(['flag', `You've run in ${ranIn} tiles. Each fades 30 days after your last run there`]);
    return out;
  }, [state, today, owned]);

  const wk = weekOf(today);
  const weekKm = state.runs.filter((r) => !r.flagged && weekOf(dayOf(r.startedAt)) === wk).reduce((m, r) => m + r.km, 0);

  const acc = snap.gpsAccuracy;
  const gps: [string, string] = acc === null ? ['Finding GPS', C.mut] : acc <= 15 ? ['GPS strong', C.good] : acc <= 35 ? ['GPS OK', C.acc] : ['GPS weak · distance paused', C.bad];

  if (snap.status !== 'idle') {
    return (
      <View style={s.screen}>
        <MapView ref={mapRef} style={{ flex: 1 }} showsUserLocation userInterfaceStyle="dark"
          scrollEnabled={!locked} zoomEnabled={!locked} rotateEnabled={!locked} pitchEnabled={!locked}
          onPanDrag={() => setFollowing(false)}
          onRegionChangeComplete={(_r, d) => { if (d?.isGesture) setFollowing(false); }}
          initialRegion={snap.current ? { ...snap.current, latitudeDelta: 0.008, longitudeDelta: 0.008 } : { latitude: 1.3521, longitude: 103.8198, latitudeDelta: 0.2, longitudeDelta: 0.2 }}>
          {tileShapes}
          {snap.segments.map((seg, i) => seg.length > 1 && <Polyline key={i} coordinates={seg} strokeColor="#ffffff" strokeWidth={4} />)}
        </MapView>
        <SafeAreaView edges={['top']} pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, backgroundColor: 'rgba(14,16,20,0.88)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: C.line }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: gps[1] }} />
            <Text style={{ color: C.txt, fontSize: 12, fontWeight: '500' }}>{gps[0]}</Text>
          </View>
        </SafeAreaView>
        {!following && !locked && (
          <View style={{ alignItems: 'flex-end', marginTop: -60, height: 60, paddingRight: 12 }} pointerEvents="box-none">
            <Pressable onPress={() => setFollowing(true)} accessibilityLabel="Centre the map on me"
              style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(14,16,20,0.92)', borderWidth: 1, borderColor: C.line2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="navigation" color={C.acc} size={20} />
            </Pressable>
          </View>
        )}
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: C.bg, padding: 16 }}>
          <Text style={[{ color: C.txt, fontSize: 56, fontWeight: '600', textAlign: 'center' }, num]}>{km.toFixed(2)}</Text>
          <Text style={[s.sub, { textAlign: 'center', marginBottom: 16 }, snap.status === 'paused' && { color: C.acc }]}>{snap.status === 'paused' ? 'Paused' : 'Kilometres'}</Text>
          <View style={[s.row, { marginBottom: 12 }]}>
            <Stat value={fmtTime(live.elapsedSec)} label="Time" />
            <Stat value={pace} label="Avg pace" />
            <Stat value={String(runTileCount)} label="Tiles this run" />
          </View>
          {snap.mode === 'foreground' && (
            <Pressable onPress={() => Linking.openSettings()} style={{ marginBottom: 12 }}>
              <Text style={[s.sub, { textAlign: 'center' }]}>Keep the app open and the screen on: this phone can't track with the screen locked right now.</Text>
              <Text style={[s.sub, { textAlign: 'center', color: C.acc }]}>Check Location is allowed for LevelUp+ in Settings</Text>
            </Pressable>
          )}
          {locked ? (
            <Pressable delayLongPress={600} onLongPress={() => { setLocked(false); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); }}
              style={[s.btn, s.btnGhost]}>
              <Icon name="lock" color={C.txt} />
              <Text style={[s.btnTxt, { color: C.txt }]}>Hold to unlock</Text>
            </Pressable>
          ) : (
            <View style={s.row}>
              {snap.status === 'running'
                ? <Btn title="Pause" kind="ghost" onPress={tracker.pause} style={{ flex: 1 }} />
                : <Btn title="Resume" kind="ghost" onPress={tracker.resume} style={{ flex: 1 }} />}
              <Btn title="Finish" onPress={onFinish} style={{ flex: 1 }} />
              <Pressable onPress={() => setLocked(true)} accessibilityLabel="Lock the screen controls" style={[s.btn, s.btnGhost, { width: 56, paddingHorizontal: 0 }]}>
                <Icon name="lock" color={C.txt} />
              </Pressable>
            </View>
          )}
        </SafeAreaView>
        <ResultModal result={lastResult} onClose={clearResult} />
      </View>
    );
  }

  if (locating) {
    return (
      <View style={s.screen}>
        <MapView ref={mapRef} style={{ flex: 1 }} showsUserLocation userInterfaceStyle="dark"
          initialRegion={snap.current ? { ...snap.current, latitudeDelta: 0.008, longitudeDelta: 0.008 } : { latitude: 1.3521, longitude: 103.8198, latitudeDelta: 0.2, longitudeDelta: 0.2 }} />
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: C.bg, padding: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 8 }}>
            <ActivityIndicator color={C.acc} />
            <Text style={s.title}>Finding GPS</Text>
          </View>
          <Text style={[s.sub, num, { textAlign: 'center', marginTop: 8 }]}>
            {locAcc === null ? 'Waiting for a signal.' : `Accurate to about ${Math.round(locAcc)} m.`} Your run starts by itself once the signal is good.
          </Text>
          {slow && <Text style={[s.sub, { textAlign: 'center', color: C.acc }]}>The signal is weak here. Move into the open, away from tall buildings, or start anyway.</Text>}
          <View style={[s.row, { marginTop: 16 }]}>
            <Btn title="Cancel" kind="ghost" onPress={endLocate} style={{ flex: 1 }} />
            <Btn title="Start anyway" onPress={begin} style={{ flex: 1 }} />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={s.screen}>
      <ScrollView contentContainerStyle={s.pad}>
        <Text style={[s.sub, { marginBottom: 12 }]}>{new Date().toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
        <LevelHeader xp={state.xp} />
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Text style={[s.txt, { fontWeight: '500' }]}>Weekly goal</Text>
            <Text style={[s.sub, num]}>{weekKm.toFixed(1)} / {profile.weeklyGoalKm} km</Text>
          </View>
          <View style={s.bar}><View style={[s.barFill, { width: `${Math.min(100, Math.max(3, (weekKm / profile.weeklyGoalKm) * 100))}%`, backgroundColor: weekKm >= profile.weeklyGoalKm ? C.good : C.acc }]} /></View>
          <Text style={[s.sub, num, { marginTop: 8 }]}>{weekKm >= profile.weeklyGoalKm ? 'Goal reached this week' : `${(profile.weeklyGoalKm - weekKm).toFixed(1)} km to go this week`}</Text>
        </Card>
        <View style={[s.row, { marginBottom: 12 }]}>
          <Stat value={String(liveStreak(state, today))} label={`day streak${state.freezes ? ` · ${state.freezes} freeze${state.freezes > 1 ? 's' : ''}` : ''}`} />
          <Stat value={weekKm.toFixed(1)} label="km this week" />
          <Stat value={String(owned ?? Object.keys(heldTiles(state, today)).length)} label={owned !== null ? 'tiles held' : 'tiles run in'} />
        </View>
        <Btn title="Start run" icon="play" onPress={onStart} style={{ paddingVertical: 20, marginBottom: 12 }} />
        <Card style={{ paddingVertical: 8 }}>
          {nudges.map(([icon, n], i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
              <Icon name={icon} color={C.mut} />
              <Text style={[s.txt, { flex: 1 }]}>{n}</Text>
            </View>
          ))}
        </Card>
        {state.runs[0] && (
          <>
            <SectionLabel>Last run</SectionLabel>
            <Card>
              <Text style={[s.txt, num]}>{state.runs[0].km.toFixed(2)} km · +{state.runs[0].xp} XP{state.runs[0].test ? ' · Test' : ''}</Text>
              <Text style={s.sub}>{new Date(state.runs[0].startedAt).toLocaleString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</Text>
            </Card>
          </>
        )}
      </ScrollView>
      <ResultModal result={lastResult} onClose={clearResult} />

      {/* Shown once, before the phone's own location prompts */}
      <Modal visible={prime} animationType="slide" transparent onRequestClose={() => { wantLocate.current = false; setPrime(false); }} onDismiss={locate}>
        <View style={s.ov}>
          <View style={s.sheet}>
            <Text style={[s.title, { marginBottom: 12 }]}>Let LevelUp+ track your run</Text>
            {([
              ['map-pin', 'Your iPhone will ask for your location. Choose "Allow While Using App" and keep Precise Location on.'],
              ['smartphone', 'Your run keeps tracking with the screen locked or the phone in your pocket. A blue marker at the top of the screen shows it is on.'],
              ['lock', 'Your location is only recorded during a run, and your routes stay private.'],
            ] as const).map(([ic, t]) => (
              <View key={ic} style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
                <Icon name={ic} size={16} color={C.acc} />
                <Text style={[s.txt, { flex: 1 }]}>{t}</Text>
              </View>
            ))}
            <Btn title="Continue" onPress={primeContinue} style={{ marginTop: 4 }} />
            <Btn title="Not now" kind="ghost" onPress={() => { wantLocate.current = false; setPrime(false); }} style={{ marginTop: 8 }} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
