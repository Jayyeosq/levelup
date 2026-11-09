import { router } from 'expo-router';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, Icon, num, s } from '../components/ui';
import { fmtPace } from '../lib/game';
import { useStore } from '../lib/store';

export default function History() {
  const { state, removeRun } = useStore();
  const total = state.runs.filter((r) => !r.flagged).reduce((m, r) => m + r.km, 0);

  const onLong = (id: string) =>
    Alert.alert('Delete this run?', 'XP, streaks and tiles will be recalculated without it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removeRun(id) },
    ]);

  return (
    <SafeAreaView edges={['top']} style={s.screen}>
      <FlatList
        data={state.runs}
        keyExtractor={(r) => r.id}
        contentContainerStyle={s.pad}
        ListHeaderComponent={
          <View style={{ marginBottom: 16 }}>
            <Pressable onPress={() => router.navigate('/progress')} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 }}>
              <Icon name="chevron-left" size={18} color={C.acc} />
              <Text style={{ color: C.acc, fontWeight: '500' }}>Progress</Text>
            </Pressable>
            <Text style={s.title}>History</Text>
            <Text style={[s.sub, num]}>{state.runs.length} runs · {total.toFixed(1)} km total · long-press a run to delete it</Text>
          </View>
        }
        ListEmptyComponent={<Text style={s.sub}>No runs yet. Start one from the Run tab</Text>}
        renderItem={({ item: r }) => (
          <Pressable onLongPress={() => onLong(r.id)} style={[s.card, { flexDirection: 'row', alignItems: 'center' }]}>
            <View style={{ flex: 1 }}>
              <Text style={[s.txt, num, { fontWeight: '500' }]}>
                {r.km.toFixed(2)} km
                <Text style={{ color: C.mut, fontWeight: '400', fontSize: 13 }}>{r.early ? '  ·  Before 8am' : ''}{r.test ? '  ·  Test' : ''}</Text>
              </Text>
              <Text style={[s.sub, num]}>
                {new Date(r.startedAt).toLocaleString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                {r.km > 0.2 ? ` · ${fmtPace(r.durationSec / 60 / r.km)}` : ''} · {Object.keys(r.tiles).length} tiles
              </Text>
              {r.flagged && <Text style={[s.sub, { color: C.bad }]}>{r.flagged}</Text>}
            </View>
            <Text style={[{ color: r.flagged ? C.mut : C.txt, fontWeight: '500', fontSize: 15 }, num]}>{r.flagged ? '0 XP' : `+${r.xp} XP`}</Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
