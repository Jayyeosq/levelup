// Keeps this phone registered for tile alerts, and opens the Battle map when an alert is tapped.
import { router } from 'expo-router';
import { useEffect } from 'react';
import { useAuth } from '../lib/auth';
import * as push from '../lib/push';

export default function PushSync() {
  const { userId } = useAuth();
  useEffect(() => push.init(() => { setTimeout(() => router.navigate('/territory'), 300); }), []);
  useEffect(() => { if (userId) push.refresh(userId); }, [userId]);
  return null;
}
