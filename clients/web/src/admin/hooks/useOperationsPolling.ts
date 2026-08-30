import { useCallback, useEffect, useState } from "react";

// This app doesn't have a generic realtime event channel to subscribe to --
// clients/web/src/services/RealtimeClient.ts only ever emits
// "envelope.available" for message sync, and there's no server-side
// generic pub/sub to attach ops.* events to (server/src/realtime/hub.ts is
// per-user WebSocket push, not topic broadcast). Polling is the honest
// choice here rather than inventing a second realtime framework.
export function usePolling<T>(fetcher: () => Promise<T>, intervalMs: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetcher()
      .then((value) => {
        setData(value);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Request failed"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    setLoading(true);
    load();
    const id = window.setInterval(load, intervalMs);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, intervalMs]);

  return { data, error, loading, refresh: load };
}
