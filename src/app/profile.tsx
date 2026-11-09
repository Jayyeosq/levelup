import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Btn, C, Card, Icon, s, SectionLabel } from '../components/ui';
import { levelOf, titleOf } from '../lib/game';
import { TOWNS } from '../lib/geo';
import { useAuth } from '../lib/auth';
import { useStore } from '../lib/store';
import * as strava from '../lib/strava';

const AVATARS = ['🏃', '🏃‍♀️', '🦊', '🐯', '🦁', '🐺', '🐼', '🦅', '🐉', '⚡', '🔥', '🚀'];
const STRAVA_ORANGE = '#FC4C02';

const input = { backgroundColor: C.card2, borderColor: C.line, borderWidth: 1, borderRadius: 12, padding: 12, color: C.txt, fontSize: 15 } as const;

export default function ProfileScreen() {
  const { profile, setProfile, state, importRuns, sync, resync } = useStore();
  const { email, signOut } = useAuth();
  const [townsOpen, setTownsOpen] = useState(false);
  const L = levelOf(state.xp);

  // ---- Strava ----
  const [tokens, setTokens] = useState<strava.StravaTokens | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { strava.loadTokens().then(setTokens); }, []);

  const doConnect = async () => {
    try {
      const t = await strava.connect();
      if (!t) return; // user closed the sheet
      setTokens(t);
      Alert.alert('Strava connected', 'Import your recent runs to earn XP for them?', [
        { text: 'Later', style: 'cancel' },
        { text: 'Import last 90 days', onPress: () => doImport(90) },
      ]);
    } catch (e: any) { Alert.alert('Could not connect', e?.message ?? String(e)); }
  };

  const doImport = async (days: number) => {
    setBusy('Fetching runs from Strava…');
    try {
      const runs = await strava.fetchRuns(days, (n) => setBusy(`Fetching runs from Strava… ${n}`));
      const r = importRuns(runs);
      Alert.alert('Import done', r.added ? `Imported ${r.added} run${r.added > 1 ? 's' : ''} · +${r.xpGained.toLocaleString()} XP` : 'No new runs. Everything is already imported.');
    } catch (e: any) { Alert.alert('Import failed', e?.message ?? String(e)); }
    finally { setBusy(null); }
  };

  const doDisconnect = () => Alert.alert('Disconnect Strava?', 'Runs you already imported stay in LevelUp+.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Disconnect', style: 'destructive', onPress: async () => { await strava.disconnect(); setTokens(null); } },
  ]);

  const stravaRuns = state.runs.filter((r) => r.source === 'strava').length;

  return (
    <SafeAreaView edges={['top']} style={s.screen}>
      <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
        {/* Identity */}
        <View style={{ alignItems: 'center', marginBottom: 8 }}>
          <Text style={{ fontSize: 64 }}>{profile.avatar}</Text>
          <Text style={[s.title, { marginTop: 4 }]}>@{profile.name || 'runner'}</Text>
          <Text style={s.sub}>Level {L} · {titleOf(L)}{profile.homeTown ? ` · ${profile.homeTown}` : ''}</Text>
        </View>

        <SectionLabel>Profile</SectionLabel>
        <Card>
          <Text style={[s.sub, { marginTop: 0, marginBottom: 8 }]}>Username (public)</Text>
          <View style={[input, { opacity: 0.8 }]}><Text style={{ color: C.txt, fontSize: 15 }}>@{profile.name || '…'}</Text></View>

          <Text style={[s.sub, { marginTop: 16, marginBottom: 8 }]}>Avatar</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {AVATARS.map((a) => (
              <Pressable key={a} onPress={() => setProfile({ avatar: a })}
                style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card2, borderWidth: 2, borderColor: profile.avatar === a ? C.acc : 'transparent' }}>
                <Text style={{ fontSize: 24 }}>{a}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={[s.sub, { marginTop: 16, marginBottom: 8 }]}>Home town, your turf to defend</Text>
          <Pressable onPress={() => setTownsOpen(true)} style={input}>
            <Text style={{ color: profile.homeTown ? C.txt : C.mut, fontSize: 15 }}>{profile.homeTown || 'Choose your town'}</Text>
          </Pressable>

          <Text style={[s.sub, { marginTop: 16, marginBottom: 8 }]}>Weekly goal</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Btn title="−" kind="ghost" onPress={() => setProfile({ weeklyGoalKm: Math.max(5, profile.weeklyGoalKm - 5) })} style={{ width: 56 }} />
            <Text style={[s.title, { flex: 1, textAlign: 'center' }]}>{profile.weeklyGoalKm} km</Text>
            <Btn title="+" kind="ghost" onPress={() => setProfile({ weeklyGoalKm: Math.min(150, profile.weeklyGoalKm + 5) })} style={{ width: 56 }} />
          </View>
        </Card>

        {/* Account */}
        <SectionLabel>Account</SectionLabel>
        <Card>
          <Text style={[s.sub, { marginTop: 0 }]}>Logged in as</Text>
          <Text style={[s.txt, { fontWeight: '600', marginBottom: 8 }]}>{email}</Text>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <Icon name="lock" size={14} color={C.mut} />
            <Text style={[s.sub, { marginTop: 0, fontSize: 12, flex: 1 }]}>Only you can see your email. Others see @{profile.name}.</Text>
          </View>
          <Pressable onPress={resync} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 16 }}>
            <Icon name={sync === 'error' ? 'alert-triangle' : sync === 'synced' ? 'check-circle' : 'cloud'} size={14} color={sync === 'error' ? C.bad : sync === 'synced' ? C.good : C.mut} />
            <Text style={[s.sub, { marginTop: 0 }]}>
              {sync === 'synced' ? 'All runs saved to your account' : sync === 'syncing' ? 'Syncing…' : sync === 'error' ? 'Couldn’t sync. Tap to retry' : 'Not synced'}
            </Text>
          </Pressable>
          <Btn title="Log out" kind="ghost" icon="log-out" onPress={() => Alert.alert('Log out?', 'Your runs are saved in your account.', [
            { text: 'Cancel', style: 'cancel' }, { text: 'Log out', style: 'destructive', onPress: signOut },
          ])} />
        </Card>

        {/* Strava */}
        <SectionLabel>Strava</SectionLabel>
        <Card>
          {!tokens ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: STRAVA_ORANGE, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}>S</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.txt, { fontWeight: '500' }]}>Strava</Text>
                  <Text style={s.sub}>Import your runs and earn XP for them. You can disconnect any time.</Text>
                </View>
              </View>
              <Btn title="Connect with Strava" onPress={doConnect} style={{ backgroundColor: STRAVA_ORANGE }} />
              {!strava.isConfigured() && (
                <Text style={[s.sub, { marginTop: 8, fontSize: 12 }]}>Developer note: add your server address to app.json → extra.stravaAuthServer (see STRAVA_SETUP.md).</Text>
              )}
            </>
          ) : (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="check" color={C.good} />
                <Text style={[s.txt, { fontWeight: '500', flex: 1 }]}>
                  Connected{tokens.athlete?.firstname ? ` as ${tokens.athlete.firstname} ${tokens.athlete.lastname ?? ''}` : ''}
                </Text>
              </View>
              <Text style={[s.sub, { marginBottom: 12 }]}>{stravaRuns} runs imported from Strava. Already-imported runs are never counted twice.</Text>
              <View style={s.row}>
                <Btn title="Last 30 days" kind="ghost" onPress={() => doImport(30)} style={{ flex: 1, paddingHorizontal: 6 }} />
                <Btn title="90 days" kind="ghost" onPress={() => doImport(90)} style={{ flex: 1, paddingHorizontal: 6 }} />
                <Btn title="1 year" kind="ghost" onPress={() => doImport(365)} style={{ flex: 1, paddingHorizontal: 6 }} />
              </View>
              <Text style={[s.sub, { marginTop: 12, fontSize: 12 }]}>Imported runs earn XP and badges like normal. Only runs from the last 30 days hold tiles on the map.</Text>
              <Pressable onPress={doDisconnect}><Text style={[s.sub, { marginTop: 12, textAlign: 'center' }]}>Disconnect Strava</Text></Pressable>
            </>
          )}
          <Text style={{ color: STRAVA_ORANGE, fontSize: 12, fontWeight: '600', textAlign: 'right', marginTop: 12 }}>Powered by Strava</Text>
        </Card>
      </ScrollView>

      {busy && (
        <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.acc} size="large" />
          <Text style={[s.txt, { marginTop: 12 }]}>{busy}</Text>
        </View>
      )}

      {/* Town picker */}
      <Modal visible={townsOpen} animationType="slide" transparent onRequestClose={() => setTownsOpen(false)}>
        <View style={s.ov}>
          <View style={s.sheet}>
            <Text style={[s.title, { marginBottom: 12 }]}>Choose your home town</Text>
            <ScrollView>
              {TOWNS.map(([t]) => t).sort().map((t) => (
                <Pressable key={t} onPress={() => { setProfile({ homeTown: t }); setTownsOpen(false); }}
                  style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line }}>
                  <Text style={[s.txt, profile.homeTown === t && { color: C.acc, fontWeight: '600' }]}>{t}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}
