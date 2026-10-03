import { useState } from 'react';
import { useI18n } from './i18n';
import type { LiveRow, SevenShiftsResponse } from './OperationalOverview';
import type { OverviewMetric } from './OverviewExplorer';
import { findOverviewTaskCompliance } from './overviewTaskCompliance';
import './overviewCharts.css';

type Totals = Omit<LiveRow, 'location'>;
type Props = {
  rows: LiveRow[];
  totals: Totals;
  tasks: SevenShiftsResponse | null;
  salaryConfigured: boolean;
  onExplore: (metric: OverviewMetric, location?: string) => void;
};
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number) => Math.min(100, Math.max(0, value));
const pct = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}%`;

// Every ring starts from zero. Missing data stays empty, never a successful zero.
function Ring({ value, tone = 'blue', size = 94 }: { value: number | null; tone?: string; size?: number }) {
  return <svg className={`ov-ring ov-tone-${tone}`} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
    <circle className="ov-ring-track" cx="50" cy="50" r="40" fill="none" strokeWidth="9" />
    {value !== null && <circle className="ov-ring-value" cx="50" cy="50" r="40" fill="none" strokeWidth="9" pathLength="100" strokeDasharray={`${clamp(value)} 100`} transform="rotate(-90 50 50)" />}
  </svg>;
}

function Gauge({ value, limit, label }: { value: number | null; limit: number; label: string }) {
  const max = Math.max(limit * 1.6, value === null ? 0 : Math.ceil(value / 10) * 10);
  const angle = Math.PI * (1 - limit / max);
  const marker = { x: 90 + 68 * Math.cos(angle), y: 83 - 68 * Math.sin(angle) };
  return <div className="ov-gauge" role="img" aria-label={`${label}: ${pct(value)}`}>
    <svg viewBox="0 0 180 105" aria-hidden="true">
      <path className="ov-ring-track" d="M 22 83 A 68 68 0 0 1 158 83" fill="none" strokeWidth="13" />
      {value !== null && <path className={`ov-ring-value ov-tone-${value > limit ? 'coral' : 'blue'}`} d="M 22 83 A 68 68 0 0 1 158 83" fill="none" strokeWidth="13" pathLength="100" strokeDasharray={`${clamp(value / max * 100)} 100`} />}
      <circle cx={marker.x} cy={marker.y} r="4" fill="#152d4c" stroke="white" strokeWidth="2" />
      <text x="90" y="76" textAnchor="middle" className="ov-gauge-number">{pct(value)}</text>
      <text x="19" y="103" className="ov-gauge-scale">0</text><text x="161" y="103" textAnchor="end" className="ov-gauge-scale">{max}%</text>
    </svg>
  </div>;
}

export default function OverviewCharts({ rows, totals, tasks, salaryConfigured, onExplore }: Props) {
  const { t } = useI18n();
  const [salesView, setSalesView] = useState<'sales' | 'productivity'>('sales');
  const salesValue = (row: LiveRow) => salesView === 'sales' ? row.netSales : row.splh;
  const salesRows = [...rows].sort((a, b) => (salesValue(b) ?? -Infinity) - (salesValue(a) ?? -Infinity));
  const salesMax = Math.max(1, ...salesRows.map(row => Math.abs(salesValue(row) ?? 0)));
  const salesFormat = salesView === 'sales' ? usd : dollars;
  const laborRate = (row: LiveRow | Totals) => row.netSales > 0 && finite(row.totalLaborPct) ? row.totalLaborPct : null;
  const laborRows = [...rows].sort((a, b) => (laborRate(b) ?? -Infinity) - (laborRate(a) ?? -Infinity));
  const laborMax = Math.max(45, Math.ceil(Math.max(0, ...rows.map(row => laborRate(row) ?? 0)) / 10) * 10);
  const totalRate = laborRate(totals);
  const taskRate = tasks && tasks.totals.total > 0 && finite(tasks.totals.compliancePct) ? tasks.totals.compliancePct : null;
  const hourly = totals.hourlyLaborCost;
  const salary = totals.salaryLaborCost;
  const mixTotal = hourly + salary;
  const hasMix = finite(hourly) && finite(salary) && hourly >= 0 && salary >= 0 && mixTotal > 0 && salaryConfigured;
  const hourlyShare = hasMix ? hourly / mixTotal * 100 : null;
  const issues = rows.flatMap(row => {
    const result: { location: string; metric: OverviewMetric; label: string }[] = [];
    if (salaryConfigured && (laborRate(row) ?? 0) > 30) result.push({ location: row.location, metric: 'labor', label: `Labor ${pct(laborRate(row))}` });
    const task = findOverviewTaskCompliance(tasks, row.location);
    if (task && task.total > 0 && finite(task.compliancePct) && task.compliancePct < 80) result.push({ location: row.location, metric: 'tasks', label: `Tasks ${pct(task.compliancePct)}` });
    if (row.netSales > 0 && finite(row.voidPct) && row.voidPct > .5) result.push({ location: row.location, metric: 'voids', label: `Voids ${row.voidPct.toFixed(2)}%` });
    if (row.netSales > 0 && finite(row.discountPct) && row.discountPct > 2) result.push({ location: row.location, metric: 'discounts', label: `${t('Discounts', 'Descuentos')} ${row.discountPct.toFixed(2)}%` });
    return result;
  });

  return <div className="ov-visual-board">
    <div className="ov-board-heading"><div><span className="ov-section-label">{t('THE OPERATION AT A GLANCE', 'LA OPERACIÓN DE UN VISTAZO')}</span><h2>{t('Compare. Detect. Act.', 'Compara. Detecta. Actúa.')}</h2></div><span>{t('Select a chart to explore its data', 'Selecciona una gráfica para explorar sus datos')}</span></div>
    {!rows.length ? <div className="ov-chart-empty">{t('No location data for this period.', 'Sin datos por locación para este periodo.')}</div> : <>
      <div className="ov-chart-main-grid">
        <section className="ov-chart-card ov-sales-card" aria-label={t('Sales by location', 'Ventas por locación')}>
          <header className="ov-chart-heading"><div><span className="ov-section-label">{t('REVENUE', 'INGRESOS')}</span><h3>{salesView === 'sales' ? t('Sales by location', 'Ventas por locación') : t('Sales per labor hour', 'Ventas por hora trabajada')}</h3></div><span className="ov-chart-count">{rows.length} {t('locations', 'locaciones')}</span></header>
          <div className="ov-chart-tabs" aria-label={t('Sales chart metric', 'Métrica de la gráfica de ventas')}>
            <button type="button" aria-pressed={salesView === 'sales'} onClick={() => setSalesView('sales')}>{t('Net sales', 'Ventas netas')}</button>
            <button type="button" aria-pressed={salesView === 'productivity'} onClick={() => setSalesView('productivity')}>{t('Sales / labor hour', 'Ventas / hora trabajada')}</button>
          </div>
          <div className="ov-sales-bars">
            {salesRows.map((row, index) => {
              const raw = salesValue(row); const value = finite(raw) ? raw : null;
              return <button type="button" className="ov-sales-row" key={row.location} onClick={() => onExplore(salesView === 'sales' ? 'sales' : 'hourly', row.location)} aria-label={`${row.location}: ${value === null ? t('No data', 'Sin datos') : salesFormat.format(value)}. ${t('View breakdown', 'Ver desglose')}`}>
                <span className="ov-sales-name"><small>{String(index + 1).padStart(2, '0')}</small>{row.location}</span><strong>{value === null ? '—' : salesFormat.format(value)}</strong>
                <span className="ov-sales-track" aria-hidden="true"><span style={{ width: `${Math.abs(value ?? 0) / salesMax * 100}%` }} data-negative={value !== null && value < 0}/></span>
                <span className="ov-sales-share">{salesView === 'sales' && totals.netSales > 0 && value !== null ? `${(value / totals.netSales * 100).toFixed(1)}% ${t('of total', 'del total')}` : salesView === 'productivity' ? `${row.hourlyHours.toFixed(1)} h` : '—'}</span>
              </button>;
            })}
          </div>
          <footer className="ov-chart-footnote">{salesView === 'sales' ? t('Net sales for the selected period. Bar length represents volume, not performance against a target.', 'Ventas netas del periodo. El tamaño de la barra representa volumen, no cumplimiento de una meta.') : t('Net sales ÷ hourly hours reported by Toast. Unavailable when no hours are reported.', 'Ventas netas ÷ horas de labor reportadas por Toast. Sin horas registradas, no se calcula.')}</footer>
        </section>

        <section className="ov-chart-card ov-labor-card" aria-label={t('Labor compared with reference', 'Labor frente a referencia')}>
          <header className="ov-chart-heading"><div><span className="ov-section-label">{t('LABOR EFFICIENCY', 'EFICIENCIA LABORAL')}</span><h3>{t('Labor vs. sales', 'Labor frente a ventas')}</h3></div><button className="ov-text-button" type="button" onClick={() => onExplore('labor')}>{t('Details', 'Detalle')} ↗</button></header>
          <div className="ov-labor-summary"><Gauge value={totalRate} limit={30} label={t('Total labor', 'Labor total')} /><div><strong>{t('Combined labor', 'Labor consolidado')}</strong><span>{t('Hourly + salary', 'Por hora + salarios')}</span><small className={`ov-status ${!salaryConfigured || totalRate === null ? 'neutral' : totalRate > 30 ? 'review' : ''}`}>{!salaryConfigured ? t('Partial · salary pending', 'Parcial · salarios pendientes') : totalRate === null ? t('No positive sales', 'Sin ventas positivas') : totalRate > 30 ? t('Above 30% reference', 'Sobre la referencia de 30%') : t('At or below 30%', 'Dentro de la referencia de 30%')}</small></div></div>
          <div className="ov-labor-bars">
            {laborRows.map(row => { const value = laborRate(row); const review = salaryConfigured && value !== null && value > 30; return <button type="button" className="ov-labor-row" key={row.location} onClick={() => onExplore('labor', row.location)} aria-label={`${row.location}: ${pct(value)}${review ? t(' · Review', ' · Revisar') : ''}`}>
              <span>{row.location}</span><strong data-review={review}>{pct(value)}{review && <small> !</small>}</strong>
              <span className="ov-labor-track" aria-hidden="true"><span className={`ov-fill-${review ? 'coral' : 'blue'}`} style={{ width: `${clamp((value ?? 0) / laborMax * 100)}%` }} /><i style={{ left: `${30 / laborMax * 100}%` }}/></span>
            </button>; })}
          </div>
          <div className="ov-chart-scale"><span>0%</span><span>{t('Dashed line: 30%', 'Línea punteada: 30%')}</span><span>{laborMax}%</span></div>
          <footer className="ov-chart-footnote">{t('Overview reference: 30%. Location targets are in Schedules. Intraday values change as sales and labor accumulate.', 'Referencia del resumen: 30%. Las metas por locación están en Horarios. Los valores del día cambian al acumular ventas y labor.')}</footer>
        </section>
      </div>

      <div className="ov-chart-secondary-grid">
        <section className="ov-chart-card ov-tasks-card" aria-label={t('Task completion by location', 'Cumplimiento de Tasks por locación')}>
          <header className="ov-chart-heading"><div><span className="ov-section-label">{t('EXECUTION', 'EJECUCIÓN')}</span><h3>{t('Tasks by location', 'Tasks por locación')}</h3></div><span className="ov-chart-count">{t('Goal', 'Meta')} ≥80%</span></header>
          <div className="ov-task-total"><strong>{pct(taskRate)}</strong><span>{tasks ? `${tasks.totals.completed} / ${tasks.totals.total} ${t('completed', 'completadas')}` : t('7shifts data unavailable', 'Datos de 7shifts no disponibles')}</span></div>
          <div className="ov-task-rings">{rows.map(row => {
            const task = findOverviewTaskCompliance(tasks, row.location);
            const rate = task && task.total > 0 && finite(task.compliancePct) ? task.compliancePct : null;
            return <button type="button" key={row.location} onClick={() => onExplore('tasks', row.location)} disabled={!task} className="ov-task-location" aria-label={`${row.location}: ${!task ? t('No task data for this location', 'Sin datos de Tasks para esta locación') : rate === null ? t('No tasks recorded', 'Sin tareas registradas') : pct(rate)}. ${t('View tasks', 'Ver tareas')}`}>
              <span className="ov-ring-wrap"><Ring value={rate} tone={rate === null ? 'neutral' : rate < 80 ? 'coral' : 'teal'} /><strong>{rate === null ? '—' : `${rate.toFixed(0)}%`}</strong></span><span>{row.location}</span><small>{task && task.total > 0 ? `${task.completed}/${task.total}` : task ? t('No tasks', 'Sin tareas') : t('No data', 'Sin datos')}{rate !== null && rate < 80 ? ` · ${t('Review', 'Revisar')}` : ''}</small>
            </button>;
          })}</div>
          <footer className="ov-chart-footnote">{t('Tasks still open may be included in the incomplete count.', 'Las tareas por completar pueden incluir tareas todavía abiertas.')}</footer>
        </section>

        <section className="ov-chart-card ov-mix-card" aria-label={t('Labor cost composition', 'Composición del costo laboral')}>
          <header className="ov-chart-heading"><div><span className="ov-section-label">{t('COST COMPOSITION', 'COMPOSICIÓN DEL COSTO')}</span><h3>{t('Where labor goes', 'Cómo se compone el labor')}</h3></div></header>
          <div className="ov-mix-ring"><Ring value={hourlyShare} size={164} tone="blue" /><div><strong>{finite(totals.totalLaborCost) ? usd.format(totals.totalLaborCost) : '—'}</strong><span>{t('Total labor', 'Labor total')}</span></div></div>
          <div className="ov-mix-legend">
            <button type="button" onClick={() => onExplore('hourly')}><i className="ov-fill-blue"/><span>{t('Hourly', 'Por hora')}<small>{hourlyShare === null ? '—' : `${hourlyShare.toFixed(1)}%`}</small></span><strong>{finite(hourly) ? dollars.format(hourly) : '—'}</strong></button>
            <button type="button" onClick={() => onExplore('salary')}><i className="ov-fill-purple"/><span>{t('Salary', 'Salarios')}<small>{hourlyShare === null ? '—' : `${(100 - hourlyShare).toFixed(1)}%`}</small></span><strong>{salaryConfigured && finite(salary) ? dollars.format(salary) : t('Pending', 'Pendiente')}</strong></button>
          </div>
          <footer className="ov-chart-footnote">{hasMix ? t('Share of labor cost, not of sales.', 'Participación del costo laboral, no de las ventas.') : t('Composition unavailable until positive costs and salary configuration are present.', 'Composición no disponible sin costos positivos y salarios configurados.')}</footer>
        </section>

        <section className="ov-chart-card ov-controls-card" aria-label={t('Voids and discounts controls', 'Control de voids y descuentos')}>
          <header className="ov-chart-heading"><div><span className="ov-section-label">{t('SALES CONTROLS', 'CONTROL DE VENTAS')}</span><h3>{t('Voids & discounts', 'Voids y descuentos')}</h3></div></header>
          {([{ metric: 'voids' as const, label: 'Voids', rate: totals.voidPct, amount: totals.voidAmount, limit: .5 }, { metric: 'discounts' as const, label: t('Discounts', 'Descuentos'), rate: totals.discountPct, amount: totals.discountAmount, limit: 2 }]).map(item => {
            const value = totals.netSales > 0 && finite(item.rate) ? item.rate : null;
            const scale = Math.max(item.limit * 2, value ?? 0);
            return <button type="button" className="ov-control-metric" key={item.metric} onClick={() => onExplore(item.metric)}><span><strong>{item.label}</strong><small>{finite(item.amount) ? dollars.format(item.amount) : '—'}</small></span><div><b>{value === null ? '—' : `${value.toFixed(2)}%`}</b><small className={`ov-status ${value === null ? 'neutral' : value > item.limit ? 'review' : ''}`}>{value === null ? t('No positive sales', 'Sin ventas positivas') : value > item.limit ? t('Review', 'Revisar') : t('Within reference', 'Dentro de referencia')}</small></div><span className="ov-control-track" aria-hidden="true"><span className={`ov-fill-${value !== null && value > item.limit ? 'coral' : 'teal'}`} style={{ width: `${clamp((value ?? 0) / scale * 100)}%` }} /><i style={{ left: `${item.limit / scale * 100}%` }}/></span><span className="ov-control-caption">{t('Reference', 'Referencia')} ≤{item.limit.toFixed(2)}%</span></button>;
          })}
          <footer className="ov-chart-footnote">{t('All Toast discounts included. Weekly Bonus uses its own exclusions.', 'Incluye todos los descuentos de Toast. Bono semanal aplica sus propias exclusiones.')}</footer>
        </section>
      </div>

      {issues.length > 0 && <section className="ov-review-strip" aria-label={t('Metrics to review', 'Métricas para revisar')}><div><strong>{t('Focus your review', 'Enfoca tu revisión')}</strong><span>{issues.length} {t('indicators outside the overview references', 'indicadores fuera de las referencias del resumen')}</span></div><div className="ov-review-items">{issues.map(issue => <button type="button" key={`${issue.location}-${issue.metric}`} onClick={() => onExplore(issue.metric, issue.location)}><strong>{issue.location}</strong><span>{issue.label} ↗</span></button>)}</div></section>}
    </>}
  </div>;
}
