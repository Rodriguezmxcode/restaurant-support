import { createAutoSync } from './restocore-sync.js';
const el = id => document.getElementById(id), view = window.RestoCoreView;
async function requestURL(url, signal) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', headers: { 'X-PV-Source': 'pv-control' }, signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]) });
  let body;
  try { body = await response.json(); } catch { throw Error('OpsVista no devolvió una respuesta válida. Se conserva la consulta anterior.'); }
  if (!response.ok) throw Object.assign(new Error(response.status === 401 ? 'Tu sesión de OpsVista terminó. Abre OpsVista y vuelve aquí; la carga continuará automáticamente.' : typeof body.error === 'string' ? body.error : body.error?.message || 'No se pudo consultar OpsVista.'), { status: response.status, code: body.error?.code });
  return body;
}
const sync = createAutoSync({
  request: (path, signal) => requestURL('/api/pv-control/' + path, signal),
  refreshSource: (period, signal) => requestURL('/api/restaurant365?' + new URLSearchParams({ view: 'ap', start: period.start, end: period.end, refresh: '1' }), signal),
  publish(payload) {
    view.setBatch(payload);
    el('rc-access').hidden = true; el('rc-control').hidden = false;
  },
  status(message, error = false) { view.status(message, error); if (!el('rc-access').hidden) el('rc-access-message').textContent = message; },
  lock(message) {
    view.clear();
    el('rc-control').hidden = true; el('rc-access').hidden = false;
    el('rc-calendar').hidden = true;
    document.body.style.overflow = '';
    el('rc-access').querySelector('h2').textContent = 'Conexión con OpsVista';
    el('rc-access-message').textContent = message;
  }
});
const refresh = () => sync.run({ start: el('rc-ov-start').value, end: el('rc-ov-end').value });
let debounce;
for (const id of ['rc-ov-start', 'rc-ov-end']) el(id).addEventListener('change', () => { clearTimeout(debounce); debounce = setTimeout(refresh, 60); });
el('rc-connect').addEventListener('click', refresh);
el('rc-retry').addEventListener('click', refresh);
let interval;
function startTimer() { clearInterval(interval); interval = setInterval(() => { if (!document.hidden) void refresh(); }, 5 * 60000); }
startTimer();
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
window.addEventListener('focus', () => { if (!document.hidden) void refresh(); });
window.addEventListener('pagehide', () => { clearInterval(interval); sync.cancel(); });
window.addEventListener('pageshow', event => { if (event.persisted) { startTimer(); void refresh(); } });
void refresh();
