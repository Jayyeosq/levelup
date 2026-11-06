import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Btn, C, Card, LevelHeader, ResultModal, s, Stat } from '../components/ui';
import { dayOf, fmtPace, heldTiles, levelOf, liveStreak, titleOf, weekOf, xpForLevel } from '../lib/game';
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
      { text: 'Discard', style: 'destructive', onPress: () => tracker.discard() },
      { text: 'Finish & save', onPress: async () => { const run = await tracker.finish(); addRun(run); } },
    ]);
  };

  const today = dayOf(Date.now());
  const nudges = useMemo(() => {
    const out: string[] = [];
    const L = levelOf(state.xp), toNext = (xpForLevel(L + 1) - state.xp) / 10;
    out.push(`⭐ ${Math.max(0.1, toNext).toFixed(1)} km to Level ${L + 1}` + (titleOf(L + 1) !== titleOf(L) ? ` and the ${titleOf(L + 1)} title` : ''));
    const st = liveStreak(state, today);
    if (st > 0 && state.lastRunDay === today - 1) out.push(`🔥 Run today to keep your ${st}-day streak alive`);
    if (st > 0 && state.lastRunDay === today) out.push(`🔥 ${st}-day streak — come back tomorrow to make it ${st + 1}`);
    if (!state.runs.length) out.push('👟 Finish your first run to start claiming tiles on the map');
    const held = Object.keys(heldTiles(state, today)).length;
    if (held) out.push(`🚩 You hold ${held} tiles. They fade after 30 days without a run there.`);
    return out;
  }, [state, today]);

  const wk = weekOf(today);
  const weekKm = state.runs.filter((r) => !r.flagged && weekOf(dayOf(r.startedAt)) === wk).reduce((m, r) => m + r.km, 0);

  if (snap.status !== 'idle') {
    return (
      <View style={s.screen}>
        <MapView ref={mapRef} style={{ flex: 1 }} showsUserLocation userInterfaceStyle="dark"
          initialRegion={snap.current ? { ...snap.current, latitudeDelta: 0.008, longitudeDelta: 0.008 } : { latitude: 1.3521, longitude: 103.8198, latitudeDelta: 0.2, longitudeDelta: 0.2 }}>
          {snap.route.length > 1 && <Polyline coordinates={snap.route} strokeColor={C.acc} strokeWidth={5} />}
        </MapView>
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: C.bg, padding: 16 }}>
          <Text style={{ color: C.txt, fontSize: 56, fontWeight: '800', textAlign: 'center' }}>{km.toFixed(2)}</Text>
          <Text style={[s.sub, { textAlign: 'center', marginTop: -4, marginBottom: 12 }]}>kilometres{snap.status === 'paused' ? ' · PAUSED' : ''}</Text>
          <View style={[s.row, { marginBottom: 12 }]}>
            <Stat value={fmtTime(live.elapsedSec)} label="Time" />
            <Stat value={pace} label="Avg pace" />
            <Stat value={snap.gpsAccuracy ? `±${Math.round(snap.gpsAccuracy)}m` : '…'} label="GPS" />
          </View>
          {snap.mode === 'foreground' && (
            <Text style={[s.sub, { textAlign: 'center', marginBottom: 10 }]}>Keep the app open — screen will stay on while tracking.</Text>
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
        <Text style={[s.sub, { marginBottom: 10, fontSize: 15 }]}>{profile.avatar} Hi{profile.name ? `, ${profile.name}` : ''}! Ready to run?</Text>
        <LevelHeader xp={state.xp} />
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={[s.txt, { fontWeight: '700' }]}>🎯 Weekly goal</Text>
            <Text style={s.sub}>{weekKm.toFixed(1)} / {profile.weeklyGoalKm} km</Text>
          </View>
          <View style={s.bar}><View style={[s.barFill, { width: `${Math.min(100, Math.max(3, (weekKm / profile.weeklyGoalKm) * 100))}%`, backgroundColor: weekKm >= profile.weeklyGoalKm ? C.good : C.acc }]} /></View>
          <Text style={[s.sub, { marginTop: 6 }]}>{weekKm >= profile.weeklyGoalKm ? 'Goal smashed this week! 🎉' : `${(profile.weeklyGoalKm - weekKm).toFixed(1)} km to go this week`}</Text>
        </Card>
        <View style={[s.row, { marginBottom: 12 }]}>
          <Stat value={`${liveStreak(state, today)}🔥`} label={`Streak${state.freezes ? ` · ❄️${state.freezes}` : ''}`} />
          <Stat value={weekKm.toFixed(1)} label="km this week" />
          <Stat value={String(Object.keys(heldTiles(state, today)).length)} label="tiles held" />
        </View>
        <Btn title="▶  Start run" onPress={onStart} style={{ paddingVertical: 22, marginBottom: 12 }} />
        <Card>
          {nudges.map((n, i) => <Text key={i} style={[s.txt, { paddingVertical: 6 }]}>{n}</Text>)}
        </Card>
        {state.runs[0] && (
          <>
            <Text style={s.sec}>Last run</Text>
            <Card>
              <Text style={s.txt}>{state.runs[0].km.toFixed(2)} km · +{state.runs[0].xp} XP{state.runs[0].test ? ' · 🧪 test' : ''}</Text>
              <Text style={s.sub}>{new Date(state.runs[0].startedAt).toLocaleString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</Text>
            </Card>
          </>
        )}
      </ScrollView>
      <ResultModal result={lastResult} onClose={clearResult} />
    </SafeAreaView>
  );
}
