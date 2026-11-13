// "While you were away": the reward screen for watch runs that synced from Apple Health.
// Runs recorded in the app get their own result screen when you tap Finish; this is the
// same moment for runs that arrive quietly in the background.
import { Modal, ScrollView, Text, View } from 'react-native';
import { useStore } from '../lib/store';
import { newlyUnlocked } from '../lib/avatars';
import { BadgeHex, BattleBox, Btn, Hex, num, s, UnlockedAvatars } from './ui';

export default function SyncSummary() {
  const { syncSummary: v, clearSyncSummary } = useStore();
  if (!v) return null;
  return (
    <Modal visible animationType="slide" transparent onRequestClose={clearSyncSummary}>
      <View style={s.ov}>
        <View style={s.sheet}>
          <ScrollView>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <Hex size={72}><Text style={[s.hexNumLg, num]}>{v.levelAfter}</Text></Hex>
              <Text style={[s.sub, { marginTop: 12 }]}>While you were away</Text>
              <Text style={[s.bigXp, num, { marginTop: 2 }]}>{v.xp > 0 ? `+${v.xp.toLocaleString()} XP` : 'Runs synced'}</Text>
              <Text style={[s.sub, num, { textAlign: 'center' }]}>
                {v.runs} watch run{v.runs === 1 ? '' : 's'} synced · {v.km.toFixed(1)} km
              </Text>
            </View>

            {v.levelAfter > v.levelBefore && (
              <View style={s.hl}>
                <Text style={s.hlBig}>Level {v.levelAfter}</Text>
                <Text style={s.hlTxt}>{v.newTitle ? `New title: ${v.title}` : v.title}</Text>
              </View>
            )}

            <BattleBox b={v.battle} />

            {v.badges.map((b) => (
              <View key={b.id} style={s.event}>
                <BadgeHex b={b} on size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={s.eventTitle}>{b.name}</Text>
                  <Text style={s.sub}>{b.desc}</Text>
                </View>
              </View>
            ))}

            <UnlockedAvatars list={newlyUnlocked(v.levelBefore, v.levelAfter, v.badges.map((b) => b.id))} />

            <Btn title="Nice" onPress={clearSyncSummary} style={{ marginTop: 16 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
