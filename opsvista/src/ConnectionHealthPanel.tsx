import { useEffect, useState } from 'react';
import { useI18n } from './i18n';
import { alertJobs, type AlertJob } from '../shared/operationalAlerts';
import { type AlertPolicy, type ConnectionHealth, type HealthState, type Provider } from '../shared/connectionHealth';
import './connectionHealth.css';

const providers: Record<Provider, string> = { toast: 'Toast', '7shifts': '7shifts', google: 'Google Business Profile', ramp: 'Ramp', r365: 'Restaurant365' };
const labels: Record<AlertJob, [string, string]> = { performance: ['Sales & labor', 'Ventas y labor'], overtime: ['Overtime', 'Overtime'], tasks: ['7shifts tasks', 'Tareas de 7shifts'], logbook: ['Logbook', 'Logbook'], reviews: ['Google reviews', 'Reseñas de Google'], ramp: ['Ramp documentation', 'Documentación de Ramp'], prices: ['Price Watch', 'Price Watch'], bonus: ['Weekly bonus', 'Bono semanal'] };
const states: Record<HealthState, [string, string]> = { checked: ['Source checked', 'Fuente comprobada'], stale: ['Check overdue', 'Revisión atrasada'], error: ['Needs attention', 'Necesita atención'], pending: ['Awaiting first check', 'Esperando primera revisión'], paused: ['Rule paused', 'Regla pausada'], connection_required: ['Connect source', 'Conectar fuente'], setup_required: ['Setup required', 'Requiere configuración'] };
async function request(patch?: Partial<AlertPolicy>): Promise<ConnectionHealth> {
  const response = await fetch('/api/workflows?resource=connection_health', { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(25000), ...(patch ? { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) } : {}) });
  const body = await response.json();
  if (!response.ok || !Array.isArray(body.rules)) throw new Error(response.status === 409 ? 'conflict' : 'unavailable');
  return body;
}
export default function ConnectionHealthPanel() {
  const { t, language } = useI18n();
  const [data, setData] = useState<ConnectionHealth>();
  const [draft, setDraft] = useState<AlertPolicy>();
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    request().then(value => { if (active) { setData(value); setDraft(value.policy); } }).catch(() => { if (active) setError('unavailable'); });
    return () => { active = false; };
  }, []);
  async function load(patch?: AlertPolicy) {
    setBusy(true); setError(''); setSaved(false);
    try { const value = await request(patch); setData(value); setDraft(value.policy); setSaved(Boolean(patch)); }
    catch (error) { setError(error instanceof Error ? error.message : 'unavailable'); }
    finally { setBusy(false); }
  }
  const date = (value?: string) => value ? new Intl.DateTimeFormat(language === 'es' ? 'es-MX' : 'en-US', { timeZone: data?.policy.timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : t('Not yet', 'Aún no');
  const rules = data?.rules.filter(rule => !location || rule.location === location) || [];
  const attention = rules.filter(rule => ['stale','error'].includes(rule.state)).length;
  const checked = rules.filter(rule => rule.state === 'checked').length;
  const setup = rules.filter(rule => ['connection_required','setup_required','pending'].includes(rule.state)).length;
  const reason = (value?: string) => value === 'location_mapping' ? t('The restaurant could not be matched uniquely in the source. Review its location name.', 'No se pudo identificar el restaurante de forma única en la fuente. Revisa su nombre de locación.') : value === 'source_permissions' ? t('Review account permissions.', 'Revisa los permisos de la cuenta.') : value === 'source_limit' ? t('The source is limiting requests. The next run will retry.', 'La fuente está limitando las consultas. Se reintentará en la siguiente ejecución.') : value === 'source_timeout' ? t('The source took too long to respond.', 'La fuente tardó demasiado en responder.') : t('Could not verify the source. Missing data does not mean an operational violation.', 'No se pudo comprobar la fuente. La falta de datos no significa un incumplimiento operativo.');
  const zones = [...new Set([draft?.timeZone || 'America/New_York', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Mexico_City'])];
  return <section className="ch-panel" aria-labelledby="ch-title">
    <div className="ch-heading"><div><span className="ch-eyebrow">{data?.organizationName || 'OpsVista'}</span><h2 id="ch-title">{t('Connections & automatic alerts', 'Conexiones y alertas automáticas')}</h2><p>{t('Check the sources behind your alerts and see when each restaurant was last verified.', 'Revisa las fuentes de tus alertas y cuándo se comprobó cada restaurante.')}</p></div><button type="button" disabled={busy} onClick={() => void load()}>{busy ? t('Updating…','Actualizando…') : t('Refresh status','Actualizar estado')}</button></div>
    {error && <p className="ch-error" role="alert">{error === 'conflict' ? t('Settings changed on another device. Refresh before saving again.', 'Los ajustes cambiaron en otro dispositivo. Actualiza antes de guardar otra vez.') : t('Could not load or save the status. Your last saved settings remain active.', 'No se pudo cargar el estado o guardar los ajustes. Siguen activos los últimos ajustes guardados.')}</p>}
    {!data && !error && <p role="status">{t('Loading connection status…','Cargando el estado de conexiones…')}</p>}
    {data && <>
      <div className={`ch-heartbeat ${data.schedulerStale ? 'ch-warning' : ''}`}><strong>{data.schedulerStale ? t('Scheduler check overdue','Revisión del programador pendiente') : t('Scheduler active','Programador activo')}</strong><span>{t('Last contact','Último contacto')}: {date(data.schedulerAt)} · {data.policy.timeZone}</span></div>
      <div className="ch-sources">{data.providers.map(provider => <article key={provider.id}><strong>{providers[provider.id]}</strong><span>{!provider.available ? t('Individual setup required','Requiere configuración individual') : provider.configured ? t('Credentials configured','Credenciales configuradas') : t('Connection required','Requiere conexión')}</span></article>)}</div>
      <p className="ch-note">{t('Configured credentials do not prove that a source is responding. Successful checks appear below. Sources marked “Setup required” need individual activation before generating alerts.', 'Guardar credenciales no confirma que una fuente esté respondiendo. Las comprobaciones exitosas aparecen abajo. Las fuentes que requieren configuración necesitan activación individual antes de generar alertas.')}</p>
      <div className="ch-toolbar"><label>{t('Restaurant','Restaurante')}<select value={location} onChange={event => setLocation(event.target.value)}><option value="">{t('All authorized locations','Todas mis locaciones')}</option>{data.locations.map(location => <option key={location}>{location}</option>)}</select></label><div className="ch-counts"><span><b>{checked}</b> {t('checked','comprobadas')}</span><span><b>{attention}</b> {t('need attention','requieren atención')}</span><span><b>{setup}</b> {t('pending','pendientes')}</span></div></div>
      {!rules.length && <p>{t('No restaurants are assigned to this account yet.','Esta cuenta aún no tiene restaurantes asignados.')}</p>}
      <div className="ch-rules">{rules.map(rule => <article key={`${rule.job}:${rule.location}`} className={`ch-rule ch-${rule.state}`}><div className="ch-rule-title"><strong>{rule.location}</strong><span className="ch-state">{t(...states[rule.state])}</span></div><h3>{t(...labels[rule.job])}</h3><dl><div><dt>{t('Last attempt','Último intento')}</dt><dd>{date(rule.checkedAt)}</dd></div><div><dt>{t('Source verified','Fuente comprobada')}</dt><dd>{date(rule.verifiedAt)}</dd></div></dl>{rule.state === 'error' && <p>{reason(rule.reason)}</p>}{rule.state === 'stale' && <p>{t('The last successful check is older than expected. Review the connection.','La última comprobación exitosa es más antigua de lo esperado. Revisa la conexión.')}</p>}</article>)}</div>
      <p className="ch-note">{t('Checks run approximately every 30 minutes within each rule’s window, from 9 AM to 11 PM in the company time zone. A successful source check does not confirm push receipt on a phone.', 'Las revisiones se ejecutan aproximadamente cada 30 minutos dentro del horario de cada regla, entre las 9 a. m. y las 11 p. m. en la zona horaria de la empresa. Comprobar una fuente no confirma la recepción de un push en el teléfono.')}</p>
      {data.canManage && draft && <details className="ch-settings"><summary>{t('Company alert rules','Reglas de alertas de la empresa')}</summary><p>{t('These settings apply to the company. Each person keeps their own notification preferences.', 'Estos ajustes aplican a la empresa. Cada persona conserva sus propias preferencias de notificaciones.')}</p><form onSubmit={event => { event.preventDefault(); void load(draft); }}><fieldset disabled={busy || Boolean(error)}><legend>{t('Enabled rules','Reglas activas')}</legend><div className="ch-toggles">{alertJobs.map(job => { const unavailable = data.rules.some(rule => rule.job === job && rule.state === 'setup_required'); return <label key={job}><input type="checkbox" checked={draft.enabled[job]} disabled={unavailable} onChange={event => setDraft({...draft,enabled:{...draft.enabled,[job]:event.target.checked}})}/>{t(...labels[job])}{unavailable && <small>{t('Setup required','Requiere configuración')}</small>}</label>; })}</div><div className="ch-inputs"><label>{t('Company time zone','Zona horaria de la empresa')}<select value={draft.timeZone} disabled={data.providers.some(provider => provider.id === 'toast' && provider.available)} onChange={event => setDraft({...draft,timeZone:event.target.value})}>{zones.map(zone => <option key={zone}>{zone}</option>)}</select></label><label>{t('Alert for ratings at or below','Alertar calificaciones de hasta')}<select value={draft.reviewRating} onChange={event => setDraft({...draft,reviewRating:Number(event.target.value)})}>{[1,2,3].map(n => <option key={n} value={n}>{n} ★</option>)}</select></label><label>{t('Unanswered review · hours','Reseña sin respuesta · horas')}<input type="number" required min="1" max="168" step="1" value={draft.reviewHours} onChange={event => setDraft({...draft,reviewHours:Number(event.target.value)})}/></label><label>{t('Price increase · minimum %','Aumento de precio · mínimo %')}<input type="number" required min="5" max="100" step="0.1" value={draft.priceIncreasePct} onChange={event => setDraft({...draft,priceIncreasePct:Number(event.target.value)})}/></label></div><button type="submit" className="ch-save">{busy ? t('Saving…','Guardando…') : t('Save company rules','Guardar reglas de la empresa')}</button></fieldset></form></details>}
      {saved && <p role="status">{t('Company rules saved. They apply to subsequent checks.', 'Reglas guardadas. Se aplicarán en las siguientes revisiones.')}</p>}
    </>}
  </section>;
}
