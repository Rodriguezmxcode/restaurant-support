import { collectInvoices } from './pv-control-sync.js';

// Only a fully validated, consistent query may replace the visible invoice set.
export function createAutoSync({ request, refreshSource, publish, status, lock, authorize = () => {}, now = Date.now }) {
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
        authorize();
        const parts = splitMonthPeriods(period), failures = [];
        let completed = 0;
        for (const part of parts) {
          if (!active()) return;
          const partKey = part.start + ':' + part.end;
          try {
            status(`Consultando ${part.start.slice(0,7)} · ${completed} de ${parts.length} períodos completos…`);
            let batch = await collectInvoices(get, part);
            if (!active()) return;
            publish({ batch, locations: result.data });
            const stale = batch.pending || now() - Date.parse(batch.snapshot) >= 30 * 60000;
            if (stale && now() - (attempts.get(partKey) || 0) >= 30 * 60000) {
              attempts.set(partKey, now());
              status(`Actualizando ${part.start.slice(0,7)} desde Restaurant365. Se conservan los demás meses…`);
              const source = await refreshSource(part, controller.signal);
              if (!active()) return;
              if (source.memory?.error) throw Error('Restaurant365 no pudo actualizarse. Se conserva la última consulta completa.');
              batch = await collectInvoices(get, part);
              if (!active()) return;
              publish({ batch, locations: result.data });
            }
            if(batch.pending)failures.push(part.start.slice(0,7)+' (actualización pendiente)');
            completed++;
          } catch (error) {
            if (!active()) return;
            if (isAuth(error)) throw error;
            failures.push(part.start.slice(0,7)+': '+error.message);
          }
        }
        status(failures.length?`${completed} de ${parts.length} períodos consultados. Pendientes: ${failures.join(' · ')}. Los meses ya cargados se conservan.`:`${completed} períodos consultados automáticamente. Puedes ver todos los meses cargados o seleccionar uno.`,failures.length>0);
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

export function splitMonthPeriods({start,end}) {
 const valid = v => /^\d{4}-\d{2}-\d{2}$/.test(v||'') && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v;
 if(!valid(start)||!valid(end)||start>end||Date.parse(end)-Date.parse(start)>=366*86400000)throw Error('Selecciona un período válido de hasta un año.');
 const parts=[];let cursor=start;
 while(cursor<=end){const d=new Date(cursor),last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).toISOString().slice(0,10),until=last<end?last:end;parts.push({start:cursor,end:until});cursor=new Date(Date.parse(until)+86400000).toISOString().slice(0,10);}
 return parts;
}
