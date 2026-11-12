import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Btn, C, Card, Icon, IconName, LevelHeader, num, ResultModal, s, SectionLabel, Stat } from '../components/ui';
import { dayOf, fmtPace, heldTiles, levelOf, liveStreak, titleOf, weekOf, xpForLevel } from '../lib/game';
import { useAuth } from '../lib/auth';
import * as battle from '../lib/battle';
import { useStore } from '../lib/store';
import * as tracker from '../lib/tracker';

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
  useEffect(() => {
    if (snap.current && mapRef.current) mapRef.current.animateCamera({ center: snap.current, zoom: 16 }, { duration: 500 });
  }, [snap.current]);

  const live = tracker.snapshot();
  const km = live.distanceM / 1000;
  const pace = km > 0.05 ? fmtPace(live.elapsedSec / 60 / km) : '–:––';

  const onStart = async () => {
    const r = await tracker.start();
    if (!r.ok) Alert.alert('Location needed', r.message ?? 'Please allow location access.');
  };
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

  if (snap.status !== 'idle') {
    return (
      <View style={s.screen}>
        <MapView ref={mapRef} style={{ flex: 1 }} showsUserLocation userInterfaceStyle="dark"
          initialRegion={snap.current ? { ...snap.current, latitudeDelta: 0.008, longitudeDelta: 0.008 } : { latitude: 1.3521, longitude: 103.8198, latitudeDelta: 0.2, longitudeDelta: 0.2 }}>
          {snap.segments.map((seg, i) => seg.length > 1 && <Polyline key={i} coordinates={seg} strokeColor={C.acc} strokeWidth={5} />)}
        </MapView>
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: C.bg, padding: 16 }}>
          <Text style={[{ color: C.txt, fontSize: 56, fontWeight: '600', textAlign: 'center' }, num]}>{km.toFixed(2)}</Text>
          <Text style={[s.sub, { textAlign: 'center', marginBottom: 16 }, snap.status === 'paused' && { color: C.acc }]}>{snap.status === 'paused' ? 'Paused' : 'Kilometres'}</Text>
          <View style={[s.row, { marginBottom: 12 }]}>
            <Stat value={fmtTime(live.elapsedSec)} label="Time" />
            <Stat value={pace} label="Avg pace" />
            <Stat value={snap.gpsAccuracy ? `±${Math.round(snap.gpsAccuracy)}m` : '…'} label="GPS" />
          </View>
          {snap.mode === 'foreground' && (
            <Text style={[s.sub, { textAlign: 'center', marginBottom: 12 }]}>Keep the app open. The screen stays on while tracking</Text>
          )}
          <View style={s.row}>
            {snap.status === 'running'
              ? <Btn title="Pause" kind="ghost" onPress={tracker.pause} style={{ flex: 1 }} />
              : <Btn title="Resume" kind="ghost" onPress={tracker.resume} style={{ flex: 1 }} />}
            <Btn title="Finish" onPress={onFinish} style={{ flex: 1 }} />
          </View>
        </SafeAreaView>
        <ResultModal result={lastResult} onClose={clearResult} />
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
    </SafeAreaView>
  );
}
