import React from 'react';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { levelOf, RunResult, titleOf, xpForLevel, fmtPace } from '../lib/game';

// Design tokens. Cool graphite neutrals, one orange accent.
// Spacing sits on a 4px grid. Weights: 400, 500, 600 only.
export const C = {
  bg: '#0E0F12',
  card: '#16181D',
  card2: '#1E2128',
  line: 'rgba(238,240,244,0.08)',
  line2: 'rgba(238,240,244,0.14)',
  txt: '#EEF0F4', // primary text
  sec: '#A3A9B6', // secondary text
  mut: '#6E7584', // muted text
  acc: '#FF6A2B',
  onAcc: '#1A0F08', // text on the accent (white on orange fails contrast)
  good: '#4CC38A',
  bad: '#F2555A',
};

export const num: TextStyle = { fontVariant: ['tabular-nums'] };

export type IconName = React.ComponentProps<typeof Feather>['name'];

export function Icon({ name, color = C.sec, size = 18 }: { name: IconName; color?: string; size?: number }) {
  return <Feather name={name} size={size} color={color} />;
}

// Signature shape: the hexagon, same as the territory tiles.
export function Hex({ size, filled = true, color = C.acc, children }: { size: number; filled?: boolean; color?: string; children?: React.ReactNode }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <MaterialCommunityIcons name={filled ? 'hexagon' : 'hexagon-outline'} size={size} color={color} style={{ position: 'absolute' }} />
      {children}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Btn({ title, onPress, kind = 'primary', icon, style }: { title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger'; icon?: IconName; style?: ViewStyle }) {
  const color = kind === 'primary' ? C.onAcc : kind === 'ghost' ? C.txt : '#fff';
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.btn, kind === 'primary' && s.btnPri, kind === 'ghost' && s.btnGhost, kind === 'danger' && s.btnDanger, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }, style]}>
      {icon && <Icon name={icon} color={color} />}
      <Text style={[s.btnTxt, { color }]}>{title}</Text>
    </Pressable>
  );
}

export function LevelHeader({ xp }: { xp: number }) {
  const L = levelOf(xp), lo = xpForLevel(L), hi = xpForLevel(L + 1);
  const pct = Math.max(3, ((xp - lo) / (hi - lo)) * 100);
  return (
    <View style={s.head}>
      <Hex size={60}><Text style={[s.hexNum, num]}>{L}</Text></Hex>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>{titleOf(L)}</Text>
        <Text style={[s.sub, num]}>Level {L} · {xp.toLocaleString()} XP · {(hi - xp).toLocaleString()} to Level {L + 1}</Text>
        <View style={s.bar}><View style={[s.barFill, { width: `${pct}%` }]} /></View>
      </View>
    </View>
  );
}

export function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={s.stat}><Text style={[s.statVal, num]}>{value}</Text><Text style={s.statLbl}>{label}</Text></View>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={s.sec}>{children}</Text>;
}

export function BadgeHex({ b, on, size = 52 }: { b: { label?: string; icon?: string }; on: boolean; size?: number }) {
  const ink = on ? C.onAcc : C.mut;
  return (
    <Hex size={size} filled={on} color={on ? C.acc : C.line2}>
      {b.icon
        ? <Icon name={b.icon as IconName} color={ink} size={Math.round(size * 0.36)} />
        : <Text style={[{ color: ink, fontSize: Math.round(size * 0.26), fontWeight: '600' }, num]}>{b.label}</Text>}
    </Hex>
  );
}

