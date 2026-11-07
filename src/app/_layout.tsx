import { Tabs } from 'expo-router/js-tabs';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { C, Icon, IconName } from '../components/ui';
import { StoreProvider } from '../lib/store';

const icon = (name: IconName) => ({ focused }: { focused: boolean }) => <Icon name={name} color={focused ? C.acc : C.mut} size={20} />;

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
            tabBarLabelStyle: { fontWeight: '500', fontSize: 11 },
            sceneStyle: { backgroundColor: C.bg },
          }}
        >
          <Tabs.Screen name="index" options={{ title: 'Run', tabBarIcon: icon('activity') }} />
          <Tabs.Screen name="territory" options={{ title: 'Territory', tabBarIcon: icon('map') }} />
          <Tabs.Screen name="progress" options={{ title: 'Progress', tabBarIcon: icon('award') }} />
          <Tabs.Screen name="history" options={{ title: 'History', tabBarIcon: icon('list') }} />
          <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('user') }} />
        </Tabs>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
