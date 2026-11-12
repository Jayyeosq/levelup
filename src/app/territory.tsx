import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import MapView, { Polygon, Polyline, Region } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Btn, C, Hex, Icon, num, s } from '../components/ui';
import { useAuth } from '../lib/auth';
import * as battle from '../lib/battle';
import { areasHeld, dayOf, heldTiles } from '../lib/game';
import { areaOfTile, tileCenter, tileOf, tilePolygon } from '../lib/geo';
import { useStore } from '../lib/store';
import { currentPosition } from '../lib/tracker';

type Mode = 'battle' | 'mine';
const MAX_DELTA = 0.12; // zoomed further out than ~13 km → ask to zoom in
// draw order: rivals at the bottom, your tiles on top
const ORDER: Record<battle.TileKind, number> = { rival: 1, reach: 2, lost: 3, mine: 4, attack: 5 };

function Crown({ size = 16, color = C.acc }: { size?: number; color?: string }) {
  return <MaterialCommunityIcons name="crown" size={size} color={color} />;
}

export default function Territory() {
  const { state, profile } = useStore();
  const { userId } = useAuth();
  const today = dayOf(Date.now());
  const held = useMemo(() => heldTiles(state, today), [state, today]);
  const areas = useMemo(() => areasHeld(state, today), [state, today]);
  const mapRef = useRef<MapView>(null);

  const [mode, setMode] = useState<Mode>('battle');
  const [sel, setSel] = useState<string | null>(null);
  const [tiles, setTiles] = useState<battle.BattleTile[]>([]);
  const [loading, setLoading] = useState(false);
  const [tooFar, setTooFar] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [kings, setKings] = useState<battle.TownKing[]>([]);
  const [kingsOpen, setKingsOpen] = useState(false);
  const [lost, setLost] = useState<{ ids: string[]; by: string } | null>(null);
  const [heldCount, setHeldCount] = useState<number | null>(null);
  const region = useRef<Region | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // centre once on open
  useEffect(() => {
    (async () => {
      const ids = Object.keys(held);
      const target = (await currentPosition()) ?? (ids.length ? tileCenter(ids[0]) : null);
      if (target) mapRef.current?.animateToRegion({ ...target, latitudeDelta: 0.03, longitudeDelta: 0.03 }, 600);
    })();
  }, []);

  const loadBox = useCallback(async (r: Region) => {
    if (r.latitudeDelta > MAX_DELTA || r.longitudeDelta > MAX_DELTA) { setTooFar(true); return; }
    setTooFar(false); setLoading(true);
    try {
      setTiles(await battle.fetchTerritory({
        minLat: r.latitude - r.latitudeDelta / 2, maxLat: r.latitude + r.latitudeDelta / 2,
        minLng: r.longitude - r.longitudeDelta / 2, maxLng: r.longitude + r.longitudeDelta / 2,
      }));
      setErr(null);
    } catch (e: any) { setErr(e?.message ?? 'Could not load the map.'); }
    finally { setLoading(false); }
  }, []);

  const onRegion = (r: Region) => {
    region.current = r;
    if (mode !== 'battle') return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => loadBox(r), 400);
  };

  // Kings + "who took my tiles" every time you open the tab
  useFocusEffect(useCallback(() => {
    if (!userId) return;
    (async () => {
      try {
        const [k, mine] = await Promise.all([battle.fetchKings(), battle.fetchMyTiles()]);
        setKings(k);
        const owned = mine.filter((t) => t.owner_id === userId).map((t) => t.tile_id);
        setHeldCount(owned.length);
        const key = `levelup.owned.${userId}`;
        const prevRaw = await AsyncStorage.getItem(key);
        if (prevRaw) {
          const prev: string[] = JSON.parse(prevRaw);
          const nowOwner = new Map(mine.map((t) => [t.tile_id, t]));
          const taken = prev.filter((id) => { const t = nowOwner.get(id); return t && t.owner_id !== userId; });
          if (taken.length) {
            const tally = new Map<string, number>();
            taken.forEach((id) => { const u = nowOwner.get(id)!.owner_username; tally.set(u, (tally.get(u) ?? 0) + 1); });
            const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
            setLost({ ids: taken, by: tally.size > 1 ? `@${top} and others` : `@${top}` });
          }
        }
        await AsyncStorage.setItem(key, JSON.stringify(owned));
      } catch { /* map still works without these */ }
      if (region.current && mode === 'battle') loadBox(region.current);
    })();
  }, [userId, mode, loadBox]));

  const myKingdoms = kings.filter((k) => k.king_id === userId);
  const homeKing = kings.find((k) => k.town === profile.homeTown);
  const selTile = sel ? tiles.find((t) => t.tile_id === sel) : null;
  const lostSet = useMemo(() => new Set(lost?.ids ?? []), [lost]);
  const counts = useMemo(() => {
    const c: Record<battle.TileKind, number> = { mine: 0, attack: 0, lost: 0, reach: 0, rival: 0 };
    tiles.forEach((t) => { c[battle.tileKind(t, lostSet)]++; });
    return c;
  }, [tiles, lostSet]);

  return (
    <View style={s.screen}>
      <MapView ref={mapRef} style={{ flex: 1 }} showsUserLocation userInterfaceStyle="dark"
        initialRegion={{ latitude: 1.3521, longitude: 103.8198, latitudeDelta: 0.25, longitudeDelta: 0.25 }}
        onRegionChangeComplete={onRegion}
        onPress={(e) => setSel(tileOf(e.nativeEvent.coordinate))}>
        {/* One tap reaches this handler twice on iOS (the tile's press bubbles up, then the map's own press),
            so selecting must be idempotent: never toggle here. Clear with the x on the card. */}
        {mode === 'battle'
          ? [...tiles].sort((a, b) => ORDER[battle.tileKind(a, lostSet)] - ORDER[battle.tileKind(b, lostSet)]).map((t) => {
              const st = battle.KIND_STYLE[battle.tileKind(t, lostSet)];
              const isSel = sel === t.tile_id;
              return (
                <Polygon key={t.tile_id} coordinates={tilePolygon(t.tile_id)} tappable={false}
                  fillColor={st.fill} strokeColor={isSel ? '#ffffff' : st.stroke} strokeWidth={isSel ? 3 : st.width} zIndex={isSel ? 9 : ORDER[battle.tileKind(t, lostSet)]} />
              );
            })
          : Object.entries(held).map(([id, km]) => (
              <Polygon key={id} coordinates={tilePolygon(id)} tappable={false}
                fillColor={`rgba(255,106,43,${Math.min(0.75, 0.3 + km * 0.25).toFixed(2)})`}
                strokeColor={sel === id ? '#ffffff' : 'rgba(255,106,43,0.9)'} strokeWidth={sel === id ? 3 : 1} />
            ))}
        {mode === 'battle' && sel && !selTile && (
          <Polygon coordinates={tilePolygon(sel)} tappable={false} fillColor="rgba(255,255,255,0.08)" strokeColor="#ffffff" strokeWidth={2} zIndex={9} />
        )}
        {mode === 'mine' && (state.runs.find((r) => !r.flagged)?.route?.length ?? 0) > 1 &&
          <Polyline coordinates={state.runs.find((r) => !r.flagged)!.route} strokeColor="#ffffff" strokeWidth={2} />}
      </MapView>

      <SafeAreaView edges={['top']} style={{ position: 'absolute', top: 0, left: 0, right: 0 }} pointerEvents="box-none">
        <View style={{ margin: 12, gap: 8 }} pointerEvents="box-none">
          {/* mode switch */}
          <View style={{ flexDirection: 'row', backgroundColor: C.card, borderRadius: 12, padding: 4, borderWidth: 1, borderColor: C.line, alignSelf: 'flex-start' }}>
            {([['battle', 'Battle'], ['mine', 'My tiles']] as const).map(([k, label]) => (
              <Pressable key={k} onPress={() => { setMode(k); setSel(null); if (k === 'battle' && region.current) loadBox(region.current); }}
                style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 9, backgroundColor: mode === k ? C.acc : 'transparent' }}>
                <Text style={{ color: mode === k ? C.onAcc : C.sec, fontWeight: '600', fontSize: 13 }}>{label}</Text>
              </Pressable>
            ))}
          </View>

          {/* steal alert */}
          {lost && mode === 'battle' && (
            <View style={[s.card, { marginBottom: 0, borderColor: C.bad, flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
              <Icon name="alert-triangle" color={C.bad} />
              <View style={{ flex: 1 }}>
                <Text style={[s.txt, { fontWeight: '600' }]}>{lost.by} took {lost.ids.length} of your tiles</Text>
                <Text style={[s.sub, { marginTop: 2 }]}>They're outlined in red. Run there to win them back.</Text>
              </View>
              <Pressable onPress={() => setLost(null)} hitSlop={10}><Icon name="x" color={C.mut} /></Pressable>
            </View>
          )}

          {/* summary */}
          <View style={[s.card, { marginBottom: 0, opacity: 0.97 }]}>
            {mode === 'battle' ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Hex size={20} />
                  <Text style={[s.title, num, { flex: 1 }]}>{heldCount ?? '…'} tiles held</Text>
                  <Pressable onPress={() => setKingsOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: C.line2 }}>
                    <Crown size={15} />
                    <Text style={{ color: C.txt, fontWeight: '600', fontSize: 13 }}>Kings</Text>
                  </Pressable>
                </View>
                <Text style={[s.sub, { marginTop: 6 }]}>
                  {myKingdoms.length
                    ? `You're King of ${myKingdoms.map((k) => k.town).join(', ')}`
                    : homeKing
                      ? `King of ${homeKing.town}: @${homeKing.king_username} · ${homeKing.king_tiles} tiles. You hold ${homeKing.my_tiles}`
                      : 'Run more km in a tile than anyone else in 30 days to take it'}
                </Text>
                {tooFar && <Text style={[s.sub, { color: C.acc }]}>Zoom in to see who holds each tile</Text>}
                {loading && <ActivityIndicator color={C.acc} size="small" style={{ alignSelf: 'flex-start', marginTop: 6 }} />}
                {err && <Text style={[s.sub, { color: C.bad }]}>{err}</Text>}
                {mode === 'battle' && sel && (
                  <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.line }}>
                    <Pressable onPress={() => setSel(null)} hitSlop={12} style={{ position: 'absolute', right: 0, top: 8, zIndex: 2 }}>
                      <Icon name="x" color={C.mut} size={18} />
                    </Pressable>
                    {selTile ? (() => {
                      const k = battle.tileKind(selTile, lostSet);
                      const gap = (selTile.owner_km - selTile.my_km + 0.05).toFixed(2);
                      return (
                        <>
                          <Text style={[s.txt, num]}>
                            <Text style={{ fontWeight: '600' }}>{selTile.is_mine ? 'Your tile' : `${selTile.avatar} @${selTile.username}'s tile`}</Text>
                            {' · '}{areaOfTile(selTile.tile_id)}
                          </Text>
                          <Text style={[s.sub, num]}>
                            {selTile.is_mine
                              ? selTile.runner_up_name
                                ? `You ${selTile.owner_km} km · @${selTile.runner_up_name} ${selTile.runner_up_km} km${k === 'attack' ? ' · under attack, run here to defend it' : ''}`
                                : `You ran ${selTile.owner_km} km here in 30 days · no rivals yet`
                              : `@${selTile.username} ${selTile.owner_km} km · you ${selTile.my_km} km · run ${gap} km more here to take it`}
                          </Text>
                        </>
                      );
                    })() : (
                      <>
                        <Text style={[s.txt, { fontWeight: '600' }]}>Unclaimed · {areaOfTile(sel)}</Text>
                        <Text style={s.sub}>Nobody has run here in 30 days. Run through it to take it.</Text>
                      </>
                    )}
                  </View>
                )}
              </>
            ) : (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Hex size={20} />
                  <Text style={[s.title, num]}>{Object.keys(held).length} tiles run in</Text>
                </View>
                <Text style={[s.sub, { marginTop: 4 }]}>
                  {areas.length ? areas.slice(0, 3).map(([a, n]) => `${a} ${n}`).join(' · ') : 'Run anywhere to claim the hexes you pass through'}
                </Text>
                {sel && held[sel] !== undefined && (
                  <Text style={[s.txt, num, { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.line }]}>
                    {areaOfTile(sel)} tile · you ran {held[sel].toFixed(2)} km here in the last 30 days
                  </Text>
                )}
              </>
            )}
          </View>
        </View>
      </SafeAreaView>

      {mode === 'battle' && (
        <View style={{ position: 'absolute', bottom: 40, left: 12, right: 12, gap: 6 }} pointerEvents="none">{/* 40: leaves Apple's logo and Legal link visible */}
          {!tooFar && tiles.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
              {(['mine', 'attack', 'lost', 'reach', 'rival'] as const).filter((k) => counts[k] > 0 || k === 'mine').map((k) => {
                const st = battle.KIND_STYLE[k];
                return (
                  <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(14,16,20,0.88)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: C.line }}>
                    <View style={{ width: 11, height: 11, borderRadius: 3, backgroundColor: st.fill, borderColor: st.stroke, borderWidth: k === 'attack' ? 2 : 1 }} />
                    <Text style={[num, { color: C.txt, fontSize: 12, fontWeight: '500' }]}>{st.label} {counts[k]}</Text>
                  </View>
                );
              })}
            </View>
          )}
          <Text style={[s.sub, { alignSelf: 'center', textAlign: 'center', color: C.sec, fontSize: 11, backgroundColor: 'rgba(14,16,20,0.88)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, overflow: 'hidden', marginTop: 0 }]}>
            Tap any tile to see who holds it. Tiles near run starts and ends are hidden.
          </Text>
        </View>
      )}

      {/* Kings sheet */}
      <Modal visible={kingsOpen} animationType="slide" transparent onRequestClose={() => setKingsOpen(false)}>
        <View style={s.ov}>
          <View style={s.sheet}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Crown size={20} />
              <Text style={[s.title, { flex: 1 }]}>Kings of Singapore</Text>
              <Pressable onPress={() => setKingsOpen(false)} hitSlop={10}><Icon name="x" color={C.mut} /></Pressable>
            </View>
            <Text style={[s.sub, { marginBottom: 12 }]}>Whoever holds the most tiles in a town wears its crown.</Text>
            <ScrollView>
              {kings.length === 0 && <Text style={s.sub}>No towns claimed yet. Go run and take the first crown.</Text>}
              {[...kings].sort((a, b) => Number(b.town === profile.homeTown) - Number(a.town === profile.homeTown) || a.town.localeCompare(b.town)).map((k) => {
                const me = k.king_id === userId;
                const gap = k.king_tiles - k.my_tiles + 1;
                return (
                  <View key={k.town} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, marginBottom: 8 }, me && { borderColor: C.acc }]}>
                    <Crown size={18} color={me ? C.acc : C.mut} />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.txt, { fontWeight: '600' }]}>{k.town}{k.town === profile.homeTown ? '  ·  home' : ''}</Text>
                      <Text style={[s.sub, num, { marginTop: 0 }]}>
                        {me ? `You · ${k.king_tiles} of ${k.total_tiles} tiles` : `${k.king_avatar} @${k.king_username} · ${k.king_tiles} tiles · you ${k.my_tiles}${k.my_tiles ? ` (${gap} to the crown)` : ''}`}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
            <Btn title="Close" kind="ghost" onPress={() => setKingsOpen(false)} style={{ marginTop: 8 }} />
          </View>
        </View>
      </Modal>
    </View>
  );
}