export function ResultModal({ result, onClose }: { result: RunResult | null; onClose: () => void }) {
  if (!result) return null;
  const { run } = result;
  const lvUp = result.levelAfter > result.levelBefore;
  const newTitle = result.titleAfter !== result.titleBefore;
  const b = result.battle;
  const pl = (n: number) => (n === 1 ? '' : 's');
  const battleRows: [number, IconName, string, string][] = b ? [
    [b.captured, 'flag', C.acc, `Took ${b.captured} tile${pl(b.captured)}${b.capturedFrom ? ` from @${b.capturedFrom}` : ''}`],
    [b.claimed, 'plus-circle', C.good, `Claimed ${b.claimed} tile${pl(b.claimed)} nobody held`],
    [b.defended, 'shield', C.txt, `Defended ${b.defended} of your tiles`],
    [b.contested, 'target', C.sec, `${b.contested} tile${pl(b.contested)} still held by rivals`],
  ] : [];
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.ov}>
        <View style={s.sheet}>
          <ScrollView>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              {run.flagged
                ? <Hex size={72} filled={false} color={C.line2}><Icon name="slash" color={C.mut} size={24} /></Hex>
                : <Hex size={72}><Text style={[s.hexNumLg, num]}>{result.levelAfter}</Text></Hex>}
              <Text style={[s.bigXp, num]}>{run.flagged ? 'Run not counted' : `+${run.xp} XP`}</Text>
              <Text style={[s.sub, num, { textAlign: 'center' }]}>
                {run.km.toFixed(2)} km · {Math.floor(run.durationSec / 60)} min{run.km > 0.2 ? ` · ${fmtPace(run.durationSec / 60 / run.km)}` : ''}
              </Text>
            </View>

            {lvUp && (
              <View style={s.hl}>
                <Text style={s.hlBig}>Level {result.levelAfter}</Text>
                <Text style={s.hlTxt}>{newTitle ? `New title: ${result.titleAfter}` : result.titleAfter}</Text>
              </View>
            )}

            {battleRows.some((r) => r[0] > 0) && (
              <View style={[s.hl, { alignItems: 'stretch', borderColor: C.line2 }]}>
                <Text style={[s.eventTitle, { marginBottom: 4 }]}>On the Battle map</Text>
                {battleRows.filter((r) => r[0] > 0).map(([, icon, color, text]) => (
                  <View key={icon} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 }}>
                    <Icon name={icon} color={color} size={16} />
                    <Text style={[s.txt, num, { flex: 1 }]}>{text}</Text>
                  </View>
                ))}
              </View>
            )}

            {result.newBadges.map((b) => (
              <View key={b.id} style={s.event}>
                <BadgeHex b={b} on size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={s.eventTitle}>{b.name}</Text>
                  <Text style={s.sub}>{b.desc}</Text>
                </View>
              </View>
            ))}
            {result.earnedFreeze && (
              <View style={s.event}><Icon name="cloud-snow" /><Text style={[s.txt, { flex: 1 }]}>7-day streak. You earned a streak freeze</Text></View>
            )}
            {result.usedFreezes > 0 && (
              <View style={s.event}><Icon name="cloud-snow" /><Text style={[s.txt, { flex: 1 }]}>Used {result.usedFreezes} streak freeze to save your streak</Text></View>
            )}

            <View style={{ marginTop: 8 }}>
              {run.breakdown.map(([t, v], i) => (
                <View key={i} style={s.bdRow}><Text style={s.bdTxt}>{t}</Text>{v !== null && <Text style={[s.bdVal, num]}>+{v}</Text>}</View>
              ))}
              {!run.flagged && (
                <View style={[s.bdRow, { borderBottomWidth: 0 }]}>
                  <Text style={[s.bdTxt, { fontWeight: '600', color: C.txt }]}>Total</Text>
                  <Text style={[s.bdVal, num, { color: C.acc, fontWeight: '600' }]}>+{run.xp} XP</Text>
                </View>
              )}
            </View>
            <Btn title="Nice" onPress={onClose} style={{ marginTop: 16 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { padding: 16, paddingBottom: 40 },
  card: { backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 12 },
  btn: { flexDirection: 'row', gap: 8, borderRadius: 12, paddingVertical: 16, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card2 },
  btnPri: { backgroundColor: C.acc },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.line2 },
  btnDanger: { backgroundColor: C.bad },
  btnTxt: { fontWeight: '600', fontSize: 16 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 },
  hexNum: { color: C.onAcc, fontSize: 20, fontWeight: '600' },
  hexNumLg: { color: C.onAcc, fontSize: 24, fontWeight: '600' },
  title: { color: C.txt, fontSize: 20, fontWeight: '600' },
  sub: { color: C.sec, fontSize: 13, lineHeight: 18, marginTop: 2 },
  txt: { color: C.txt, fontSize: 15, lineHeight: 20 },
  bar: { height: 6, backgroundColor: C.card2, borderRadius: 3, overflow: 'hidden', marginTop: 8 },
  barFill: { height: '100%', backgroundColor: C.acc, borderRadius: 3 },
  stat: { flex: 1, backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  statVal: { color: C.txt, fontSize: 20, fontWeight: '600' },
  statLbl: { color: C.mut, fontSize: 12, marginTop: 2 },
  sec: { color: C.mut, fontSize: 13, fontWeight: '500', marginTop: 24, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8 },
  ov: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, maxHeight: '88%' },
  bigXp: { color: C.txt, fontSize: 28, fontWeight: '600', textAlign: 'center', marginTop: 12 },
  hl: { backgroundColor: C.card2, borderRadius: 12, padding: 16, marginBottom: 8, alignItems: 'center', borderWidth: 1, borderColor: C.acc },
  hlBig: { color: C.txt, fontSize: 20, fontWeight: '600' },
  hlTxt: { color: C.sec, fontSize: 14, marginTop: 2, textAlign: 'center' },
  event: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  eventTitle: { color: C.txt, fontSize: 15, fontWeight: '500' },
  bdRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line },
  bdTxt: { color: C.sec, fontSize: 14, flex: 1 },
  bdVal: { color: C.txt, fontSize: 14, fontWeight: '500' },
});
