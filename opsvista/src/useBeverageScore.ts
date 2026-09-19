import { useEffect, useRef, useState } from 'react';
import type { BeverageScoreResponse } from '../shared/beverageScore';
import { beverageChunks, beverageLocations } from '../shared/beverageMetrics';

export function useBeverageScore(start: string, end: string, valid: boolean) {
  const [snapshot, setSnapshot] = useState<BeverageScoreResponse>();
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false), [refreshNotice, setRefreshNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const refreshController = useRef<AbortController | null>(null);
  useEffect(() => {
    setRefreshNotice(''); setRefreshing(false);
    return () => { refreshController.current?.abort(); refreshController.current = null; };
  }, [start, end, valid]);
  const refresh = async () => {
    if (!valid || refreshController.current) return;
    const controller = new AbortController(); refreshController.current = controller;
    setRefreshing(true); setError(''); setRefreshNotice('Buscando facturas y cambios del período seleccionado…');
    const jobs = beverageLocations.flatMap(location => beverageChunks(start, end).map(chunk => ({ location, ...chunk })));
    let cursor = 0, completed = 0, failures = 0;
    const worker = async () => {
      while (!controller.signal.aborted && cursor < jobs.length) {
        const job = jobs[cursor++];
        try {
          const response = await fetch(`/api/integrations/restaurant365?${new URLSearchParams({ view: 'beverage', entity: job.location, start: job.start, end: job.end, refresh: '1' })}`, { credentials: 'include', cache: 'no-store', signal: controller.signal });
          const body = await response.json();
          if (!response.ok || body.sales?.error || body.purchases?.error || body.memory?.sales.error || body.memory?.purchases.error) failures++;
        } catch { if (!controller.signal.aborted) failures++; }
        completed++;
        if (!controller.signal.aborted) setRefreshNotice(`Actualizando alcohol: ${completed} de ${jobs.length} consultas.`);
      }
    };
    await Promise.all([worker(), worker()]);
    if (!controller.signal.aborted) {
      setRefreshing(false); refreshController.current = null; setRevision(value => value + 1);
      setRefreshNotice(failures ? 'Algunas fuentes requieren reintento. Se conserva la copia guardada; revisa los pendientes.' : 'Datos de alcohol actualizados. Recalculando porcentaje y puntos…');
    }
  };
  useEffect(() => {
    setError('');
    if (!valid) return;
    const controller = new AbortController();
    let running = false;
    const read = async () => {
      if (running || refreshController.current) return;
      running = true;
      try {
        const response = await fetch(`/api/integrations/restaurant365?${new URLSearchParams({ view: 'beverage-score', start, end })}`, { credentials: 'include', cache: 'no-store', signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'No se pudo consultar alcohol.');
        if (body.start !== start || body.end !== end || !Array.isArray(body.rows)) throw new Error('Respuesta de alcohol inválida.');
        if (!controller.signal.aborted) { setSnapshot(body); setError(''); setRefreshNotice(previous=>previous==='Datos de alcohol actualizados. Recalculando porcentaje y puntos…'?'Datos de alcohol actualizados. Porcentaje y puntos recalculados.':previous); }
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Alcohol pendiente.'); }
      finally { running = false; }
    };
    void read();
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void read(); }, 60000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [start, end, valid, revision]);
  const data = valid && snapshot?.start === start && snapshot?.end === end ? snapshot : undefined;
  return { data, error, refresh, refreshing, refreshNotice };
}
