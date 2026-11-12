import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Btn, C, Card, Icon, s, SectionLabel } from '../components/ui';
import { levelOf, titleOf } from '../lib/game';
import { TOWNS } from '../lib/geo';
import { useAuth } from '../lib/auth';
import { useStore } from '../lib/store';
import * as strava from '../lib/strava';
import * as health from '../lib/health';
import { Linking, Platform } from 'react-native';
import * as push from '../lib/push';

const AVATARS = ['🏃', '🏃‍♀️', '🦊', '🐯', '🦁', '🐺', '🐼', '🦅', '🐉', '⚡', '🔥', '🚀'];
const STRAVA_ORANGE = '#FC4C02';

const input = { backgroundColor: C.card2, borderColor: C.line, borderWidth: 1, borderRadius: 12, padding: 12, color: C.txt, fontSize: 15 } as const;

export default function ProfileScreen() {
  const { profile, setProfile, state, importRuns, sync, resync } = useStore();
  const { email, signOut, userId } = useAuth();
  const uid = userId ?? '';
  const [townsOpen, setTownsOpen] = useState(false);
  const L = levelOf(state.xp);

  // ---- Apple Health ----
  const hSupported = health.healthSupported();
  const [hConnected, setHConnected] = useState(false);
  const [hLast, setHLast] = useState<number | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  useEffect(() => {
    if (!uid) { setHConnected(false); setHLast(null); return; }
    health.isConnected(uid).then(setHConnected); health.lastSync(uid).then(setHLast);
  }, [uid]);

  // ---- Tile alerts (push notifications) ----
  const [pushState, setPushState] = useState<push.PushState>('unsupported');
  useFocusEffect(useCallback(() => { if (uid) push.state(uid).then(setPushState); }, [uid]));
  const pushOn = async () => {
    try { setPushState(await push.enable(uid)); }
    catch (e: any) { Alert.alert('Could not turn on alerts', e?.message ?? String(e)); }
  };
  const pushOff = async () => { await push.disable(uid); setPushState('off'); };

  const healthImport = async (days: number) => {
    setBusy('Reading runs from Apple Health…');
    try {
      const { runs, skippedStrava, found, sources } = await health.fetchRuns(days, uid);
      const r = importRuns(runs);
      setHLast(Date.now());
      const lines: string[] = [];
      if (!found) {
        lines.push(`No running workouts found in Apple Health for the last ${days} days.`,
          'If you use Garmin, Coros or another watch, turn on Apple Health syncing in that watch\'s app. If you track runs with Strava only, those can\'t be used here.',
          'If you do have runs there, check iPhone Settings → Health → Data Access & Devices → LevelUp+ and turn on Workouts and Workout Routes.');
      } else {
        lines.push(`Found ${found} run${found > 1 ? 's' : ''} in Apple Health${sources.length ? ` (from ${sources.slice(0, 3).join(', ')})` : ''}.`);
        if (r.added) lines.push(`${r.added} new run${r.added > 1 ? 's' : ''} added.`);
        if (r.upgraded) lines.push(`${r.upgraded} replaced your Strava copies, so they now count on the Battle map and leaderboards.`);
        if (r.duplicates) lines.push(`${r.duplicates} already in LevelUp+.`);
        if (skippedStrava) lines.push(`${skippedStrava} recorded by Strava were skipped.`);
        if (r.xpGained > 0) lines.push(`+${r.xpGained.toLocaleString()} XP`);
      }
      Alert.alert('Apple Health synced', lines.join('\n\n'));
    } catch (e: any) { Alert.alert('Could not read Apple Health', e?.message ?? String(e)); }
    finally { setBusy(null); }
  };
  // iOS can't open Apple's Health sheet (or an alert) while our consent sheet is still
  // sliding away, and fails silently. So: close ours first, then ask Apple once it's gone.
  const wantConnect = useRef(false);
  const healthConnect = () => {
    wantConnect.current = true;
    setConsentOpen(false);
    setTimeout(() => { if (wantConnect.current) startHealthConnect(); }, 900); // fallback if onDismiss doesn't fire
  };
  const startHealthConnect = async () => {
    if (!wantConnect.current) return;
    wantConnect.current = false;
    setBusy('Waiting for Apple Health…');
    try {
      await Promise.race([
        health.connect(uid),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Apple Health did not respond. Please try again.')), 60_000)),
      ]);
      setHConnected(true);
      setBusy(null);
      await healthImport(90);
    } catch (e: any) {
      setBusy(null);
      const msg = String(e?.message ?? e);
      Alert.alert('Could not connect Apple Health', /entitlement/i.test(msg)
        ? 'This build is missing the Apple Health permission. It needs to be rebuilt (ask Claude).' : msg);
    }
  };
  const healthDisconnect = () => Alert.alert('Disconnect Apple Health?', 'Runs already imported stay. To remove access fully, go to iPhone Settings → Health → Data Access & Devices → LevelUp+.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Disconnect', style: 'destructive', onPress: async () => { await health.disconnect(uid); setHConnected(false); setHLast(null); } },
  ]);

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
            { text: 'Cancel', style: 'cancel' }, { text: 'Log out', style: 'destructive', onPress: async () => { await push.disable(); await signOut(); } },
          ])} />
        </Card>

        {/* Tile alerts */}
        <SectionLabel>Tile alerts</SectionLabel>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: pushState === 'unsupported' ? 0 : 12 }}>
            <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={pushState === 'on' ? 'bell' : 'bell-off'} size={22} color={pushState === 'on' ? C.acc : C.sec} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.txt, { fontWeight: '600' }]}>{pushState === 'on' ? 'Alerts are on' : 'Know when your turf is under attack'}</Text>
              <Text style={[s.sub, { marginTop: 0 }]}>
                {pushState === 'unsupported' ? 'Alerts need the newest LevelUp+ app build.'
                  : pushState === 'blocked' ? 'Notifications are turned off for LevelUp+ in iPhone Settings.'
                  : 'A notification when a rival is close to taking your tiles, or takes them. A few a day at most.'}
              </Text>
            </View>
          </View>
          {pushState === 'off' && <Btn title="Turn on alerts" icon="bell" onPress={pushOn} />}
          {pushState === 'blocked' && <Btn title="Open Settings" kind="ghost" icon="settings" onPress={() => Linking.openSettings()} />}
          {pushState === 'on' && <Pressable onPress={pushOff}><Text style={[s.sub, { marginTop: 0, textAlign: 'center' }]}>Turn off alerts</Text></Pressable>}
        </Card>

        {/* Apple Health */}
        <SectionLabel>Apple Health</SectionLabel>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: '#FF2D55', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="heart" size={22} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.txt, { fontWeight: '600' }]}>{hConnected ? 'Connected' : 'Use your watch runs'}</Text>
              <Text style={[s.sub, { marginTop: 0 }]}>
                {hConnected
                  ? `New runs sync automatically${hLast ? ` · last synced ${new Date(hLast).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}`
                  : 'Apple Watch, Garmin, Coros and more. These runs count on the Battle map and leaderboards.'}
              </Text>
            </View>
          </View>
          {Platform.OS !== 'ios' ? (
            <Text style={s.sub}>Android (Health Connect) is coming soon.</Text>
          ) : !hSupported ? (
            <Text style={s.sub}>Apple Health works in the LevelUp+ app build, not inside Expo Go.</Text>
          ) : hConnected ? (
            <>
              <View style={s.row}>
                <Btn title="Sync now" kind="ghost" icon="refresh-cw" onPress={() => healthImport(30)} style={{ flex: 1 }} />
                <Btn title="Last 90 days" kind="ghost" onPress={() => healthImport(90)} style={{ flex: 1 }} />
              </View>
              <Pressable onPress={healthDisconnect}><Text style={[s.sub, { marginTop: 12, textAlign: 'center' }]}>Disconnect Apple Health</Text></Pressable>
            </>
          ) : (
            <Btn title="Connect Apple Health" icon="heart" onPress={() => setConsentOpen(true)} />
          )}
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
                  <Text style={s.sub}>Import past runs for personal XP and badges. Strava runs don't count on the Battle map or leaderboards.</Text>
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
                <Btn title="30 days" kind="ghost" onPress={() => doImport(30)} style={{ flex: 1, paddingHorizontal: 6 }} />
                <Btn title="90 days" kind="ghost" onPress={() => doImport(90)} style={{ flex: 1, paddingHorizontal: 6 }} />
                <Btn title="1 year" kind="ghost" onPress={() => doImport(365)} style={{ flex: 1, paddingHorizontal: 6 }} />
              </View>
              <Text style={[s.sub, { marginTop: 12, fontSize: 12 }]}>Strava runs earn XP and badges, and show on My tiles only (not the Battle map or leaderboards).</Text>
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

      {/* Apple Health consent */}
      <Modal visible={consentOpen} animationType="slide" transparent onRequestClose={() => setConsentOpen(false)}
        onDismiss={() => { if (wantConnect.current) setTimeout(startHealthConnect, 150); }}>
        <View style={s.ov}>
          <View style={s.sheet}>
            <Text style={[s.title, { marginBottom: 8 }]}>Share your runs from Apple Health</Text>
            <Text style={[s.txt, { marginBottom: 12, color: C.sec }]}>LevelUp+ will read your running workouts (date, time, distance and GPS route) from Apple Health.</Text>
            {([
              ['map', 'Your runs claim tiles on the shared Battle map, which other runners can see.'],
              ['bar-chart-2', 'Your XP counts on the weekly leaderboards.'],
              ['users', 'Recent runs appear in your friends\' feed.'],
              ['lock', 'Your exact routes stay private. Tiles near where you start and finish are hidden.'],
              ['slash', 'Runs recorded by Strava are skipped, and your health data is never sold or used for ads.'],
            ] as const).map(([ic, t]) => (
              <View key={t} style={{ flexDirection: 'row', gap: 12, marginBottom: 10 }}>
                <Icon name={ic} size={16} color={C.acc} />
                <Text style={[s.sub, { marginTop: 0, flex: 1, color: C.txt }]}>{t}</Text>
              </View>
            ))}
            <Text style={[s.sub, { marginBottom: 16 }]}>You can disconnect any time here, or in iPhone Settings → Health.</Text>
            <Btn title="Agree and connect" onPress={healthConnect} />
            <Btn title="Not now" kind="ghost" onPress={() => setConsentOpen(false)} style={{ marginTop: 8 }} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
