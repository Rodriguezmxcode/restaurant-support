import { useEffect, useState } from 'react';

type Status = {
  configured: boolean;
  connected: boolean;
  clientId: string;
  connectedEmail?: string;
  connectedAt?: string;
  redirectUri: string;
};

const DEFAULT_CLIENT_ID = '231297259640-k8a08nq0ces7lnqr9edpc64u8kq8ljpe.apps.googleusercontent.com';
const locations = ['Stamford', 'Orange', 'Fairfield', 'Danbury', 'Avon', 'Southington'];

export default function GoogleBusinessIntegrationPanel() {
  const [status, setStatus] = useState<Status>();
  const [clientId, setClientId] = useState(DEFAULT_CLIENT_ID);
  const [clientSecret, setClientSecret] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const response = await fetch('/api/integrations/google-business', { credentials: 'include', cache: 'no-store' });
    const body = await response.json().catch(() => ({})) as Status & { error?: string };
    if (!response.ok) throw new Error(body.error || 'Google Business connection status is unavailable');
    setStatus(body);
    if (body.clientId) setClientId(body.clientId);
  };

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get('integration') === 'google-business') {
      if (query.get('status') === 'connected') setNotice('Google Business quedó conectado correctamente.');
      if (query.get('status') === 'error') setError(query.get('message') || 'Google no pudo completar la autorización.');
      window.history.replaceState({}, '', window.location.pathname);
    }
    void load().catch(reason => setError(reason instanceof Error ? reason.message : 'Google Business connection status is unavailable'));
  }, []);

  const save = async () => {
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/integrations/google-business', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', clientId, clientSecret }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Google OAuth client could not be saved');
      setClientSecret(''); setNotice('Credenciales guardadas de forma cifrada. Ya puedes conectar Google Business.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Google OAuth client could not be saved');
    } finally { setSaving(false); }
  };

  const copyRedirect = async () => {
    if (!status?.redirectUri) return;
    await navigator.clipboard.writeText(status.redirectUri);
    setNotice('URL de retorno copiada.');
  };

  return <section className="panel" style={{marginBottom:18}}>
    <div className="panel-header">
      <div><h2>Google Business Profile</h2><p>Una sola autorización conecta automáticamente las seis locaciones administradas por la cuenta de Google.</p></div>
      <span className="count-pill">{status?.connected ? 'CONECTADO' : status?.configured ? 'LISTO PARA CONECTAR' : 'PENDIENTE'}</span>
    </div>

    {notice && <div style={{margin:'14px 0',padding:'12px 14px',border:'1px solid #86efac',borderRadius:10,background:'#f0fdf4',color:'#166534'}}>{notice}</div>}
    {error && <div style={{margin:'14px 0',padding:'12px 14px',border:'1px solid #fca5a5',borderRadius:10,background:'#fff1f2',color:'#991b1b'}}>{error}</div>}

    {status?.connected ? <>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10,marginTop:14}}>
        {locations.map(location => <div key={location} style={{padding:'12px 14px',border:'1px solid #bbf7d0',borderRadius:10,background:'#f0fdf4'}}><strong style={{color:'#166534'}}>✓ {location}</strong><div style={{fontSize:12,color:'#64748b',marginTop:4}}>Google Reviews conectado</div></div>)}
      </div>
      <p style={{margin:'14px 0 0',color:'#64748b'}}>Cuenta autorizada: <strong>{status.connectedEmail || 'Google Business manager'}</strong>{status.connectedAt ? ` · ${new Date(status.connectedAt).toLocaleString()}` : ''}</p>
    </> : <div style={{display:'grid',gap:16,marginTop:14}}>
      <div style={{padding:16,border:'1px solid #e2e8f0',borderRadius:12}}>
        <strong>1. Autoriza el retorno seguro de OpsVista</strong>
        <p style={{margin:'6px 0 10px',color:'#64748b'}}>Copia esta dirección en “Authorized redirect URIs” del cliente OAuth de Google.</p>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><input readOnly value={status?.redirectUri || ''} style={{flex:'1 1 420px',padding:10,border:'1px solid #cbd5e1',borderRadius:8}}/><button onClick={copyRedirect}>Copiar URL</button><a href="https://console.cloud.google.com/auth/clients?project=radiant-saga-506507-p2" target="_blank" rel="noreferrer" style={{alignSelf:'center'}}>Abrir Google Cloud</a></div>
      </div>

      <div style={{padding:16,border:'1px solid #e2e8f0',borderRadius:12}}>
        <strong>2. Guarda el cliente OAuth</strong>
        <p style={{margin:'6px 0 10px',color:'#64748b'}}>El secreto se cifra en el servidor y nunca vuelve a mostrarse.</p>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:8}}>
          <input aria-label="Google OAuth Client ID" value={clientId} onChange={event => setClientId(event.target.value)} placeholder="Client ID" style={{padding:10,border:'1px solid #cbd5e1',borderRadius:8}}/>
          <input aria-label="Google OAuth Client Secret" type="password" value={clientSecret} onChange={event => setClientSecret(event.target.value)} placeholder={status?.configured ? 'Pega un secreto nuevo para reemplazarlo' : 'Client Secret'} autoComplete="off" style={{padding:10,border:'1px solid #cbd5e1',borderRadius:8}}/>
          <button onClick={save} disabled={saving || !clientId || !clientSecret}>{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>

      <div style={{padding:16,border:'1px solid #e2e8f0',borderRadius:12}}>
        <strong>3. Conecta las seis locaciones</strong>
        <p style={{margin:'6px 0 10px',color:'#64748b'}}>Google pedirá iniciar sesión con roberto@puertovallartausa.com una sola vez.</p>
        <button disabled={!status?.configured} onClick={() => window.location.assign('/api/integrations/google-business?action=authorize')}>Conectar Google Business</button>
      </div>
    </div>}
  </section>;
}
