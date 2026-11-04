import { useCallback, useEffect, useState } from 'react';

/** Refresh current-day snapshots together, never just advance salary against stale sales. */
export function useLaborSnapshotRefresh(enabled: boolean) {
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [enabled, refresh]);
  return { revision, refresh };
}
