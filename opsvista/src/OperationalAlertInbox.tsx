import { useEffect, useState } from 'react';
import { useI18n } from './i18n';
import { pushRequest } from './webPush';

type Alert = { id: string; title: string; body: string; location: string; at: string; module: string };
type Job = { job: string; status: string; checkedAt?: string; successAt?: string; note?: string };
export default function OperationalAlertInbox() {
  const { t, language } = useI18n();
  const [data, setData] = useState<{ alerts: Alert[]; jobs: Job[]; timeZone: string }>();
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    pushRequest({ action: 'inbox' }).then(result => { if (active) setData(result); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [version]);
  const date = (value: string) => new Intl.DateTimeFormat(language === 'es' ? 'es-MX' : 'en-US', { timeZone: data?.timeZone || 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
  const allJobs = Object.values((data?.jobs || []).reduce<Record<string, Job>>((latest, job) => {
    const key = job.job.replace(/^verify:/, '');
    if (!latest[key] || (job.checkedAt || '') > (latest[key].checkedAt || '')) latest[key] = { ...job, job: key };
    return latest;
  }, {}));
  const globalBonusCheck = allJobs.find(job => job.job === 'bonus')?.checkedAt || '';
  const jobs = allJobs.filter(job => !job.job.startsWith('bonus:') || (job.checkedAt || '') > globalBonusCheck);
  const labels: Record<string, string> = { performance: t('Sales, labor, discounts & voids', 'Ventas, labor, descuentos y voids'), overtime: 'Overtime', tasks: 'Tasks', logbook: 'Logbook', reviews: 'Google Reviews', ramp: 'Ramp', prices: 'Price Watch', bonus: t('Weekly bonus', 'Bono semanal') };
  const jobName = (job: string) => { const [kind, location] = job.split(':'); return `${labels[kind] || kind}${location ? ` · ${location}` : ''}`; };
  const latest = jobs.map(job => job.checkedAt || '').filter(Boolean).sort().at(-1);
  const unavailable = jobs.filter(job => job.status === 'unavailable');
  return <div className="push-inbox">
    <div className="push-heading"><h3>{t('Operational alerts', 'Alertas operativas')}</h3><button type="button" className="push-secondary" onClick={() => setVersion(v => v + 1)}>{t('Refresh', 'Actualizar')}</button></div>
    <p>{t('Automatic checks every 30 minutes. Scheduled pushes: 9 AM–11 PM, in the company time zone. Each warning is limited to once a day; weekly bonus updates follow the Wednesday–Tuesday period.', 'Revisión automática cada 30 minutos. Push programados: 9 AM–11 PM, en la zona horaria de la empresa. Cada advertencia se limita a una vez al día; el bono sigue la semana de miércoles a martes.')}</p>
    <p className="push-privacy">{latest ? `${t('Last scheduler check', 'Última revisión del programador')}: ${date(latest)} · ${data?.timeZone || 'America/New_York'}` : t('Waiting for the first scheduler check.', 'Esperando la primera revisión del programador.')}</p>
    {error && <p role="alert">{t('Could not load alerts. Try refreshing.', 'No se pudieron cargar las alertas. Intenta actualizar.')}</p>}
    {unavailable.length > 0 && <p role="status">{t('Some sources could not be checked. OpsVista will retry; missing data is not treated as a violation.', 'Algunas fuentes no pudieron revisarse. OpsVista reintentará; la falta de datos no se considera un incumplimiento.')}</p>}
    {data && data.alerts.length === 0 && <p>{t('No scheduled alerts for your account yet.', 'Aún no hay alertas programadas para tu cuenta.')}</p>}
    <div className="push-alert-list">{data?.alerts.map(alert => <article key={alert.id} className="push-alert"><strong>{alert.title}</strong><small>{date(alert.at)} · {data?.timeZone || 'America/New_York'}</small><p>{alert.body}</p><span>{alert.module}</span></article>)}</div>
    <details><summary>{t('Rules and source status', 'Reglas y estado de fuentes')}</summary>
      <p>{t('Check Connection status for your company’s active rules, thresholds and source verification times.', 'Consulta Estado de conexiones para ver las reglas activas de tu empresa, sus umbrales y las fechas de comprobación de las fuentes.')}</p>
      <ul>{jobs.map(job => <li key={job.job}><strong>{jobName(job.job)}</strong>: {job.status === 'ok' ? t('Checked', 'Revisado') : job.status === 'quiet' ? t('Outside notification window', 'Fuera del horario de avisos') : job.status === 'unavailable' ? job.note === 'connection_required' ? t('Connection required', 'Requiere conexión') : t('Source unavailable', 'Fuente no disponible') : job.status === 'retrying' ? t('Retrying push delivery', 'Reintentando envío push') : job.status === 'waiting' ? t('Waiting for complete sources', 'Esperando fuentes completas') : t('Checking', 'Revisando')}{job.checkedAt ? ` · ${date(job.checkedAt)}` : ''}</li>)}</ul>
    </details>
  </div>;
}
