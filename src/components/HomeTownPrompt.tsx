// Asks a runner with no home town to pick one (once), right after their account has loaded.
// Without a home town the Kings card and the "My town" leaderboard are empty.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useAuth } from '../lib/auth';
import { areaOfTile, tileOf, TOWNS } from '../lib/geo';
import { useStore } from '../lib/store';
import { currentPosition } from '../lib/tracker';
import { Btn, C, s } from './ui';

const askedKey = (uid: string) => `levelup.town.asked.${uid}`;
const NAMES = TOWNS.map(([t]) => t).sort();

export default function HomeTownPrompt() {
  const { userId } = useAuth();
  const { profile, setProfile, sync } = useStore();
  const [open, setOpen] = useState(false);
  const [near, setNear] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || sync !== 'synced' || profile.homeTown) { setOpen(false); return; }
    let live = true;
    AsyncStorage.getItem(askedKey(userId)).then((v) => { if (live && v !== '1') setOpen(true); }).catch(() => {});
    return () => { live = false; };
  }, [userId, sync, profile.homeTown]);

  // If location is already allowed, put the nearest town first.
  useEffect(() => {
    if (!open) return;
    currentPosition().then((p) => { const t = p ? areaOfTile(tileOf(p)) : null; if (t && NAMES.includes(t)) setNear(t); });
  }, [open]);

  const done = () => { setOpen(false); if (userId) AsyncStorage.setItem(askedKey(userId), '1').catch(() => {}); };
  const pick = (t: string) => { setProfile({ homeTown: t }); done(); };
  const list = near ? [near, ...NAMES.filter((t) => t !== near)] : NAMES;

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={done}>
      <View style={s.ov}>
        <View style={s.sheet}>
          <Text style={s.title}>Where's your turf?</Text>
          <Text style={[s.sub, { marginBottom: 12 }]}>Pick your home town to see its King and join its weekly leaderboard. You can change it later on the Profile tab.</Text>
          <ScrollView>
            {list.map((t) => (
              <Pressable key={t} onPress={() => pick(t)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line }}>
                <Text style={[s.txt, { flex: 1 }, t === near && { fontWeight: '600' }]}>{t}</Text>
                {t === near && <Text style={{ color: C.acc, fontSize: 12, fontWeight: '500' }}>Near you</Text>}
              </Pressable>
            ))}
          </ScrollView>
          <Btn title="Skip for now" kind="ghost" onPress={done} style={{ marginTop: 12 }} />
        </View>
      </View>
    </Modal>
  );
}
