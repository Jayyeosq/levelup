import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Share, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import RunnerCard, { RunnerRef } from '../components/RunnerCard';
import { Avatar, Btn, C, Card, Icon, IconName, num, s, SectionLabel } from '../components/ui';
import { useAuth } from '../lib/auth';
import * as cm from '../lib/community';
import { useStore } from '../lib/store';

type Seg = 'feed' | 'board' | 'friends';
const SEGS: [Seg, string, IconName][] = [['feed', 'Feed', 'activity'], ['board', 'This week', 'bar-chart-2'], ['friends', 'Friends', 'users']];

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
};

type OpenRunner = (r: RunnerRef) => void;
const chip = (on: boolean) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: on ? C.acc : C.line2, backgroundColor: on ? 'rgba(255,106,43,0.12)' : 'transparent' } as const);

export default function Community() {
  const [seg, setSeg] = useState<Seg>('feed');
  const { userId } = useAuth();
  const requests = cm.usePendingRequests(userId);
  // Tapping a runner anywhere here opens their card. Closing it reloads the list underneath.
  const [runner, setRunner] = useState<RunnerRef | null>(null);
  const [reload, setReload] = useState(0);
  const open: OpenRunner = (r) => { if (r.id !== userId) setRunner(r); };
  return (
    <SafeAreaView edges={['top']} style={s.screen}>
      <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
        <Text style={s.title}>Community</Text>
        <View style={{ flexDirection: 'row', backgroundColor: C.card2, borderRadius: 12, padding: 4, marginTop: 12 }}>
          {SEGS.map(([k, label, icon]) => (
            <Pressable key={k} onPress={() => setSeg(k)} style={{ flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 9, backgroundColor: seg === k ? C.acc : 'transparent' }}>
              <Icon name={icon} size={15} color={seg === k ? C.onAcc : C.sec} />
              <Text style={{ color: seg === k ? C.onAcc : C.sec, fontWeight: '600', fontSize: 13 }}>{label}{k === 'friends' && requests > 0 ? ` · ${requests}` : ''}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {seg === 'feed' ? <Feed key={reload} goFriends={() => setSeg('friends')} goBoard={() => setSeg('board')} open={open} />
        : seg === 'board' ? <Board key={reload} open={open} /> : <Friends key={reload} open={open} />}
      <RunnerCard runner={runner} onClose={() => { setRunner(null); setReload((n) => n + 1); }} />
    </SafeAreaView>
  );
}

// ---------------- Feed ----------------
function Feed({ goFriends, goBoard, open }: { goFriends: () => void; goBoard: () => void; open: OpenRunner }) {
  const { userId } = useAuth();
  const [items, setItems] = useState<cm.Activity[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [picker, setPicker] = useState<string | null>(null); // the post whose reaction picker is open

  const load = useCallback(async () => {
    try { setItems(await cm.fetchFeed()); setErr(null); } catch (e: any) { setErr(e?.message ?? 'Could not load the feed.'); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // One reaction per post: tapping the one you gave removes it, tapping another changes it.
  const react = async (a: cm.Activity, emoji: string) => {
    if (!userId || a.user_id === userId) return;
    const mine = a.kudos.find((k) => k.user_id === userId);
    const next = mine && (mine.emoji ?? '👍') === emoji ? null : emoji;
    setPicker(null);
    Haptics.selectionAsync().catch(() => {});
    setItems((cur) => cur?.map((x) => x.id !== a.id ? x
      : { ...x, kudos: [...x.kudos.filter((k) => k.user_id !== userId), ...(next ? [{ user_id: userId, emoji: next }] : [])] }) ?? null);
    try { await cm.setReaction(a.id, next); } catch { load(); }
  };

  if (!items && !err) return <ActivityIndicator color={C.acc} style={{ marginTop: 40 }} />;
  const onlyMine = !!items?.length && items.every((a) => a.user_id === userId);

  return (
    <FlatList
      data={items ?? []}
      keyExtractor={(a) => a.id}
      contentContainerStyle={s.pad}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={C.acc} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      ListHeaderComponent={err ? <Text style={[s.sub, { color: C.bad, marginBottom: 12 }]}>{err}</Text> : undefined}
      ListEmptyComponent={
        <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
          <Icon name="users" size={28} color={C.mut} />
          <Text style={[s.txt, { marginTop: 12, textAlign: 'center' }]}>Your friends' runs show up here</Text>
          <Text style={[s.sub, { textAlign: 'center', marginBottom: 16 }]}>Add a friend by username to get started.</Text>
          <Btn title="Find friends" icon="user-plus" onPress={goFriends} />
        </Card>
      }
      ListFooterComponent={onlyMine ? (
        <Card style={{ alignItems: 'center', paddingVertical: 20 }}>
          <Text style={[s.txt, { textAlign: 'center' }]}>Only your runs so far</Text>
          <Text style={[s.sub, { textAlign: 'center', marginBottom: 12 }]}>When friends run, their posts appear here and you can react to them. Give a quiet friend a nudge.</Text>
          <Btn title="See who to nudge" kind="ghost" icon="bell" onPress={goBoard} style={{ paddingVertical: 12 }} />
        </Card>
      ) : undefined}
      renderItem={({ item: a }) => {
        const own = a.user_id === userId;
        const mine = a.kudos.find((k) => k.user_id === userId);
        const who = own ? 'You' : `@${a.profiles?.username ?? 'runner'}`;
        let line = '', icon: IconName = 'activity';
        if (a.kind === 'run') { line = `ran ${Number(a.data.km).toFixed(2)} km · +${a.data.xp} XP${a.data.test ? ' · test' : ''}`; icon = 'activity'; }
        else if (a.kind === 'level_up') { line = `reached level ${a.data.level}${a.data.title ? ` · ${a.data.title}` : ''}`; icon = 'chevrons-up'; }
        else { line = `earned the ${a.data.name} badge`; icon = 'award'; }
        const counts = cm.REACTIONS.map((e) => [e, a.kudos.filter((k) => (k.emoji ?? '👍') === e).length] as const).filter(([, n]) => n > 0);
        return (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Pressable disabled={own} onPress={() => open({ id: a.user_id, username: a.profiles?.username ?? 'runner', avatar: a.profiles?.avatar ?? '🏃' })}>
                <Avatar a={a.profiles?.avatar ?? '🏃'} />
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={[s.txt, num]}><Text style={{ fontWeight: '600' }}>{who}</Text> {line}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <Icon name={icon} size={13} color={C.mut} />
                  <Text style={[s.sub, { marginTop: 0, color: C.mut }]}>{ago(a.created_at)}</Text>
                </View>
              </View>
            </View>
            {(counts.length > 0 || !own) && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 12 }}>
                {counts.map(([e, n]) => {
                  const on = !!mine && (mine.emoji ?? '👍') === e;
                  return (
                    <Pressable key={e} disabled={own} onPress={() => react(a, e)} hitSlop={4} style={chip(on)}>
                      <Text style={{ fontSize: 15 }}>{e}</Text>
                      <Text style={[{ color: on ? C.acc : C.sec, fontWeight: '600', fontSize: 13 }, num]}>{n}</Text>
                    </Pressable>
                  );
                })}
                {!own && picker !== a.id && (
                  <Pressable onPress={() => setPicker(a.id)} hitSlop={4} style={chip(false)}>
                    <Icon name="smile" size={15} color={C.sec} />
                    <Text style={{ color: C.sec, fontWeight: '500', fontSize: 13 }}>{mine ? 'Change' : 'React'}</Text>
                  </Pressable>
                )}
                {!own && picker === a.id && cm.REACTIONS.map((e) => (
                  <Pressable key={`pick-${e}`} onPress={() => react(a, e)} hitSlop={4} accessibilityLabel={`React with ${e}`}
                    style={{ width: 40, height: 36, borderRadius: 18, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 19 }}>{e}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </Card>
        );
      }}
    />
  );
}

// ---------------- Leaderboard ----------------
const SCOPES: [cm.Scope, string][] = [['friends', 'Friends'], ['town', 'My town'], ['all', 'All Singapore']];

function Board({ open }: { open: OpenRunner }) {
  const { profile } = useStore();
  const [scope, setScope] = useState<cm.Scope>('friends');
  const [rows, setRows] = useState<cm.LeaderRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [nudged, setNudged] = useState<Record<string, true>>({});

  const load = useCallback(async (sc: cm.Scope) => {
    try { setRows(await cm.fetchLeaderboard(sc)); setErr(null); } catch (e: any) { setErr(e?.message ?? 'Could not load the leaderboard.'); }
  }, []);
  useFocusEffect(useCallback(() => { load(scope); }, [load, scope]));

  const pick = (sc: cm.Scope) => { setScope(sc); setRows(null); load(sc); };

  const nudge = async (r: cm.LeaderRow) => {
    try {
      const res = await cm.nudge(r.user_id);
      if (res === 'sent' || res === 'already') { setNudged((n) => ({ ...n, [r.user_id]: true })); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); }
      else if (res === 'full') Alert.alert('Nudge not sent', `@${r.username} has already had 3 nudges today. Try again tomorrow.`);
      else if (res === 'no_phone') Alert.alert('Nudge not sent', `@${r.username} hasn't turned on alerts yet, so a notification can't reach them.`, [
        { text: 'OK', style: 'cancel' },
        { text: 'Send a message instead', onPress: () => { Share.share({ message: cm.NUDGE_TEXT }).catch(() => {}); } },
      ]);
    } catch (e: any) { Alert.alert('Nudge not sent', e?.message ?? String(e)); }
  };
  const quiet = !!rows?.length && rows.every((r) => r.week_xp === 0);

  return (
    <FlatList
      data={rows ?? []}
      keyExtractor={(r) => r.user_id}
      contentContainerStyle={s.pad}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={C.acc} onRefresh={async () => { setRefreshing(true); await load(scope); setRefreshing(false); }} />}
      ListHeaderComponent={
        <View style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {SCOPES.map(([k, label]) => (
              <Pressable key={k} onPress={() => pick(k)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: scope === k ? C.acc : C.line2 }}>
                <Text style={{ color: scope === k ? C.acc : C.sec, fontWeight: '500', fontSize: 13 }}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[s.sub, { marginTop: 12 }]}>
            {quiet ? 'Nobody has run yet this week. The first run takes the lead.' : 'XP earned since Monday. Resets every Monday at midnight.'}
          </Text>
          {scope === 'town' && !profile.homeTown && <Text style={[s.sub, { color: C.bad }]}>Set your home town on the Profile tab to see your town.</Text>}
          {err && <Text style={[s.sub, { color: C.bad }]}>{err}</Text>}
        </View>
      }
      ListEmptyComponent={rows ? <Text style={s.sub}>Nobody has run yet this week. Be first.</Text> : <ActivityIndicator color={C.acc} style={{ marginTop: 24 }} />}
      renderItem={({ item: r }) => {
        const ranked = r.week_xp > 0; // no rank until you've earned XP this week
        const canNudge = scope === 'friends' && !r.is_me && !ranked;
        return (
          <Pressable disabled={r.is_me} onPress={() => open({ id: r.user_id, username: r.username, avatar: r.avatar, level: r.level, home_town: r.home_town })}
            style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, marginBottom: 8 }, r.is_me && { borderColor: C.acc }]}>
            <Text style={[{ width: 28, color: ranked && r.rank <= 3 ? C.acc : C.mut, fontWeight: '600', fontSize: 16, textAlign: 'center' }, num]}>{ranked ? r.rank : '–'}</Text>
            <Avatar a={r.avatar} size={34} />
            <View style={{ flex: 1 }}>
              <Text style={[s.txt, { fontWeight: '600' }]} numberOfLines={1}>{r.is_me ? 'You' : `@${r.username}`}</Text>
              <Text style={[s.sub, { marginTop: 0 }]} numberOfLines={1}>Level {r.level}{r.home_town ? ` · ${r.home_town}` : ''}</Text>
            </View>
            {canNudge ? (
              <Pressable onPress={() => nudge(r)} disabled={nudged[r.user_id]} hitSlop={8} style={chip(false)}>
                <Icon name={nudged[r.user_id] ? 'check' : 'bell'} size={14} color={nudged[r.user_id] ? C.good : C.acc} />
                <Text style={{ color: nudged[r.user_id] ? C.sec : C.acc, fontWeight: '600', fontSize: 13 }}>{nudged[r.user_id] ? 'Nudged' : 'Nudge'}</Text>
              </Pressable>
            ) : (
              <Text style={[s.txt, num, { fontWeight: '600' }]}>{r.week_xp.toLocaleString()} <Text style={{ color: C.mut, fontWeight: '400', fontSize: 12 }}>XP</Text></Text>
            )}
          </Pressable>
        );
      }}
    />
  );
}

// ---------------- Friends ----------------
function Friends({ open }: { open: OpenRunner }) {
  const { userId } = useAuth();
  const { profile } = useStore();
  const [rows, setRows] = useState<cm.FriendRow[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    try { setRows(await cm.listFriendships(userId)); } catch (e: any) { setMsg({ kind: 'err', text: e?.message ?? 'Could not load friends.' }); }
  }, [userId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const add = async () => {
    if (!userId || !q.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const r = await cm.findRunner(q);
      if (!r) { setMsg({ kind: 'err', text: `No runner called @${q.trim().replace(/^@/, '')}.` }); return; }
      const res = await cm.addFriend(userId, r, rows ?? []);
      setMsg({ kind: 'ok', text: res === 'sent' ? `Request sent to @${r.username}.` : res === 'accepted' ? `You and @${r.username} are now friends.` : `You've already added @${r.username}.` });
      setQ(''); load();
    } catch (e: any) { setMsg({ kind: 'err', text: e?.message ?? 'Could not add friend.' }); }
    finally { setBusy(false); }
  };

  const act = async (fn: () => Promise<void>) => { try { await fn(); load(); } catch (e: any) { Alert.alert('Something went wrong', e?.message ?? String(e)); } };

  const incoming = (rows ?? []).filter((r) => r.status === 'pending' && r.incoming);
  const sent = (rows ?? []).filter((r) => r.status === 'pending' && !r.incoming);
  const friends = (rows ?? []).filter((r) => r.status === 'accepted');

  const Row = ({ r, right }: { r: cm.FriendRow; right: React.ReactNode }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
      <Pressable onPress={() => open(r.other)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar a={r.other.avatar} size={36} />
        <View style={{ flex: 1 }}>
          <Text style={[s.txt, { fontWeight: '600' }]}>@{r.other.username}</Text>
          <Text style={[s.sub, { marginTop: 0 }]}>Level {r.other.level}{r.other.home_town ? ` · ${r.other.home_town}` : ''}</Text>
        </View>
      </Pressable>
      {right}
    </View>
  );
  const SmallBtn = ({ icon, onPress, color = C.sec }: { icon: IconName; onPress: () => void; color?: string }) => (
    <Pressable onPress={onPress} hitSlop={8} style={{ padding: 8, borderRadius: 10, borderWidth: 1, borderColor: C.line2 }}><Icon name={icon} size={16} color={color} /></Pressable>
  );

  return (
    <FlatList
      data={[]}
      renderItem={() => null}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={s.pad}
      ListHeaderComponent={
        <>
          <Card>
            <Text style={[s.sub, { marginTop: 0, marginBottom: 8 }]}>Add a friend by username</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput value={q} onChangeText={setQ} onSubmitEditing={add} placeholder="@username" placeholderTextColor={C.mut} autoCapitalize="none" autoCorrect={false}
                style={{ flex: 1, backgroundColor: C.card2, borderColor: C.line, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, color: C.txt, fontSize: 15 }} />
              {busy ? <ActivityIndicator color={C.acc} style={{ width: 56 }} /> : <Btn title="Add" icon="user-plus" onPress={add} style={{ paddingVertical: 12 }} />}
            </View>
            {msg && <Text style={[s.sub, { color: msg.kind === 'err' ? C.bad : C.good, marginTop: 8 }]}>{msg.text}</Text>}
            <Pressable onPress={() => Share.share({ message: `Run with me on LevelUp+. Add me: @${profile.name}` })} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 16 }}>
              <Icon name="share-2" size={15} color={C.acc} />
              <Text style={{ color: C.acc, fontWeight: '600' }}>Share my username (@{profile.name})</Text>
            </Pressable>
          </Card>

          {!rows && <ActivityIndicator color={C.acc} style={{ marginTop: 16 }} />}

          {incoming.length > 0 && (<>
            <SectionLabel>Requests</SectionLabel>
            <Card>{incoming.map((r) => <Row key={r.id} r={r} right={
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <SmallBtn icon="check" color={C.good} onPress={() => act(() => cm.acceptFriend(r.id))} />
                <SmallBtn icon="x" color={C.bad} onPress={() => act(() => cm.removeFriendship(r.id))} />
              </View>} />)}</Card>
          </>)}

          {rows && (<>
            <SectionLabel>Friends · {friends.length}</SectionLabel>
            <Card>
              {friends.length ? friends.map((r) => <Row key={r.id} r={r} right={
                <SmallBtn icon="user-minus" onPress={() => Alert.alert(`Remove @${r.other.username}?`, 'You will stop seeing each other in the feed.', [
                  { text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => act(() => cm.removeFriendship(r.id)) },
                ])} />} />)
                : <Text style={s.sub}>No friends yet. Add someone above or share your username.</Text>}
            </Card>
          </>)}

          {sent.length > 0 && (<>
            <SectionLabel>Sent requests</SectionLabel>
            <Card>{sent.map((r) => <Row key={r.id} r={r} right={
              <Pressable onPress={() => act(() => cm.removeFriendship(r.id))}><Text style={{ color: C.mut, fontWeight: '500' }}>Cancel</Text></Pressable>} />)}</Card>
          </>)}
        </>
      }
    />
  );
}
