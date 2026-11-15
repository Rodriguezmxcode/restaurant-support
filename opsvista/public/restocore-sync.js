import { collectInvoices } from './pv-control-sync.js';

// Only a fully validated, consistent query may replace the visible invoice set.
export function createAutoSync({ request, refreshSource, publish, status, lock, now = Date.now }) {
  let generation = 0, current = null;
  const attempts = new Map();
  const isAuth = error => error.status === 401 || error.status === 403;
  function cancel() { generation++; current?.controller.abort(); current = null; }
  function run(period) {
    const key = period.start + ':' + period.end;
    if (current?.key === key) return current.promise;
    cancel();
    const token = generation, controller = new AbortController();
    const active = () => token === generation && !controller.signal.aborted;
    const get = path => request(path, controller.signal);
    const work = async () => {
      try {
        status('Consultando Restaurant365 vía OpsVista…');
        const health = await get('health');
        if (!active()) return;
        if (health.ok !== true || health.organization_id !== 'org-puerto-vallarta') throw Error('No se pudo verificar la conexión con Puerto Vallarta.');
        const result = await get('locations');
        if (!active()) return;
        if (result.api_version !== '1' || result.organization_id !== 'org-puerto-vallarta' || !Array.isArray(result.data)) throw Error('No se pudieron verificar las sucursales.');
        let batch = await collectInvoices(get, period);
        if (!active()) return;
        publish({ batch, locations: result.data });
        const stale = batch.pending || now() - Date.parse(batch.snapshot) >= 30 * 60000;
        if (stale && now() - (attempts.get(key) || 0) >= 30 * 60000) {
          attempts.set(key, now());
          status('Consultando cambios en Restaurant365. Se conserva la última consulta completa…');
          // The existing authenticated source endpoint updates the durable OpsVista snapshot.
          const source = await refreshSource(period, controller.signal);
          if (!active()) return;
          if (source.memory?.error) throw Error('Restaurant365 no pudo actualizarse. Se conserva la última consulta completa.');
          batch = await collectInvoices(get, period);
          if (!active()) return;
          publish({ batch, locations: result.data });
        }
        status(`${batch.rows.length} facturas cargadas automáticamente. ${batch.pending ? 'Actualización de la fuente pendiente; se muestra la última copia completa.' : 'Consulta completa.'} El próximo control es automático.`);
      } catch (error) {
        if (!active()) return;
        if (isAuth(error)) lock(error.message);
        else status(error.message || 'No se pudo actualizar. Se conserva la consulta anterior.', true);
      } finally { if (active()) current = null; }
    };
    current = { key, controller, promise: null };
    current.promise = work();
    return current.promise;
  }
  return { run, cancel };
}
