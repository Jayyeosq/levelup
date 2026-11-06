import { Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Btn, C, Card, LevelHeader, ResultModal, s } from '../components/ui';
import { BADGES, levelOf, TITLES, xpForLevel } from '../lib/game';
import { makeTestRun, useStore } from '../lib/store';
import { currentPosition } from '../lib/tracker';

export default function Progress() {
  const { state, addRun, reset, lastResult, clearResult } = useStore();
  const L = levelOf(state.xp);
  const got = Object.keys(state.badges).length;

  const testRun = async () => {
    const pos = (await currentPosition()) ?? { latitude: 1.3508, longitude: 103.8485 };
    addRun(makeTestRun(pos));
  };
  const confirmReset = () =>
    Alert.alert('Reset everything?', 'Deletes all runs, XP, badges and tiles on this phone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: reset },
    ]);

  return (
    <SafeAreaView edges={['top']} style={s.screen}>
      <ScrollView contentContainerStyle={s.pad}>
        <LevelHeader xp={state.xp} />

        <Text style={s.sec}>Badges · {got}/{BADGES.length}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {BADGES.map((b) => {
            const on = !!state.badges[b.id];
            return (
              <View key={b.id} style={[s.card, { width: '31.5%', alignItems: 'center', padding: 10, marginBottom: 0, opacity: on ? 1 : 0.35 }]}>
                <Text style={{ fontSize: 28 }}>{b.emoji}</Text>
                <Text style={{ color: C.txt, fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 4 }}>{b.name}</Text>
                <Text style={{ color: C.mut, fontSize: 10, textAlign: 'center', marginTop: 2 }}>{b.desc}</Text>
              </View>
            );
          })}
        </View>

        <Text style={s.sec}>Titles</Text>
        <Card>
          {TITLES.map(([lv, t], i) => {
            const next = TITLES[i + 1];
            const on = L >= lv;
            return (
              <View key={t} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, opacity: on ? 1 : 0.4 }}>
                <Text style={[s.txt, { fontWeight: '700' }]}>{on ? '✅' : '🔒'} {t}</Text>
                <Text style={s.sub}>Lv {lv}{next ? `–${next[0] - 1}` : '+'} · ~{Math.round(xpForLevel(lv) / 10)} km</Text>
              </View>
            );
          })}
        </Card>

        <Text style={s.sec}>How XP works</Text>
        <Card>
          <Text style={[s.sub, { lineHeight: 21, fontSize: 13.5 }]}>
            {'10 XP per km (½ rate after 60 km in a week)\n🔥 Streak: +10% per day in a row, max +50%\n🌅 Start before 8am: +20%\n🚀 Longest-run PB +100 · ⚡ Pace PB (3 km+) +100\n🚩 Each new tile captured +5 · 🎖️ Each badge +50\n❄️ Every 7-day streak earns a streak freeze (max 2)\n🛑 Runs faster than 2:30/km on average don’t count'}
          </Text>
        </Card>

        <Text style={s.sec}>🧪 Tester tools</Text>
        <Card>
          <Text style={[s.sub, { marginBottom: 10 }]}>Add a fake 3–9 km run starting where you are, to test levels, badges and tiles indoors. Test runs are marked 🧪.</Text>
          <View style={s.row}>
            <Btn title="Add test run" kind="ghost" onPress={testRun} style={{ flex: 1 }} />
            <Btn title="Reset all" kind="ghost" onPress={confirmReset} style={{ flex: 1 }} />
          </View>
        </Card>
      </ScrollView>
      <ResultModal result={lastResult} onClose={clearResult} />
    </SafeAreaView>
  );
}
