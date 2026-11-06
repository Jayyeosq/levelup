import { Tabs } from 'expo-router/js-tabs';
import { StatusBar } from 'expo-status-bar';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { C } from '../components/ui';
import { StoreProvider } from '../lib/store';

const icon = (e: string) => ({ focused }: { focused: boolean }) => (
  <Text style={{ fontSize: 21, opacity: focused ? 1 : 0.55 }}>{e}</Text>
);

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <StatusBar style="light" />
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: C.acc,
            tabBarInactiveTintColor: C.mut,
            tabBarStyle: { backgroundColor: C.bg, borderTopColor: C.line },
            tabBarLabelStyle: { fontWeight: '700', fontSize: 11 },
            sceneStyle: { backgroundColor: C.bg },
          }}
        >
          <Tabs.Screen name="index" options={{ title: 'Run', tabBarIcon: icon('🏃') }} />
          <Tabs.Screen name="territory" options={{ title: 'Territory', tabBarIcon: icon('🗺️') }} />
          <Tabs.Screen name="progress" options={{ title: 'Progress', tabBarIcon: icon('🎖️') }} />
          <Tabs.Screen name="history" options={{ title: 'History', tabBarIcon: icon('📋') }} />
          <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('👤') }} />
        </Tabs>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
