import { collectInvoices } from './pv-control-sync.js';
const el = id => document.getElementById(id);
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
let locations = [], batch = null;
let localPort = null;
const connectionChannel = new URLSearchParams(location.hash.slice(1)).get('pv_channel');
// The local file has an opaque origin. Transfer a MessagePort after checking
// opener + one-time channel; financial data never uses postMessage('*'). The
// port belongs to the initiating document, so navigating it does not redirect data.
if (window.opener && /^[a-f0-9]{32}$/.test(connectionChannel || '')) {
  window.addEventListener('message', event => {
    if (localPort || event.source !== window.opener || event.origin !== 'null' || event.data?.type !== 'pv-control-connect' || event.data.channel !== connectionChannel || event.ports.length !== 1) return;
    localPort = event.ports[0];
    localPort.onmessage = message => {
      if (message.data?.type === 'pv-control-imported' && message.data.channel === connectionChannel) el('transfer-status').textContent = `${message.data.count} facturas recibidas por PV Control. Puedes cerrar esta ventana.`;
      if (message.data?.type === 'pv-control-import-failed' && message.data.channel === connectionChannel) { el('transfer-status').textContent = 'PV Control no pudo guardar la consulta. Revisa la ventana del archivo local.'; el('send-local').disabled = false; }
    };
    localPort.start();
    const dates = event.data.dates;
    if (dates && /^\d{4}-\d{2}-\d{2}$/.test(dates.start) && /^\d{4}-\d{2}-\d{2}$/.test(dates.end)) { el('start').value = dates.start; el('end').value = dates.end; }
    el('local-transfer').hidden = false;
  });
  window.opener.postMessage({ type: 'pv-control-ready', channel: connectionChannel }, '*');
}
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
el('start').value = today.slice(0, 8) + '01'; el('end').value = today;

function status(message, kind = '') { el('status').textContent = message; el('status').className = kind; }
function lock(message) {
  batch = null; locations = [];
  el('send-local').disabled = true;
  el('workspace').hidden = true; el('access').hidden = false;
  el('access-message').textContent = message;
  el('connection').textContent = 'Sesión requerida'; el('connection').className = 'badge';
  el('rows').replaceChildren();
  for (const id of ['count', 'amount', 'missing']) el(id).textContent = '—';
}
async function request(path) {
  const response = await fetch('/api/pv-control/' + path, { credentials: 'same-origin', cache: 'no-store', headers: { 'X-PV-Source': 'pv-control' }, signal: AbortSignal.timeout(120000) });
  let body;
  try { body = await response.json(); } catch { throw new Error('OpsVista no devolvió una respuesta válida. Intenta de nuevo.'); }
  if (!response.ok) {
    let message = body.error?.message || 'No se pudo consultar OpsVista.';
    const retry = response.headers.get('Retry-After');
    if (retry && /^(\d+)$/.test(retry)) message += ` Reintenta en ${retry} segundos.`;
    if (response.status === 401 || response.status === 403) lock(message);
    throw Object.assign(new Error(message), { status: response.status, code: body.error?.code });
  }
  return body;
}
async function connect() {
  el('retry').disabled = true;
  try {
    const health = await request('health');
    if (health.ok !== true || health.organization_id !== 'org-puerto-vallarta') throw new Error('No se pudo confirmar la conexión.');
    const result = await request('locations');
    if (result.api_version !== '1' || result.organization_id !== 'org-puerto-vallarta' || !Array.isArray(result.data)) throw new Error('No se pudieron verificar las sucursales.');
    locations = result.data;
    el('location').replaceChildren(new Option('Todas las sucursales', ''), ...locations.map(location => new Option(location.name, location.id)));
    el('access').hidden = true; el('workspace').hidden = false;
    el('connection').textContent = 'Conexión activa · solo lectura'; el('connection').className = 'badge connected';
  } catch (error) { lock(error.message); }
  finally { el('retry').disabled = false; }
}
function render() {
  if (!batch) return;
  const location = el('location').value, search = el('search').value.trim().toLowerCase();
  const rows = batch.rows.filter(row => (!location || row.location_id === location) && (!search || `${row.vendor_name || ''} ${row.number || ''}`.toLowerCase().includes(search)));
  const known = rows.filter(row => row.amount !== null);
  el('count').textContent = String(rows.length);
  el('amount').textContent = known.length ? currency.format(known.reduce((sum, row) => sum + row.amount, 0)) : '—';
  el('missing').textContent = String(rows.length - known.length);
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const tr = document.createElement('tr');
    const values = [row.transaction_date, locations.find(location => location.id === row.location_id)?.name || row.location_id, row.vendor_name || 'No disponible', row.number || row.id, row.amount === null ? 'No disponible' : currency.format(row.amount), { approved: 'Aprobada', unapproved: 'Sin aprobar', unknown: 'No disponible' }[row.approval_status] || 'No disponible'];
    values.forEach((value, index) => { const td = document.createElement('td'); td.textContent = value; if (index === 4) td.className = 'numeric'; tr.append(td); });
    fragment.append(tr);
  }
  if (!rows.length) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 6; td.className = 'empty'; td.textContent = 'Sin facturas para este período y filtro.'; tr.append(td); fragment.append(tr); }
  el('rows').replaceChildren(fragment);
  el('freshness').textContent = `${batch.start} a ${batch.end} · Copia de ${new Date(batch.snapshot).toLocaleString('es-MX', { timeZone: 'America/New_York' })} (hora de Connecticut)`;
}
el('sync-form').addEventListener('submit', async event => {
  event.preventDefault(); el('sync').disabled = true;
  status('Consultando facturas…');
  try {
    const complete = await collectInvoices(request, { start: el('start').value, end: el('end').value }, count => status(`Consultando facturas… ${count} recibidas`));
    if (complete.rows.some(row => !locations.some(location => location.id === row.location_id))) throw new Error('La respuesta contiene una sucursal no reconocida.');
    batch = complete; render();
    el('send-local').disabled = !localPort;
    el('transfer-status').textContent = `${batch.rows.length} facturas del ${batch.start} al ${batch.end}. El envío incluye todas las sucursales del período, aunque apliques un filtro en la tabla.`;
    status(`${batch.rows.length} facturas consultadas.${batch.pending ? ' OpsVista está actualizando esta copia; vuelve a sincronizar más tarde.' : ''}`, 'success');
  } catch (error) { status(`${error.message}${batch ? ' Se conserva la consulta anterior.' : ''}`, 'error'); }
  finally { el('sync').disabled = false; }
});
el('retry').addEventListener('click', connect);
el('location').addEventListener('change', render);
el('search').addEventListener('input', render);
el('send-local').addEventListener('click', async () => {
  if (!localPort || !batch) return;
  el('send-local').disabled = true;
  try {
    await request('health');
    if (!batch) return;
    localPort.postMessage({ type: 'pv-control-invoices', channel: connectionChannel, locations, batch });
    el('transfer-status').textContent = 'Enviando la consulta al archivo local…';
  } catch (error) { el('transfer-status').textContent = error.message; el('send-local').disabled = !batch; }
});
window.addEventListener('pageshow', event => { if (event.persisted) { lock('Verifica tu sesión para continuar.'); void connect(); } });
void connect();
