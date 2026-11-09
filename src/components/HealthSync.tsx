// Pulls new runs from Apple Health automatically: when the app opens and each
// time it comes back to the foreground (at most every 10 minutes).
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../lib/auth';
import * as health from '../lib/health';
import { useStore } from '../lib/store';

export default function HealthSync() {
  const { userId } = useAuth();
  const { ready, importRuns } = useStore();
  const last = useRef(0);

  useEffect(() => {
    if (!userId || !ready || !health.healthSupported()) return;
    const run = async () => {
      if (Date.now() - last.current < 10 * 60_000) return;
      if (!(await health.isConnected())) return;
      last.current = Date.now();
      try { importRuns((await health.fetchRuns(14)).runs); } catch { /* try again next time */ }
    };
    const t = setTimeout(run, 3000); // let the account sync finish first
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') run(); });
    return () => { clearTimeout(t); sub.remove(); };
  }, [userId, ready, importRuns]);

  return null;
}
