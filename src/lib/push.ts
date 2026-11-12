// Push notifications: "your tiles are under attack" and "X took N of your tiles".
// The phone registers a push token with the server (0008_notifications.sql);
// the server sends the alerts when another runner's run changes your tiles.
// Needs the LevelUp+ app build made after notifications were added. In Expo Go,
// or in an older build, everything here quietly reports "unsupported".
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

const TOKEN_KEY = 'levelup.push.token';                         // the token this phone registered
const offKey = (uid: string) => `levelup.push.off.${uid}`;      // this account turned alerts off

export type PushState = 'unsupported' | 'on' | 'off' | 'blocked';

// Loaded lazily and only when the native part exists: loading it without would crash.
let N: any | null | undefined;
function lib(): any | null {
  if (N !== undefined) return N;
  if (Platform.OS === 'web') return (N = null);
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return (N = null);
  try { if (!requireOptionalNativeModule('ExpoPushTokenManager')) return (N = null); } catch { return (N = null); }
  try { N = require('expo-notifications'); } catch { N = null; }
  return N;
}

export const supported = () => !!lib();

export async function state(uid: string): Promise<PushState> {
  const n = lib();
  if (!n) return 'unsupported';
  try {
    const p = await n.getPermissionsAsync();
    if (!p.granted) return p.canAskAgain === false ? 'blocked' : 'off';
    return (await AsyncStorage.getItem(offKey(uid))) === '1' ? 'off' : 'on';
  } catch { return 'unsupported'; }
}

async function register(): Promise<void> {
  const n = lib();
  if (!n) return;
  const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
  const { data: token } = await n.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  const { error } = await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
  if (error) throw error;
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

/** Asks for permission (first time only) and registers this phone. */
export async function enable(uid: string): Promise<PushState> {
  const n = lib();
  if (!n) return 'unsupported';
  let p = await n.getPermissionsAsync();
  if (!p.granted && p.canAskAgain !== false) {
    p = await n.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
  }
  if (!p.granted) return p.canAskAgain === false ? 'blocked' : 'off';
  await register();
  await AsyncStorage.removeItem(offKey(uid));
  return 'on';
}

/**
 * Stops alerts to this phone. With `uid`: the user turned them off, remember that.
 * Without: logging out, so the next account on this phone doesn't get this one's alerts.
 */
export async function disable(uid?: string): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (token) {
      await supabase.rpc('unregister_push_token', { p_token: token });
      await AsyncStorage.removeItem(TOKEN_KEY);
    }
    if (uid) await AsyncStorage.setItem(offKey(uid), '1');
  } catch { /* best effort */ }
}

/** On app start / login: tokens can change, so register again if alerts are on. */
export async function refresh(uid: string): Promise<void> {
  try { if ((await state(uid)) === 'on') await register(); } catch { /* try again next launch */ }
}

/** Shows alerts while the app is open, and calls `onOpen` when one is tapped. */
export function init(onOpen: () => void): () => void {
  const n = lib();
  if (!n) return () => {};
  try {
    n.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
    });
    const sub = n.addNotificationResponseReceivedListener(() => onOpen());
    // Opened from a notification while the app was closed
    if (n.getLastNotificationResponse?.()) { onOpen(); n.clearLastNotificationResponse?.(); }
    return () => sub.remove();
  } catch { return () => {}; }
}
