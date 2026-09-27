import { useEffect, useState } from 'react';
import { useI18n } from './i18n';
import { pushRequest } from './webPush';

type Alert = { id: string; title: string; body: string; location: string; at: string; module: string };
type Job = { job: string; status: string; checkedAt?: string; successAt?: string; note?: string };
export default function OperationalAlertInbox() {
  const { t, language } = useI18n();
  const [data, setData] = useState<{ alerts: Alert[]; jobs: Job[] }>();
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    pushRequest({ action: 'inbox' }).then(result => { if (active) setData(result); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [version]);
  const date = (value: string) => new Intl.DateTimeFormat(language === 'es' ? 'es-MX' : 'en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
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
    <p>{t('Automatic checks every 30 minutes. Scheduled pushes: 9 AM–11 PM, Connecticut time. Each warning is limited to once a day; weekly bonus updates follow the Wednesday–Tuesday period.', 'Revisión automática cada 30 minutos. Push programados: 9 AM–11 PM, hora de Connecticut. Cada advertencia se limita a una vez al día; el bono sigue la semana de miércoles a martes.')}</p>
    <p className="push-privacy">{latest ? `${t('Last scheduler check', 'Última revisión del programador')}: ${date(latest)} · Connecticut` : t('Waiting for the first scheduler check.', 'Esperando la primera revisión del programador.')}</p>
    {error && <p role="alert">{t('Could not load alerts. Try refreshing.', 'No se pudieron cargar las alertas. Intenta actualizar.')}</p>}
    {unavailable.length > 0 && <p role="status">{t('Some sources could not be checked. OpsVista will retry; missing data is not treated as a violation.', 'Algunas fuentes no pudieron revisarse. OpsVista reintentará; la falta de datos no se considera un incumplimiento.')}</p>}
    {data && data.alerts.length === 0 && <p>{t('No scheduled alerts for your account yet.', 'Aún no hay alertas programadas para tu cuenta.')}</p>}
    <div className="push-alert-list">{data?.alerts.map(alert => <article key={alert.id} className="push-alert"><strong>{alert.title}</strong><small>{date(alert.at)} · Connecticut</small><p>{alert.body}</p><span>{alert.module}</span></article>)}</div>
    <details><summary>{t('Rules and source status', 'Reglas y estado de fuentes')}</summary>
      <p>{t('Labor >32% with verified salary and hours; voids >0.5%; discounts >2% excluding Uber Eats and employee meals; hourly staff approaching 40 hours or weekly OT >8%; pending tasks after 9 PM; yesterday’s missing logbook; low or unanswered reviews; Ramp documentation overdue 48 hours; verified price increases ≥5%; weekly bonus results. Sales pace requires a configured daily target.', 'Labor >32% con salary y horario verificados; voids >0.5%; descuentos >2% excluyendo Uber Eats y comidas de empleados; personal por hora acercándose a 40 horas u OT semanal >8%; tasks pendientes después de las 9 PM; logbook de ayer faltante; reviews bajas o sin respuesta; documentos de Ramp pendientes por más de 48 horas; aumentos de precio verificados ≥5%; resultados del bono semanal. El ritmo de ventas requiere una meta diaria configurada.')}</p>
      <ul>{jobs.map(job => <li key={job.job}><strong>{jobName(job.job)}</strong>: {job.status === 'ok' ? t('Checked', 'Revisado') : job.status === 'quiet' ? t('Outside notification window', 'Fuera del horario de avisos') : job.status === 'unavailable' ? job.note === 'connection_required' ? t('Connection required', 'Requiere conexión') : t('Source unavailable', 'Fuente no disponible') : job.status === 'retrying' ? t('Retrying push delivery', 'Reintentando envío push') : job.status === 'waiting' ? t('Waiting for complete sources', 'Esperando fuentes completas') : t('Checking', 'Revisando')}{job.checkedAt ? ` · ${date(job.checkedAt)}` : ''}</li>)}</ul>
    </details>
  </div>;
}
