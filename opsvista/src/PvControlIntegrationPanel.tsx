import { useEffect, useState } from 'react';
import type { PartnerKey } from '../shared/partnerApi';

const endpoint = '/api/integrations/pv-control';
export default function PvControlIntegrationPanel() {
  const [keys, setKeys] = useState<PartnerKey[]>([]);
  const [name, setName] = useState('PV Control');
  const [issued, setIssued] = useState<{ token: string; key: PartnerKey } | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function load() {
    const response = await fetch(endpoint, { credentials: 'include', cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || body.error || 'No se pudo abrir la conexión.');
    setKeys(body.keys);
  }
  useEffect(() => { void load().catch(reason => setError(reason.message)).finally(() => setBusy(false)); }, []);
  async function mutate(action: 'create' | 'revoke', id?: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(endpoint, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, name, id }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || body.error || 'No se pudo guardar la conexión.');
      if (action === 'create') { setIssued(body); setNotice('Clave creada. Cópiala ahora: solo se muestra una vez.'); }
      else { if (issued?.key.id === id) setIssued(null); setNotice('Clave revocada. Ya no permite consultar datos.'); }
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Conexión no disponible.'); }
    finally { setBusy(false); }
  }
  async function copyToken() {
    try { await navigator.clipboard.writeText(issued!.token); setNotice('Clave copiada. Guárdala en los secretos del servidor de PV Control.'); }
    catch { setError('No se pudo copiar. Selecciona y copia la clave del campo.'); }
  }
  const fieldStyle = { padding: 10, border: '1px solid #cbd5e1', borderRadius: 8, maxWidth: '100%' };
  return <section className="panel" style={{ marginBottom: 18 }}>
    <div className="panel-header"><div><h2>PV Control · conexión con OpsVista</h2><p>Comparte locaciones y facturas con tu app contable. Acceso de lectura a los seis restaurantes y Corporate Office.</p></div><span className="count-pill">API V1</span></div>
    <p><a href="/pv-control.html" target="_blank" rel="noreferrer" style={{ display: 'inline-block', padding: '12px 18px', borderRadius: 8, background: '#14283f', color: '#fff', textDecoration: 'none', fontWeight: 700 }}>Abrir PV Control · conectado a OpsVista</a></p>
    <p>La versión web consulta facturas de R365 y recibe facturas creadas en PV Control con tu sesión de Founder. Abre AP queue en tu archivo local, pulsa Enviar a OpsVista y confirma los datos en la nueva pestaña.</p>
    <p>Las facturas de PV Control se guardan en una bandeja para revisión. Todavía no alimentan P&amp;L, Price Watch ni saldos por pagar; la recepción no confirma un pago.</p>
    <p><a href="/pv-control-api.md" target="_blank" rel="noreferrer">Instrucciones para conectar</a> · <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">Especificación OpenAPI</a></p>
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
    {notice && <p role="status" style={{ color: '#166534' }}>{notice}</p>}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '14px 0' }}>
      <input aria-label="Nombre de la conexión de API" value={name} maxLength={80} onChange={event => setName(event.target.value)} style={fieldStyle}/>
      <button type="button" disabled={busy || !name.trim() || Boolean(issued)} onClick={() => void mutate('create')}>{busy ? 'Procesando…' : 'Crear clave para PV Control'}</button>
    </div>
    {issued && <div style={{ padding: 16, border: '1px solid #93c5fd', borderRadius: 12, background: '#eff6ff' }}>
      <strong>Clave nueva · válida hasta {new Date(issued.key.expiresAt).toLocaleDateString()}</strong>
      <p>Guárdala como secreto en el servidor de PV Control. No la pegues en chats ni en el código del navegador.</p>
      <input aria-label="Clave de API nueva" readOnly type="text" autoComplete="off" spellCheck={false} value={issued.token} style={{ ...fieldStyle, width: '100%', boxSizing: 'border-box' }}/>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}><button type="button" onClick={() => void copyToken()}>Copiar clave</button><button type="button" onClick={() => setIssued(null)}>Ya la guardé · ocultar</button></div>
    </div>}
    <p>GET <code>/api/v1/locations</code><br/>GET <code>/api/v1/invoices?start=2026-08-01&amp;end=2026-08-31</code></p>
    <p>Las claves vencen a los 90 días y permiten hasta 30 solicitudes por minuto. Puedes revocarlas aquí.</p>
    {keys.map(key => <div key={key.id} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', padding: '12px 0', borderTop: '1px solid #e2e8f0' }}>
      <div style={{ flex: '1 1 230px' }}><strong>{key.name}</strong><div><code>{key.prefix}…</code> · {key.revokedAt ? 'Revocada' : new Date(key.expiresAt).getTime() <= Date.now() ? 'Vencida' : 'Activa'}</div><small>Vence: {new Date(key.expiresAt).toLocaleDateString()} · Último uso: {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : 'Sin solicitudes'}</small></div>
      {!key.revokedAt && <button type="button" disabled={busy} onClick={() => void mutate('revoke', key.id)}>Revocar {key.name}</button>}
    </div>)}
  </section>;
}
