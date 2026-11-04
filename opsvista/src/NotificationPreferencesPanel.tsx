import { useEffect, useRef, useState } from 'react';
import { notificationCategories, type NotificationCategory, type NotificationPreferences, type PushDeliveryMode } from '../shared/notificationPreferences';
import { useI18n } from './i18n';
import './notificationPreferences.css';

type Preferences = NotificationPreferences & { allowedLocations: string[] };
const labels: Record<NotificationCategory, [string, string, string, string]> = {
  critical: ['Critical alerts', 'Alertas críticas', 'Urgent operational incidents. Delivered immediately while push is on.', 'Incidentes operativos urgentes. Envío inmediato mientras push esté activo.'],
  sales: ['Sales & performance', 'Ventas y desempeño', 'Sales pace, discounts and voids.', 'Ritmo de ventas, descuentos y anulaciones.'],
  labor: ['Labor & overtime', 'Labor y overtime', 'Labor targets, overtime and staffing alerts.', 'Metas de labor, overtime y alertas de cobertura.'],
  tasks: ['Tasks & compliance', 'Tareas y cumplimiento', 'Assignments, overdue tasks, logbooks, Ramp receipts and memos.', 'Asignaciones, tareas vencidas, logbooks, recibos y memos de Ramp.'],
  purchasing: ['Purchasing & Price Watch', 'Compras y Price Watch', 'Price increases and purchasing exceptions.', 'Aumentos de precios e incidencias de compras.'],
  reviews: ['Guest & reviews', 'Clientes y reseñas', 'Low ratings and reviews awaiting a response.', 'Calificaciones bajas y reseñas pendientes de respuesta.'],
  finance: ['Finance', 'Finanzas', 'Invoices, payments and financial follow-up.', 'Facturas, pagos y seguimiento financiero.'],
  reports: ['Reports & summaries', 'Reportes y resúmenes', 'Weekly bonus and performance reports.', 'Bono semanal y reportes de desempeño.'],
  system: ['System & integrations', 'Sistema e integraciones', 'Connection and synchronization alerts.', 'Alertas de conexión y sincronización.'],
  updates: ['OpsVista updates', 'Novedades de OpsVista', 'Product news and announcements. Off by default.', 'Nuevas funciones y anuncios. Desactivadas por defecto.'],
};
async function requestPreferences(patch?: Partial<NotificationPreferences>): Promise<Preferences> {
  const response = await fetch('/api/workflows?resource=notification_preferences', { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(20000),
    ...(patch ? { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) } : {}) });
  const body = await response.json();
  if (!response.ok) throw new Error(response.status === 409 ? 'conflict' : 'unavailable');
  if (!body.categories || !Array.isArray(body.allowedLocations)) throw new Error('unavailable');
  return body;
}
export default function NotificationPreferencesPanel({ onPushEnabled }: { onPushEnabled?: (enabled: boolean) => void }) {
  const { t, language } = useI18n();
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [saving, setSaving] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState('');
  const inFlight = useRef(false);
  async function load() {
    setError(''); setSaved(false);
    try { const result = await requestPreferences(); setPreferences(result); onPushEnabled?.(result.pushEnabled); }
    catch { setError('unavailable'); }
  }
  useEffect(() => { let active = true; requestPreferences().then(result => { if (active) { setPreferences(result); onPushEnabled?.(result.pushEnabled); } }).catch(() => { if (active) setError('unavailable'); }); return () => { active = false; }; }, []);
  async function save(patch: Partial<NotificationPreferences>) {
    if (!preferences || inFlight.current) return;
    inFlight.current = true; setSaving(true); setSaved(false); setError('');
    try {
      const result = await requestPreferences({ ...patch, locale: language, revision: preferences.revision });
      setPreferences(result); onPushEnabled?.(result.pushEnabled); setSaved(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'unavailable'); }
    finally { inFlight.current = false; setSaving(false); }
  }
  const enabledCount = preferences ? notificationCategories.filter(key => preferences.categories[key] !== 'off').length : 0;
  const hasDigest = preferences && notificationCategories.some(key => ['daily', 'weekly'].includes(preferences.categories[key]));
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = [...new Set([preferences?.timeZone || 'America/New_York', deviceZone, 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Mexico_City', 'America/Bahia_Banderas', 'UTC'])];
  return <section className="notification-preferences" aria-labelledby="notification-preferences-title" aria-busy={saving}>
    <header className="np-heading"><div><span className="np-eyebrow">{t('YOUR ACCOUNT · ALL DEVICES', 'TU CUENTA · TODOS TUS DISPOSITIVOS')}</span><h2 id="notification-preferences-title">{t('Notification preferences', 'Preferencias de notificaciones')}</h2><p>{t('Choose the alerts, restaurants and delivery frequency that work for you.', 'Elige qué alertas recibir, de qué restaurantes y con qué frecuencia.')}</p></div>
      {preferences && <span className="np-coverage">{preferences.pushEnabled ? `${enabledCount}/${notificationCategories.length} ${t('categories on', 'categorías activas')}` : t('Operational push paused', 'Push operativo pausado')}</span>}</header>
    {!preferences && !error && <p role="status">{t('Loading preferences…', 'Cargando preferencias…')}</p>}
    {preferences && <>
      <div className="np-master"><div><strong>{t('Push notifications', 'Notificaciones push')}</strong><p>{t('Applies to operational alerts on every device connected to this account.', 'Aplica a las alertas operativas en todos los dispositivos conectados a esta cuenta.')}</p></div><button type="button" role="switch" aria-checked={preferences.pushEnabled} aria-label={t('Push notifications', 'Notificaciones push')} className="np-switch" disabled={saving || Boolean(error)} onClick={() => void save({ pushEnabled: !preferences.pushEnabled })}><span aria-hidden="true"/></button></div>
      <div className="np-security"><span aria-hidden="true">✓</span><div><strong>{t('Account security · Always on', 'Seguridad de la cuenta · Siempre activa')}</strong><p>{t('Sign-in codes on a linked security device are independent of these preferences. Device and browser permissions still apply.', 'Los códigos de acceso en un dispositivo de seguridad vinculado son independientes de estas preferencias. Se mantienen los permisos del dispositivo y del navegador.')}</p></div></div>
      <fieldset disabled={saving || Boolean(error) || !preferences.pushEnabled} className="np-fields"><legend>{t('Alerts & delivery', 'Alertas y frecuencia')}</legend>
        <div className="np-categories">{notificationCategories.map(key => { const [en, es, detailEn, detailEs] = labels[key]; return <div className="np-category" key={key}><div><label htmlFor={`np-${key}`}>{t(en, es)}</label><p>{t(detailEn, detailEs)}</p></div>{key === 'critical' ? <span className="np-required">{t('Instant · Required', 'Inmediato · Obligatorio')}</span> : <select id={`np-${key}`} value={preferences.categories[key]} onChange={event => void save({ categories: { ...preferences.categories, [key]: event.target.value as PushDeliveryMode } })}><option value="instant">{t('Instant', 'Inmediato')}</option><option value="daily">{t('Daily digest', 'Resumen diario')}</option>{key === 'reports' && <option value="weekly">{t('Monday digest', 'Resumen del lunes')}</option>}<option value="off">{t('Off', 'Desactivado')}</option></select>}</div>; })}</div>
      </fieldset>
      <fieldset disabled={saving || Boolean(error) || !preferences.pushEnabled} className="np-fields"><legend>{t('Locations', 'Locaciones')}</legend><p>{t('Only locations you can access appear here. Selections never grant additional access.', 'Aquí solo aparecen las locaciones a las que tienes acceso. La selección no otorga permisos adicionales.')}</p>
        <label className="np-location"><input type="checkbox" checked={preferences.locations === null} onChange={event => void save({ locations: event.target.checked ? null : [] })}/>{t('All my authorized locations', 'Todas mis locaciones autorizadas')}</label>
        <div className="np-locations">{preferences.allowedLocations.map(location => <label key={location} className="np-location"><input type="checkbox" checked={preferences.locations === null || preferences.locations.includes(location)} onChange={event => { const selected = preferences.locations || preferences.allowedLocations; void save({ locations: event.target.checked ? [...selected, location] : selected.filter(value => value !== location) }); }}/>{location}</label>)}</div>
        {!preferences.allowedLocations.length && <p>{t('No restaurant access is assigned to your account yet.', 'Tu cuenta aún no tiene restaurantes asignados.')}</p>}
        {preferences.locations !== null && <p>{t('Combined reports for all restaurants are paused while you select individual locations.', 'Los reportes combinados de todos los restaurantes se pausan cuando seleccionas locaciones individuales.')}</p>}
      </fieldset>
      {hasDigest && <div className="np-digest"><label htmlFor="np-timezone">{t('Digest time zone', 'Zona horaria del resumen')}</label><select id="np-timezone" value={preferences.timeZone} disabled={saving || Boolean(error)} onChange={event => void save({ timeZone: event.target.value })}>{zones.map(zone => <option key={zone}>{zone}</option>)}</select><p>{t('Daily digests become due at 9 AM the following day; weekly report digests on Monday. The scheduler checks about every 30 minutes. Existing queued digests keep their scheduled time; disabled alerts are removed before sending.', 'El resumen diario queda programado a las 9 a. m. del día siguiente; el semanal, el lunes. El programador revisa aproximadamente cada 30 minutos. Los resúmenes ya en espera conservan su hora; las alertas desactivadas se excluyen antes del envío.')}</p></div>}
      <p className="np-source-note">{t('Preferences control alerts generated by your connected modules. A category does not activate a new integration.', 'Las preferencias controlan las alertas generadas por tus módulos conectados. Una categoría no activa una integración nueva.')}</p>
    </>}
    <div className="np-save-state" role={error ? 'alert' : 'status'}>{saving ? t('Saving…', 'Guardando…') : error ? <>{error === 'conflict' ? t('Preferences changed on another device. Reload before making more changes.', 'Las preferencias cambiaron en otro dispositivo. Recarga antes de hacer más cambios.') : t('Could not save or load preferences. Your last saved settings remain active.', 'No se pudieron guardar o cargar las preferencias. Tus últimos ajustes guardados siguen activos.')} <button type="button" onClick={() => void load()}>{t('Reload', 'Recargar')}</button></> : saved ? t('Saved · applies to all your devices', 'Guardado · aplica a todos tus dispositivos') : t('Changes save automatically.', 'Los cambios se guardan automáticamente.')}</div>
  </section>;
}
