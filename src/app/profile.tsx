import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Btn, C, Card, Icon, IconName, num, s, SectionLabel, Stat } from '../components/ui';
import { BADGES, levelOf, titleOf } from '../lib/game';
import { TOWNS } from '../lib/geo';
import { useAuth } from '../lib/auth';
import { useStore } from '../lib/store';
import * as strava from '../lib/strava';
import * as health from '../lib/health';
import { Linking, Platform } from 'react-native';
import * as push from '../lib/push';

const AVATARS = ['🏃', '🏃‍♀️', '🦊', '🐯', '🦁', '🐺', '🐼', '🦅', '🐉', '⚡', '🔥', '🚀'];
const STRAVA_ORANGE = '#FC4C02';

// One line in a settings group: icon, title, optional status line, and something on the right.
// `children` is the part that opens underneath when the row is expanded.
function Row({ icon, iconNode, iconBg = C.card2, iconColor = C.sec, title, titleColor = C.txt, sub, right, onPress, last, children }: {
  icon?: IconName; iconNode?: React.ReactNode; iconBg?: string; iconColor?: string; title: string; titleColor?: string;
  sub?: string; right?: React.ReactNode; onPress?: () => void; last?: boolean; children?: React.ReactNode;
}) {
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, minHeight: 64 }}>
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center' }}>
        {iconNode ?? (icon ? <Icon name={icon} size={18} color={iconColor} /> : null)}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.txt, { fontWeight: '500', color: titleColor }]} numberOfLines={1}>{title}</Text>
        {!!sub && <Text style={[s.sub, { marginTop: 1 }]}>{sub}</Text>}
      </View>
      {right}
    </View>
  );
  return (
    <View style={!last ? { borderBottomWidth: 1, borderBottomColor: C.line } : undefined}>
      {onPress ? <Pressable onPress={onPress} style={({ pressed }) => (pressed ? { backgroundColor: C.card2 } : undefined)}>{body}</Pressable> : body}
      {children}
    </View>
  );
}
const Group = ({ children }: { children: React.ReactNode }) => <View style={[s.card, { padding: 0, overflow: 'hidden' }]}>{children}</View>;
const Chevron = ({ open }: { open: boolean }) => <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={C.mut} />;
const Pill = ({ label, color = C.acc, ink = C.onAcc }: { label: string; color?: string; ink?: string }) => (
  <View style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: color }}>
    <Text style={{ color: ink, fontWeight: '600', fontSize: 13 }}>{label}</Text>
  </View>
);
const stepBtn = { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: C.line2, alignItems: 'center', justifyContent: 'center' } as const;

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

  // ---- Layout ----
  const [open, setOpen] = useState<'avatar' | 'health' | 'strava' | null>(null); // which row is expanded
  const toggle = (k: 'avatar' | 'health' | 'strava') => setOpen((o) => (o === k ? null : k));
  const counted = state.runs.filter((r) => !r.flagged);
  const totalKm = counted.reduce((m, r) => m + r.km, 0);
  const fmtWhen = (ms: number) => new Date(ms).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const logOut = () => Alert.alert('Log out?', 'Your runs are saved in your account.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Log out', style: 'destructive', onPress: async () => { await push.disable(); await signOut(); } },
  ]);

  return (
    <SafeAreaView edges={['top']} style={s.screen}>
      <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
        {/* Who you are */}
        <View style={{ alignItems: 'center', marginTop: 8, marginBottom: 16 }}>
          <Pressable onPress={() => toggle('avatar')} accessibilityLabel="Change your avatar"
            style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: C.card, borderWidth: 1, borderColor: C.line2, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 52 }}>{profile.avatar}</Text>
            <View style={{ position: 'absolute', right: -2, bottom: -2, width: 30, height: 30, borderRadius: 15, backgroundColor: C.acc, borderWidth: 3, borderColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="edit-2" size={12} color={C.onAcc} />
            </View>
          </Pressable>
          <Text style={[s.title, { marginTop: 12, fontSize: 22 }]}>@{profile.name || 'runner'}</Text>
          <Text style={s.sub}>Level {L} · {titleOf(L)}{profile.homeTown ? ` · ${profile.homeTown}` : ''}</Text>
        </View>

        {open === 'avatar' && (
          <Card>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {AVATARS.map((a) => (
                <Pressable key={a} onPress={() => { setProfile({ avatar: a }); setOpen(null); }}
                  style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card2, borderWidth: 2, borderColor: profile.avatar === a ? C.acc : 'transparent' }}>
                  <Text style={{ fontSize: 24 }}>{a}</Text>
                </Pressable>
              ))}
            </View>
          </Card>
        )}

        <View style={s.row}>
          <Stat value={totalKm >= 100 ? Math.round(totalKm).toLocaleString() : totalKm.toFixed(1)} label="km run" />
          <Stat value={String(counted.length)} label="runs" />
          <Stat value={`${Object.keys(state.badges).length}/${BADGES.length}`} label="badges" />
        </View>

        <SectionLabel>Your game</SectionLabel>
        <Group>
          <Row icon="map-pin" title="Home town" sub="Your turf to defend" onPress={() => setTownsOpen(true)}
            right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ color: profile.homeTown ? C.txt : C.acc, fontSize: 15, fontWeight: '500' }}>{profile.homeTown || 'Choose'}</Text>
              <Icon name="chevron-right" size={18} color={C.mut} />
            </View>} />
          <Row icon="target" title="Weekly goal" sub="Shown on the Run tab" last
            right={<View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Pressable onPress={() => setProfile({ weeklyGoalKm: Math.max(5, profile.weeklyGoalKm - 5) })} hitSlop={6} accessibilityLabel="Lower weekly goal" style={stepBtn}><Icon name="minus" size={16} color={C.txt} /></Pressable>
              <Text style={[num, { color: C.txt, fontSize: 16, fontWeight: '600', width: 64, textAlign: 'center' }]}>{profile.weeklyGoalKm} km</Text>
              <Pressable onPress={() => setProfile({ weeklyGoalKm: Math.min(150, profile.weeklyGoalKm + 5) })} hitSlop={6} accessibilityLabel="Raise weekly goal" style={stepBtn}><Icon name="plus" size={16} color={C.txt} /></Pressable>
            </View>} />
        </Group>

        <SectionLabel>Alerts and connections</SectionLabel>
        <Group>
          <Row icon={pushState === 'on' ? 'bell' : 'bell-off'} iconColor={pushState === 'on' ? C.acc : C.sec} title="Tile alerts"
            sub={pushState === 'unsupported' ? 'Needs the newest LevelUp+ app build'
              : pushState === 'blocked' ? 'Turned off for LevelUp+ in iPhone Settings'
              : 'When a rival is close to taking your tiles, or takes them'}
            onPress={pushState === 'blocked' ? () => Linking.openSettings() : undefined}
            right={pushState === 'blocked' ? <Pill label="Settings" color={C.card2} ink={C.txt} />
              : pushState === 'unsupported' ? undefined
              : <Switch value={pushState === 'on'} onValueChange={(v) => (v ? pushOn() : pushOff())} trackColor={{ true: C.acc, false: C.card2 }} ios_backgroundColor={C.card2} />} />

          <Row iconNode={<Icon name="heart" size={18} color="#fff" />} iconBg="#FF2D55" title="Apple Health"
            sub={Platform.OS !== 'ios' ? 'Android (Health Connect) is coming soon'
              : !hSupported ? 'Works in the LevelUp+ app build, not in Expo Go'
              : hConnected ? `Watch runs sync by themselves${hLast ? ` · last ${fmtWhen(hLast)}` : ''}`
              : 'Use your watch runs for XP and the Battle map'}
            onPress={Platform.OS !== 'ios' || !hSupported ? undefined : hConnected ? () => toggle('health') : () => setConsentOpen(true)}
            right={Platform.OS !== 'ios' || !hSupported ? undefined : hConnected ? <Chevron open={open === 'health'} /> : <Pill label="Connect" />}>
            {open === 'health' && hConnected && (
              <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
                <View style={s.row}>
                  <Btn title="Sync now" kind="ghost" icon="refresh-cw" onPress={() => healthImport(30)} style={{ flex: 1, paddingVertical: 12 }} />
                  <Btn title="Last 90 days" kind="ghost" onPress={() => healthImport(90)} style={{ flex: 1, paddingVertical: 12 }} />
                </View>
                <Pressable onPress={healthDisconnect} hitSlop={8}><Text style={[s.sub, { marginTop: 14, textAlign: 'center' }]}>Disconnect Apple Health</Text></Pressable>
              </View>
            )}
          </Row>

          <Row iconNode={<Text style={{ color: '#fff', fontSize: 18, fontWeight: '900' }}>S</Text>} iconBg={STRAVA_ORANGE} title="Strava" last
            sub={!strava.isConfigured() ? 'Developer note: set extra.stravaAuthServer in app.json'
              : tokens ? `${tokens.athlete?.firstname ? `${tokens.athlete.firstname} ${tokens.athlete.lastname ?? ''}`.trim() + ' · ' : ''}${stravaRuns} runs · personal XP only`
              : 'Past runs for personal XP and badges'}
            onPress={tokens ? () => toggle('strava') : doConnect}
            right={tokens ? <Chevron open={open === 'strava'} /> : <Pill label="Connect" color={STRAVA_ORANGE} ink="#fff" />}>
            {open === 'strava' && tokens && (
              <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
                <Text style={[s.sub, { marginTop: 0, marginBottom: 12 }]}>Import more of your Strava history. Runs already imported are never counted twice.</Text>
                <View style={s.row}>
                  <Btn title="30 days" kind="ghost" onPress={() => doImport(30)} style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 6 }} />
                  <Btn title="90 days" kind="ghost" onPress={() => doImport(90)} style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 6 }} />
                  <Btn title="1 year" kind="ghost" onPress={() => doImport(365)} style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 6 }} />
                </View>
                <Text style={[s.sub, { marginTop: 12 }]}>Strava runs earn XP and badges and show on My tiles. Strava's rules don't allow them on the Battle map or leaderboards.</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
                  <Pressable onPress={doDisconnect} hitSlop={8}><Text style={[s.sub, { marginTop: 0 }]}>Disconnect Strava</Text></Pressable>
                  <Text style={{ color: STRAVA_ORANGE, fontSize: 12, fontWeight: '600' }}>Powered by Strava</Text>
                </View>
              </View>
            )}
          </Row>
        </Group>

        <SectionLabel>Account</SectionLabel>
        <Group>
          <Row icon="mail" title={email ?? ''} sub={`Only you can see your email. Others see @${profile.name}`} />
          <Row icon={sync === 'error' ? 'alert-triangle' : sync === 'synced' ? 'check-circle' : 'cloud'}
            iconColor={sync === 'error' ? C.bad : sync === 'synced' ? C.good : C.sec}
            title={sync === 'synced' ? 'All runs saved to your account' : sync === 'syncing' ? 'Syncing…' : sync === 'error' ? 'Couldn’t sync' : 'Not synced'}
            sub={sync === 'error' ? 'Tap to try again' : undefined}
            onPress={sync === 'syncing' ? undefined : resync}
            right={sync === 'syncing' ? <ActivityIndicator color={C.acc} /> : <Icon name="refresh-cw" size={16} color={C.mut} />} />
          <Row icon="log-out" title="Log out" onPress={logOut} last />
        </Group>

        <Text style={[s.sub, { textAlign: 'center', marginTop: 16, color: C.mut, fontSize: 12 }]}>LevelUp+ {Constants.expoConfig?.version ?? ''}</Text>
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
