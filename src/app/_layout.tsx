import { Tabs } from 'expo-router/js-tabs';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import AuthScreen from '../components/AuthScreen';
import HealthSync from '../components/HealthSync';
import { AuthProvider, useAuth } from '../lib/auth';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { C, Icon, IconName } from '../components/ui';
import { StoreProvider } from '../lib/store';

const icon = (name: IconName) => ({ focused }: { focused: boolean }) => <Icon name={name} color={focused ? C.acc : C.mut} size={20} />;

function AuthGate() {
  const { loading, session } = useAuth();
  if (loading) return <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', zIndex: 100, elevation: 100 }}><ActivityIndicator color={C.acc} /></View>;
  return session ? null : <AuthScreen />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
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
          <Tabs.Screen name="community" options={{ title: 'Community', tabBarIcon: icon('users') }} />
          <Tabs.Screen name="progress" options={{ title: 'Progress', tabBarIcon: icon('award') }} />
          <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('user') }} />
        </Tabs>
        <HealthSync />
        <AuthGate />
      </StoreProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
