// Supabase client (accounts + cloud sync). The key here is the PUBLIC
// "publishable"/anon key — safe to ship in the app; the database's row-level
// security rules decide what each user may read or write.
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { AppState } from 'react-native';

const extra = (Constants.expoConfig?.extra ?? {}) as { supabaseUrl?: string; supabaseKey?: string };
export const SUPABASE_URL = extra.supabaseUrl ?? '';
export const SUPABASE_KEY = extra.supabaseKey ?? '';
export const supabaseReady = /^https:\/\//.test(SUPABASE_URL) && SUPABASE_KEY.length > 20;

export const supabase = createClient(SUPABASE_URL || 'https://placeholder.supabase.co', SUPABASE_KEY || 'placeholder-key', {
  auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

// Keep the login fresh only while the app is open.
AppState.addEventListener('change', (s) => {
  if (s === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
