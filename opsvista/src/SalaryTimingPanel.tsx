import type { SalaryTiming } from '../shared/salaryTiming';
import './salaryTiming.css';

const money = (value: number | null) => value === null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const pct = (value: number | null) => value === null ? '—' : `${value.toFixed(2)}%`;

export default function SalaryTimingPanel({ data, language = 'es', onRefresh }: { data?: SalaryTiming | null; language?: string; onRefresh?: () => void }) {
  if (!data) return null;
  const t = (en: string, es: string) => language === 'en' ? en : es;
  return <section className="salary-timing" aria-label={t('Labor through the current snapshot', 'Labor al momento de la consulta')}>
    <header><div><span>{t('TODAY’S LABOR', 'LABOR DEL DÍA')}</span><h3>{t('Accrued labor and full-day salary', 'Labor acumulado y salario completo del día')}</h3></div><time dateTime={data.asOf}>{new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'es-MX', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(data.asOf))} ET · {data.date}</time></header>
    <p>{t('Hourly labor reported by Toast + fixed salary allocated by elapsed opening hours. Today refreshes automatically while visible; source records may lag.', 'Labor por hora reportado por Toast + salario fijo repartido según las horas abiertas transcurridas. Hoy se actualiza automáticamente mientras la pantalla está visible; la fuente puede tener retraso.')}</p>
    {onRefresh && <button type="button" className="salary-timing-refresh" onClick={onRefresh}>{t('Refresh labor and sales', 'Actualizar labor y ventas')} ↻</button>}
    {!data.applied && <p className="salary-timing-warning">{t('Hours or salary configuration need review. The dashboard still shows full-day salary for all selected locations.', 'Falta revisar horarios o salarios. El dashboard aún muestra el salario completo del día para todas las locaciones seleccionadas.')}</p>}
    {data.hoursError && <p className="salary-timing-warning">{t('Live Google hours unavailable. Using the dated Google Maps reference where available; special hours could not be checked.', 'No se pudo actualizar el horario de Google. Se usa la referencia fechada de Google Maps donde esté disponible; los horarios especiales no pudieron verificarse.')}</p>}
    <div className="salary-timing-locations">{data.rows.map(row => <article key={row.location}>
      <div className="salary-timing-location"><strong>{row.location}</strong><span>{row.open ? `${row.open}–${row.close} · ${row.timeZone}` : row.status === 'closed' ? t('Closed day · fixed salary remains due', 'Día cerrado · el salario fijo sigue a cargo') : row.status === 'missing_salary' ? t('Salary pending configuration', 'Salario pendiente de configuración') : t('Opening hours pending', 'Horario de operación pendiente')}</span></div>
      <div className="salary-timing-values">
        <div><span>{t('Hourly reported', 'Hourly reportado')}</span><strong>{money(row.hourlyLabor)}</strong><small>{pct(row.hourlyPct)} {t('of sales', 'de ventas')}</small></div>
        <div><span>{t('Salary accrued', 'Salario acumulado')}</span><strong>{money(row.accruedSalary)}</strong><small>{pct(row.salaryPct)} {t('of sales', 'de ventas')}</small></div>
        <div className="salary-timing-total"><span>{t('Accrued total', 'Total acumulado')}</span><strong>{money(row.totalAccruedLabor)}</strong><small>{pct(row.totalPct)} {t('of sales', 'de ventas')}</small></div>
        <div><span>{t('Full-day salary', 'Salario completo del día')}</span><strong>{row.status === 'missing_salary' ? '—' : money(row.fullDaySalary)}</strong><small>{pct(row.fullDaySalaryPct)} {t('of sales so far', 'de ventas hasta ahora')}</small></div>
      </div>
      {row.allocatedPct !== null && <div className="salary-timing-progress"><progress value={row.allocatedPct} max={100} aria-label={t(`Salary allocated for ${row.location}`, `Salario distribuido de ${row.location}`)}/><span>{row.allocatedPct.toFixed(1)}% {t('of daily salary allocated', 'del salario diario distribuido')} · {row.elapsedHours?.toFixed(2)}/{row.operatingHours?.toFixed(2)} h · {money(row.hourlyAllocation)}/h · {t('Remaining', 'Pendiente')}: {money(row.remainingSalary)}</span></div>}
      {row.hoursSource && <p className="salary-timing-footnote">{row.hoursSourceUrl ? <a href={row.hoursSourceUrl} target="_blank" rel="noreferrer">{row.hoursSource}</a> : row.hoursSource} · {row.hoursVerifiedAt?.slice(0, 10)}</p>}
    </article>)}</div>
    <p className="salary-timing-footnote">{t('All cost percentages use net sales in this snapshot. Full-day salary / sales so far is a reference, not a closing forecast. With no positive sales, percentages are unavailable. Fixed payroll does not change; hourly work before opening and after closing stays included in Toast’s reported labor.', 'Todos los porcentajes de costo usan las ventas netas de esta consulta. Salario completo / ventas hasta ahora es una referencia, no una proyección al cierre. Sin ventas positivas, los porcentajes no están disponibles. La nómina fija no cambia; el trabajo hourly antes de abrir y después de cerrar sigue incluido en lo reportado por Toast.')}</p>
  </section>;
}
