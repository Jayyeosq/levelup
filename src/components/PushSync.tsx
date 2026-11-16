// Keeps this phone registered for alerts, and opens the right tab when a notification is tapped:
// the Battle map for tile alerts, the Run tab for a nudge.
import { router } from 'expo-router';
import { useEffect } from 'react';
import { useAuth } from '../lib/auth';
import * as push from '../lib/push';

export default function PushSync() {
  const { userId } = useAuth();
  useEffect(() => push.init((screen) => { setTimeout(() => router.navigate(screen === 'run' ? '/' : '/territory'), 300); }), []);
  useEffect(() => { if (userId) push.refresh(userId); }, [userId]);
  return null;
}
