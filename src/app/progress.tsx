import { router } from 'expo-router';
import { Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BadgeHex, Btn, C, Card, Icon, LevelHeader, num, ResultModal, s, SectionLabel } from '../components/ui';
import { BADGES, levelOf, TITLES, xpForLevel } from '../lib/game';
import { makeTestRun, useStore } from '../lib/store';
import { currentPosition } from '../lib/tracker';

const XP_RULES: [string, string][] = [
  ['Every km', '10 XP'],
  ['Past 60 km in a week', 'Half rate'],
  ['Each day of your streak', '+10%, max +50%'],
  ['Start before 8am', '+20%'],
  ['Longest run PB', '+100'],
  ['Pace PB, 3 km or more', '+100'],
  ['Each new tile', '+5'],
  ['Each new badge', '+50'],
  ['Every 7-day streak', '1 freeze, max 2'],
  ['Faster than 2:30/km on average', 'Not counted'],
];

export default function Progress() {
  const { state, addRun, reset, lastResult, clearResult } = useStore();
  const L = levelOf(state.xp);
  const got = Object.keys(state.badges).length;

  const testRun = async () => {
    const pos = (await currentPosition()) ?? { latitude: 1.3508, longitude: 103.8485 };
    addRun(makeTestRun(pos));
  };
  const confirmReset = () =>
    Alert.alert('Reset everything?', 'Deletes all your runs, XP, badges and tiles — on this phone and in your account.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: reset },
    ]);

  return (
    <SafeAreaView edges={['top']} style={s.screen}>
      <ScrollView contentContainerStyle={s.pad}>
        <LevelHeader xp={state.xp} />
        <Btn title={`Run history · ${state.runs.length} runs`} kind="ghost" icon="list" onPress={() => router.navigate('/history')} style={{ marginBottom: 4 }} />

        <SectionLabel>Badges · {got} of {BADGES.length}</SectionLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {BADGES.map((b) => {
            const on = !!state.badges[b.id];
            return (
              <View key={b.id} style={[s.card, { width: '31.5%', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 8, marginBottom: 0 }]}>
                <BadgeHex b={b} on={on} />
                <Text style={{ color: on ? C.txt : C.sec, fontSize: 12, fontWeight: '500', textAlign: 'center', marginTop: 8 }}>{b.name}</Text>
                <Text style={{ color: C.mut, fontSize: 11, lineHeight: 14, textAlign: 'center', marginTop: 2 }}>{b.desc}</Text>
              </View>
            );
          })}
        </View>

        <SectionLabel>Titles</SectionLabel>
        <Card style={{ paddingVertical: 8 }}>
          {TITLES.map(([lv, t], i) => {
            const next = TITLES[i + 1];
            const on = L >= lv;
            return (
              <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
                <Icon name={on ? 'check' : 'lock'} color={on ? C.acc : C.mut} />
                <Text style={[s.txt, { flex: 1, fontWeight: '500', color: on ? C.txt : C.sec }]}>{t}</Text>
                <Text style={[s.sub, num]}>Lv {lv}{next ? `–${next[0] - 1}` : '+'} · ~{Math.round(xpForLevel(lv) / 10)} km</Text>
              </View>
            );
          })}
        </Card>

        <SectionLabel>How XP works</SectionLabel>
        <Card style={{ paddingVertical: 4 }}>
          {XP_RULES.map(([k, v], i) => (
            <View key={k} style={[s.bdRow, i === XP_RULES.length - 1 && { borderBottomWidth: 0 }]}>
              <Text style={s.bdTxt}>{k}</Text>
              <Text style={[s.bdVal, num]}>{v}</Text>
            </View>
          ))}
        </Card>

        <SectionLabel>Tester tools</SectionLabel>
        <Card>
          <Text style={[s.sub, { marginTop: 0, marginBottom: 12 }]}>Adds a fake 3–9 km run starting where you are, to test levels, badges and tiles indoors. Test runs are marked Test in History.</Text>
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
