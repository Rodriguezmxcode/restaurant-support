import { useEffect, useState } from 'react';
import type { BeverageScoreResponse } from '../shared/beverageScore';

export function useBeverageScore(start: string, end: string, valid: boolean) {
  const [snapshot, setSnapshot] = useState<BeverageScoreResponse>();
  const [error, setError] = useState('');
  useEffect(() => {
    setError('');
    if (!valid) return;
    const controller = new AbortController();
    let running = false;
    const read = async () => {
      if (running) return;
      running = true;
      try {
        const response = await fetch(`/api/integrations/restaurant365?${new URLSearchParams({ view: 'beverage-score', start, end })}`, { credentials: 'include', cache: 'no-store', signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'No se pudo consultar alcohol.');
        if (body.start !== start || body.end !== end || !Array.isArray(body.rows)) throw new Error('Respuesta de alcohol inválida.');
        if (!controller.signal.aborted) { setSnapshot(body); setError(''); }
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Alcohol pendiente.'); }
      finally { running = false; }
    };
    void read();
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void read(); }, 60000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [start, end, valid]);
  const data = valid && snapshot?.start === start && snapshot?.end === end ? snapshot : undefined;
  return { data, error };
}
