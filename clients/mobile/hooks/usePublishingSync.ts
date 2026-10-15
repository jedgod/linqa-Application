// Keeps the publishing outbox moving: when an account is signed in, when the app returns to the foreground, and once a minute.
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAccounts } from '../account/AccountContext';
import { syncAndRecord } from '../lib/publishing/integration';

export function usePublishingSync() {
  const { active, loaded } = useAccounts();
  const userId = active?.userId ?? null;
  useEffect(() => {
    if (!loaded || !userId) return;
    const run = () => { void syncAndRecord(userId).catch(() => undefined); };
    run();
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') run(); });
    const timer = setInterval(run, 60_000);
    return () => { sub.remove(); clearInterval(timer); };
  }, [loaded, userId]);
}
