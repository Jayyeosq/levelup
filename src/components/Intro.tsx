// First-launch intro: three short screens before sign-up.
import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Btn, C, Hex, Icon, IconName, s } from './ui';

const PAGES: [IconName, string, string][] = [
  ['activity', 'Every run earns XP', 'Run with the app or your watch. Each km earns XP, with bonuses for streaks, early starts and personal bests.'],
  ['chevrons-up', 'Level up', 'XP takes you from Shuffler to Legend, with 12 badges to collect on the way.'],
  ['map', 'Take your neighbourhood', 'The streets you run become your tiles. Run there more than your rivals to keep them, and become King of your town.'],
];

export default function Intro({ onDone }: { onDone: () => void }) {
  const { width } = useWindowDimensions();
  const ref = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [page, setPage] = useState(0);
  const last = page === PAGES.length - 1;
  const go = (i: number) => { ref.current?.scrollTo({ x: i * width, animated: true }); setPage(i); };

  return (
    <SafeAreaView style={[s.screen, { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, elevation: 100 }]}>
      <Pressable onPress={onDone} hitSlop={12} style={{ alignSelf: 'flex-end', paddingHorizontal: 24, paddingVertical: 12 }}>
        <Text style={{ color: C.sec, fontWeight: '500', fontSize: 15 }}>{last ? ' ' : 'Skip'}</Text>
      </Pressable>
      <ScrollView ref={ref} horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ flex: 1 }}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}>
        {PAGES.map(([icon, title, text]) => (
          <View key={title} style={{ width, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
            <Hex size={128}><Icon name={icon} size={52} color={C.onAcc} /></Hex>
            <Text style={{ color: C.txt, fontSize: 26, fontWeight: '600', textAlign: 'center', marginTop: 32 }}>{title}</Text>
            <Text style={{ color: C.sec, fontSize: 16, lineHeight: 23, textAlign: 'center', marginTop: 12 }}>{text}</Text>
          </View>
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 20 }}>
        {PAGES.map((p, i) => (
          <View key={p[1]} style={{ width: i === page ? 20 : 8, height: 8, borderRadius: 4, backgroundColor: i === page ? C.acc : C.line2 }} />
        ))}
      </View>
      <View style={{ paddingHorizontal: 24, paddingBottom: 16 }}>
        <Btn title={last ? 'Get started' : 'Next'} onPress={() => (last ? onDone() : go(page + 1))} />
        <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center', marginTop: 16 }}>
          <Icon name="lock" size={13} color={C.mut} />
          <Text style={[s.sub, { marginTop: 0, fontSize: 12 }]}>Others only see your username. Your routes stay private.</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
