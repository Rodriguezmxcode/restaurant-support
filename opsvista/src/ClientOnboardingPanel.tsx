import { useEffect, useState, type FormEvent } from 'react';
import type { OpsVistaUser } from './accessControl';
import './clientWorkspace.css';

export default function ClientOnboardingPanel({ currentUser, founder = false }: { currentUser: OpsVistaUser; founder?: boolean }) {
  const resource = founder ? 'organizations' : 'tenant_team';
  const [rows, setRows] = useState<{ id: string; name: string; email?: string; locations: string[] }[]>([]);
  const [draft, setDraft] = useState({ requestId: crypto.randomUUID(), name: '', adminName: '', email: '', subscriptionId: '', locations: '', paidLocations: '1', role: 'Location Manager', paymentReviewed: false });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [invite, setInvite] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/workflows?resource=${resource}`, { credentials: 'include', cache: 'no-store' }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No se pudo consultar la lista.');
      if (!cancelled) setRows(founder ? body.organizations : body.users);
    }).catch(reason => { if (!cancelled) setError(String(reason.message)); });
    return () => { cancelled = true; };
  }, [resource, reload, founder]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setInvite('');
    try {
      const response = await fetch(`/api/workflows?resource=${resource}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, paidLocations: Number(draft.paidLocations), locations: draft.locations.split('\n').map(v => v.trim()).filter(Boolean) }) });
      const body = await response.json();
      if (!response.ok || !body.inviteUrl) throw new Error(body.error || 'No se pudo crear la cuenta.');
      setInvite(body.inviteUrl); setReload(v => v + 1);
      setDraft({ requestId: crypto.randomUUID(), name: '', adminName: '', email: '', subscriptionId: '', locations: '', paidLocations: '1', role: 'Location Manager', paymentReviewed: false });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo crear la cuenta.'); }
    finally { setBusy(false); }
  }
  return <section className="panel client-onboarding">
    <h2>{founder ? 'Activar un nuevo cliente' : 'Tu equipo'}</h2>
    <p>{founder ? 'Revisa el pago y la cantidad de locaciones en Stripe. Después crea el espacio del cliente y su invitación. La activación es asistida.' : 'Agrega responsables a las locaciones de tu negocio y comparte su invitación de acceso.'}</p>
    {founder && <a href="https://dashboard.stripe.com/subscriptions" target="_blank" rel="noreferrer">Revisar suscripciones en Stripe ↗</a>}
    {error && <p role="alert" className="nt-error">{error}</p>}
    {invite && <div className="nt-notice" role="status"><strong>Cuenta creada. Comparte esta invitación con el titular.</strong><p>Válida por 48 horas. El correo no se envía automáticamente.</p><input aria-label="Invitación de acceso" readOnly value={invite} onFocus={event => event.target.select()}/></div>}
    <form onSubmit={submit} className="client-form">
      <label>{founder ? 'Nombre del negocio' : 'Nombre de la persona'}<input required maxLength={160} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></label>
      {founder && <label>Nombre del administrador<input required maxLength={160} value={draft.adminName} onChange={e => setDraft({ ...draft, adminName: e.target.value })}/></label>}
      <label>Correo de acceso<input required type="email" maxLength={254} value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })}/></label>
      {!founder && <label>Puesto<select value={draft.role} onChange={e => setDraft({ ...draft, role: e.target.value })}>{['Corporate', 'Location Manager', 'Kitchen', 'Maintenance'].map(role => <option key={role}>{role}</option>)}</select></label>}
      <label>Locaciones — una por renglón<textarea required rows={4} value={draft.locations} onChange={e => setDraft({ ...draft, locations: e.target.value })}/></label>
      {!founder && <p>Locaciones disponibles: {currentUser.organizationLocations?.join(', ')}</p>}
      {founder && <><label>Suscripción pagada en Stripe<input required pattern="sub_[a-zA-Z0-9]+" placeholder="sub_…" value={draft.subscriptionId} onChange={e => setDraft({ ...draft, subscriptionId: e.target.value })}/></label>
        <label>Locaciones contratadas<input required type="number" min={1} max={10000} step={1} value={draft.paidLocations} onChange={e => setDraft({ ...draft, paidLocations: e.target.value })}/></label>
        <label className="client-checkbox"><input required type="checkbox" checked={draft.paymentReviewed} onChange={e => setDraft({ ...draft, paymentReviewed: e.target.checked })}/>Revisé en Stripe el pago recibido, la suscripción y el número de locaciones de este cliente.</label></>}
      <button className="nt-primary" disabled={busy}>{busy ? 'Creando…' : founder ? 'Crear espacio e invitación' : 'Crear acceso e invitación'}</button>
    </form>
    <h3>{founder ? 'Clientes registrados' : 'Personas de tu negocio'}</h3>
    <ul className="client-rows">{rows.map(row => <li key={row.id}><strong>{row.name}</strong><span>{row.email || `${row.locations.length || '—'} locaciones`}</span></li>)}</ul>
  </section>;
}
