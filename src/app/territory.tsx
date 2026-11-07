import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import MapView, { Polygon, Polyline } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, Hex, num, s } from '../components/ui';
import { areasHeld, dayOf, heldTiles } from '../lib/game';
import { areaOfTile, tileCenter, tilePolygon } from '../lib/geo';
import { useStore } from '../lib/store';
import { currentPosition } from '../lib/tracker';

export default function Territory() {
  const { state } = useStore();
  const today = dayOf(Date.now());
  const held = useMemo(() => heldTiles(state, today), [state, today]);
  const areas = useMemo(() => areasHeld(state, today), [state, today]);
  const [sel, setSel] = useState<string | null>(null);
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    (async () => {
      const ids = Object.keys(held);
      const target = ids.length ? tileCenter(ids[0]) : await currentPosition();
      if (target) mapRef.current?.animateToRegion({ ...target, latitudeDelta: 0.03, longitudeDelta: 0.03 }, 600);
    })();
  }, []); // centre once on open

  const lastRoute = state.runs.find((r) => !r.flagged)?.route ?? [];

  return (
    <View style={s.screen}>
      <MapView ref={mapRef} style={{ flex: 1 }} showsUserLocation userInterfaceStyle="dark"
        initialRegion={{ latitude: 1.3521, longitude: 103.8198, latitudeDelta: 0.25, longitudeDelta: 0.25 }}
        onPress={() => setSel(null)}>
        {Object.entries(held).map(([id, km]) => (
          <Polygon key={id} coordinates={tilePolygon(id)} tappable onPress={() => setSel(id)}
            fillColor={`rgba(255,106,43,${Math.min(0.75, 0.3 + km * 0.25).toFixed(2)})`}
            strokeColor={sel === id ? '#ffffff' : 'rgba(255,106,43,0.9)'} strokeWidth={sel === id ? 3 : 1} />
        ))}
        {lastRoute.length > 1 && <Polyline coordinates={lastRoute} strokeColor="#ffffff" strokeWidth={2} />}
      </MapView>
      <SafeAreaView edges={['top']} style={{ position: 'absolute', top: 0, left: 0, right: 0 }} pointerEvents="box-none">
        <View style={[s.card, { margin: 12, opacity: 0.96 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Hex size={20} />
            <Text style={[s.title, num]}>{Object.keys(held).length} tiles held</Text>
          </View>
          <Text style={[s.sub, { marginTop: 4 }]}>
            {areas.length ? areas.slice(0, 3).map(([a, n]) => `${a} ${n}`).join(' · ') : 'Run anywhere to claim the hexes you pass through'}
          </Text>
          {sel && (
            <Text style={[s.txt, num, { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.line }]}>
              {areaOfTile(sel)} tile · you ran {held[sel].toFixed(2)} km here in the last 30 days
            </Text>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}
