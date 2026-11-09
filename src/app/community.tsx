import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Share, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Btn, C, Card, Icon, IconName, num, s, SectionLabel } from '../components/ui';
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

function Avatar({ a, size = 40 }: { a: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.5 }}>{a}</Text>
    </View>
  );
}

export default function Community() {
  const [seg, setSeg] = useState<Seg>('feed');
  return (
    <SafeAreaView edges={['top']} style={s.screen}>
      <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
        <Text style={s.title}>Community</Text>
        <View style={{ flexDirection: 'row', backgroundColor: C.card2, borderRadius: 12, padding: 4, marginTop: 12 }}>
          {SEGS.map(([k, label, icon]) => (
            <Pressable key={k} onPress={() => setSeg(k)} style={{ flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 9, backgroundColor: seg === k ? C.acc : 'transparent' }}>
              <Icon name={icon} size={15} color={seg === k ? C.onAcc : C.sec} />
              <Text style={{ color: seg === k ? C.onAcc : C.sec, fontWeight: '600', fontSize: 13 }}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {seg === 'feed' ? <Feed goFriends={() => setSeg('friends')} /> : seg === 'board' ? <Board /> : <Friends />}
    </SafeAreaView>
  );
}

// ---------------- Feed ----------------
function Feed({ goFriends }: { goFriends: () => void }) {
  const { userId } = useAuth();
  const [items, setItems] = useState<cm.Activity[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setItems(await cm.fetchFeed()); setErr(null); } catch (e: any) { setErr(e?.message ?? 'Could not load the feed.'); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleKudos = async (a: cm.Activity) => {
    if (!userId || a.user_id === userId) return;
    const mine = a.kudos.some((k) => k.user_id === userId);
    setItems((cur) => cur?.map((x) => x.id === a.id ? { ...x, kudos: mine ? x.kudos.filter((k) => k.user_id !== userId) : [...x.kudos, { user_id: userId }] } : x) ?? null);
    try { await cm.setKudos(a.id, !mine); } catch { load(); }
  };

  if (!items && !err) return <ActivityIndicator color={C.acc} style={{ marginTop: 40 }} />;

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
      renderItem={({ item: a }) => {
        const mine = a.kudos.some((k) => k.user_id === userId);
        const own = a.user_id === userId;
        const who = own ? 'You' : `@${a.profiles?.username ?? 'runner'}`;
        let line = '', icon: IconName = 'activity';
        if (a.kind === 'run') { line = `ran ${Number(a.data.km).toFixed(2)} km · +${a.data.xp} XP${a.data.test ? ' · test' : ''}`; icon = 'activity'; }
        else if (a.kind === 'level_up') { line = `reached level ${a.data.level}${a.data.title ? ` · ${a.data.title}` : ''}`; icon = 'chevrons-up'; }
        else { line = `earned the ${a.data.name} badge`; icon = 'award'; }
        return (
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar a={a.profiles?.avatar ?? '🏃'} />
            <View style={{ flex: 1 }}>
              <Text style={[s.txt, num]}><Text style={{ fontWeight: '600' }}>{who}</Text> {line}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <Icon name={icon} size={13} color={C.mut} />
                <Text style={[s.sub, { marginTop: 0, color: C.mut }]}>{ago(a.created_at)}</Text>
              </View>
            </View>
            <Pressable onPress={() => toggleKudos(a)} disabled={own} hitSlop={10}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: mine ? C.acc : C.line2, opacity: own && !a.kudos.length ? 0.4 : 1 }}>
              <Icon name="thumbs-up" size={15} color={mine ? C.acc : C.sec} />
              <Text style={[{ color: mine ? C.acc : C.sec, fontWeight: '600', fontSize: 13 }, num]}>{a.kudos.length || ''}</Text>
            </Pressable>
          </Card>
        );
      }}
    />
  );
}

// ---------------- Leaderboard ----------------
const SCOPES: [cm.Scope, string][] = [['friends', 'Friends'], ['town', 'My town'], ['all', 'All Singapore']];

function Board() {
  const { profile } = useStore();
  const [scope, setScope] = useState<cm.Scope>('friends');
  const [rows, setRows] = useState<cm.LeaderRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (sc: cm.Scope) => {
    try { setRows(await cm.fetchLeaderboard(sc)); setErr(null); } catch (e: any) { setErr(e?.message ?? 'Could not load the leaderboard.'); }
  }, []);
  useFocusEffect(useCallback(() => { load(scope); }, [load, scope]));

  const pick = (sc: cm.Scope) => { setScope(sc); setRows(null); load(sc); };

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
          <Text style={[s.sub, { marginTop: 12 }]}>XP earned since Monday. Resets every Monday at midnight.</Text>
          {scope === 'town' && !profile.homeTown && <Text style={[s.sub, { color: C.bad }]}>Set your home town on the Profile tab to see your town.</Text>}
          {err && <Text style={[s.sub, { color: C.bad }]}>{err}</Text>}
        </View>
      }
      ListEmptyComponent={rows ? <Text style={s.sub}>Nobody has run yet this week. Be first.</Text> : <ActivityIndicator color={C.acc} style={{ marginTop: 24 }} />}
      renderItem={({ item: r }) => (
        <View style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, marginBottom: 8 }, r.is_me && { borderColor: C.acc }]}>
          <Text style={[{ width: 28, color: r.rank <= 3 ? C.acc : C.mut, fontWeight: '600', fontSize: 16, textAlign: 'center' }, num]}>{r.rank}</Text>
          <Avatar a={r.avatar} size={34} />
          <View style={{ flex: 1 }}>
            <Text style={[s.txt, { fontWeight: '600' }]}>{r.is_me ? 'You' : `@${r.username}`}</Text>
            <Text style={[s.sub, { marginTop: 0 }]}>Level {r.level}{r.home_town ? ` · ${r.home_town}` : ''}</Text>
          </View>
          <Text style={[s.txt, num, { fontWeight: '600' }]}>{r.week_xp.toLocaleString()} <Text style={{ color: C.mut, fontWeight: '400', fontSize: 12 }}>XP</Text></Text>
        </View>
      )}
    />
  );
}

// ---------------- Friends ----------------
function Friends() {
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
      <Avatar a={r.other.avatar} size={36} />
      <View style={{ flex: 1 }}>
        <Text style={[s.txt, { fontWeight: '600' }]}>@{r.other.username}</Text>
        <Text style={[s.sub, { marginTop: 0 }]}>Level {r.other.level}{r.other.home_town ? ` · ${r.other.home_town}` : ''}</Text>
      </View>
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
