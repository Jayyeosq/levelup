import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { levelOf, RunResult, titleOf, xpForLevel, fmtPace } from '../lib/game';

export const C = {
  bg: '#0E0F13', card: '#171920', card2: '#1F222B', line: '#2A2E39', txt: '#EEF0F4', mut: '#8A90A0',
  acc: '#FF6A2B', acc2: '#FFB02E', good: '#3DDC84', bad: '#FF4D5E',
};

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Btn({ title, onPress, kind = 'primary', style }: { title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger'; style?: ViewStyle }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.btn, kind === 'primary' && s.btnPri, kind === 'ghost' && s.btnGhost, kind === 'danger' && s.btnDanger, pressed && { opacity: 0.8 }, style]}>
      <Text style={[s.btnTxt, kind === 'ghost' && { color: C.mut }]}>{title}</Text>
    </Pressable>
  );
}

export function LevelHeader({ xp }: { xp: number }) {
  const L = levelOf(xp), lo = xpForLevel(L), hi = xpForLevel(L + 1);
  const pct = Math.max(3, ((xp - lo) / (hi - lo)) * 100);
  return (
    <View style={s.head}>
      <View style={s.lvl}><Text style={s.lvlNum}>{L}</Text><Text style={s.lvlTag}>LVL</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>{titleOf(L)}</Text>
        <Text style={s.sub}>{xp.toLocaleString()} XP · {(hi - xp).toLocaleString()} XP to Level {L + 1}</Text>
        <View style={s.bar}><View style={[s.barFill, { width: `${pct}%` }]} /></View>
      </View>
    </View>
  );
}

export function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={s.stat}><Text style={s.statVal}>{value}</Text><Text style={s.statLbl}>{label}</Text></View>
  );
}

export function ResultModal({ result, onClose }: { result: RunResult | null; onClose: () => void }) {
  if (!result) return null;
  const { run } = result;
  const lvUp = result.levelAfter > result.levelBefore;
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.ov}>
        <View style={s.sheet}>
          <ScrollView>
            <Text style={s.bigEmoji}>{run.flagged ? '🤔' : lvUp ? '⭐' : '🏃'}</Text>
            <Text style={s.bigXp}>{run.flagged ? 'Run not counted' : `+${run.xp} XP`}</Text>
            <Text style={[s.sub, { textAlign: 'center', marginBottom: 12 }]}>
              {run.km.toFixed(2)} km · {Math.floor(run.durationSec / 60)} min{run.km > 0.2 ? ` · ${fmtPace(run.durationSec / 60 / run.km)}` : ''}
            </Text>
            {lvUp && (
              <View style={s.hl}><Text style={s.hlBig}>LEVEL {result.levelAfter}!</Text>
                <Text style={s.hlTxt}>{result.titleAfter !== result.titleBefore ? `New title unlocked: ${result.titleAfter} 🏷️` : result.titleAfter}</Text></View>
            )}
            {result.newBadges.length > 0 && (
              <View style={s.hl}><Text style={s.hlTxt}>{result.newBadges.map((b) => `${b.emoji} ${b.name}`).join('   ')}</Text></View>
            )}
            {result.earnedFreeze && <View style={s.hl}><Text style={s.hlTxt}>❄️ 7-day streak! You earned a streak freeze.</Text></View>}
            {result.usedFreezes > 0 && <View style={s.hl}><Text style={s.hlTxt}>❄️ Used {result.usedFreezes} streak freeze to save your streak.</Text></View>}
            {run.breakdown.map(([t, v], i) => (
              <View key={i} style={s.bdRow}><Text style={s.bdTxt}>{t}</Text>{v !== null && <Text style={s.bdVal}>+{v}</Text>}</View>
            ))}
            {!run.flagged && <View style={[s.bdRow, { borderBottomWidth: 0 }]}><Text style={[s.bdTxt, { fontWeight: '800', fontSize: 17 }]}>Total</Text><Text style={[s.bdVal, { fontSize: 17 }]}>+{run.xp} XP</Text></View>}
            <Btn title="Nice 💪" onPress={onClose} style={{ marginTop: 14 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { padding: 16, paddingBottom: 40 },
  card: { backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12 },
  btn: { borderRadius: 14, paddingVertical: 15, paddingHorizontal: 16, alignItems: 'center', backgroundColor: C.card2 },
  btnPri: { backgroundColor: C.acc },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.line },
  btnDanger: { backgroundColor: C.bad },
  btnTxt: { color: '#fff', fontWeight: '800', fontSize: 16 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 },
  lvl: { width: 60, height: 60, borderRadius: 30, borderWidth: 4, borderColor: C.acc, alignItems: 'center', justifyContent: 'center' },
  lvlNum: { color: C.txt, fontSize: 22, fontWeight: '800' },
  lvlTag: { color: C.acc, fontSize: 9, fontWeight: '800', marginTop: -3 },
  title: { color: C.txt, fontSize: 21, fontWeight: '800' },
  sub: { color: C.mut, fontSize: 13, marginTop: 2 },
  txt: { color: C.txt, fontSize: 15, lineHeight: 21 },
  bar: { height: 8, backgroundColor: C.line, borderRadius: 6, overflow: 'hidden', marginTop: 7 },
  barFill: { height: '100%', backgroundColor: C.acc, borderRadius: 6 },
  stat: { flex: 1, backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 14, paddingVertical: 10, alignItems: 'center' },
  statVal: { color: C.txt, fontSize: 19, fontWeight: '800' },
  statLbl: { color: C.mut, fontSize: 11, marginTop: 2 },
  sec: { color: C.mut, fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginTop: 16, marginBottom: 8, marginLeft: 2 },
  row: { flexDirection: 'row', gap: 8 },
  ov: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 36, maxHeight: '88%' },
  bigEmoji: { fontSize: 52, textAlign: 'center' },
  bigXp: { color: C.txt, fontSize: 30, fontWeight: '800', textAlign: 'center' },
  hl: { backgroundColor: 'rgba(255,106,43,0.15)', borderColor: C.acc, borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 10, alignItems: 'center' },
  hlBig: { color: C.txt, fontSize: 21, fontWeight: '800' },
  hlTxt: { color: C.txt, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  bdRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line, borderStyle: 'dashed' },
  bdTxt: { color: C.txt, fontSize: 14, flex: 1 },
  bdVal: { color: C.acc2, fontSize: 14, fontWeight: '800' },
});
