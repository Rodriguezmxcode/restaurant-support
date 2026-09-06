import { useState } from 'react';
import type { LiveRow, SevenShiftsResponse } from './OperationalOverview';
import type { OpsVistaModule } from './accessControl';
import './overviewExplorer.css';

export type OverviewMetric = 'sales' | 'hourly' | 'salary' | 'labor' | 'tasks' | 'voids' | 'discounts';
type MetricRow = { location: string; value: number | null; detail: string; attention: boolean };
type MetricDefinition = { label: string; note: string; percent?: boolean; rule?: string };
export const overviewMetrics: Record<OverviewMetric, MetricDefinition> = {
  sales: { label: 'Ventas netas', note: 'Ventas del periodo por locación. El tamaño de la venta por sí solo no indica un problema operativo.' },
  hourly: { label: 'Labor por hora', note: 'Costo por hora reportado por Toast; revisa Horarios para el detalle de empleados y overtime.' },
  salary: { label: 'Labor de salario', note: 'Asignación de salarios para el periodo seleccionado.' },
  labor: { label: 'Labor total', note: 'Costo por hora + asignación de salarios. El porcentaje usa las ventas netas de cada locación.', rule: 'Revisión del resumen: labor total >30%. Horarios contiene las metas por locación.' },
  tasks: { label: 'Cumplimiento de Tasks', percent: true, note: 'Tasks completadas / Tasks registradas por 7shifts para el periodo. Las que faltan por completar pueden incluir tareas todavía abiertas.', rule: 'Revisión: cumplimiento <80%. Sin tareas registradas no equivale a 0%.' },
  voids: { label: 'Voids', note: 'Monto de voids y porcentaje sobre ventas netas, según Toast.', rule: 'Revisión: voids >0.50%.' },
  discounts: { label: 'Descuentos', note: 'Incluye todos los descuentos de Toast. El Bono semanal aplica su propia exclusión de promociones de Uber Eats.', rule: 'Revisión general: descuentos >2.00%; no determina la calificación del bono.' },
};
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (value: number) => `${value.toFixed(2)}%`;
const valid = (value: number | undefined | null): value is number => typeof value === 'number' && Number.isFinite(value);

export function overviewMetricRows(metric: OverviewMetric, rows: LiveRow[], tasks: SevenShiftsResponse | null, salaryConfigured: boolean): MetricRow[] {
  return rows.map(row => {
    const share = (value: number) => row.netSales > 0 && valid(value) ? `${percent(value)} de ventas` : 'Porcentaje no disponible sin ventas positivas';
    if (metric === 'tasks') {
      const task = tasks?.locations.find(item => item.location === row.location);
      const usable = task && task.total > 0 && valid(task.compliancePct);
      return { location: row.location, value: usable ? task.compliancePct : null, attention: Boolean(usable && task.compliancePct < 80), detail: task ? `${task.completed} de ${task.total} completadas · ${Math.max(0, task.total - task.completed)} por completar` : 'Sin datos de 7shifts para esta locación' };
    }
    const value = metric === 'sales' ? row.netSales : metric === 'hourly' ? row.hourlyLaborCost : metric === 'salary' ? row.salaryLaborCost : metric === 'labor' ? row.totalLaborCost : metric === 'voids' ? row.voidAmount : row.discountAmount;
    const rate = metric === 'hourly' ? row.hourlyLaborPct : metric === 'salary' ? row.salaryLaborPct : metric === 'labor' ? row.totalLaborPct : metric === 'voids' ? row.voidPct : row.discountPct;
    const threshold = metric === 'labor' ? 30 : metric === 'voids' ? .5 : metric === 'discounts' ? 2 : null;
    const detail = metric === 'sales' ? `Labor total: ${money.format(row.totalLaborCost)} · ${share(row.totalLaborPct)}` : metric === 'salary' && !salaryConfigured ? 'Asignación de salarios pendiente de configuración' : `${share(rate)}${metric === 'hourly' ? ` · ${row.hourlyHours.toFixed(1)} h trabajadas` : ''}${metric === 'labor' && !salaryConfigured ? ' · Salarios pendientes: costo parcial' : ''}`;
    return { location: row.location, value: valid(value) && !(metric === 'salary' && !salaryConfigured) ? value : null, detail, attention: Boolean(threshold !== null && row.netSales > 0 && valid(rate) && rate > threshold) };
  });
}

type Props = {
  metric: OverviewMetric;
  rows: LiveRow[];
  tasks: SevenShiftsResponse | null;
  salaryConfigured: boolean;
  start: string;
  end: string;
  focusLocation: string;
  onFocusLocation: (location: string) => void;
  onClose: () => void;
  modules?: OpsVistaModule[];
  onOpenModule?: (module: OpsVistaModule) => void;
};

export default function OverviewExplorer({ metric, rows, tasks, salaryConfigured, start, end, focusLocation, onFocusLocation, onClose, modules = [], onOpenModule }: Props) {
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [sort, setSort] = useState<'desc' | 'asc' | 'name'>(metric === 'tasks' ? 'asc' : 'desc');
  const definition = overviewMetrics[metric];
  const allRows = overviewMetricRows(metric, rows, tasks, salaryConfigured);
  const attentionCount = allRows.filter(row => row.attention).length;
  const visible = allRows.filter(row => (!onlyAttention || row.attention) && (!focusLocation || row.location === focusLocation)).sort((a, b) => {
    if (sort === 'name') return a.location.localeCompare(b.location);
    if (a.value === null) return b.value === null ? a.location.localeCompare(b.location) : 1;
    if (b.value === null) return -1;
    return (sort === 'desc' ? b.value - a.value : a.value - b.value) || a.location.localeCompare(b.location);
  });
  const scale = Math.max(1, ...allRows.map(row => Math.abs(row.value ?? 0)));
  const format = (value: number | null) => value === null ? 'Sin datos' : definition.percent ? percent(value) : money.format(value);
  const module: OpsVistaModule = metric === 'tasks' ? 'Tasks' : ['hourly', 'salary', 'labor'].includes(metric) ? 'Horarios' : 'Action Center';
  const reset = () => { setOnlyAttention(false); onFocusLocation(''); setSort(metric === 'tasks' ? 'asc' : 'desc'); };

  return <section className="overview-explorer" aria-labelledby="overview-explorer-title">
    <header className="overview-explorer-heading">
      <div><span className="overview-eyebrow">DESGLOSE INTERACTIVO</span><h3 id="overview-explorer-title">{definition.label}</h3><p>{start} → {end} · {focusLocation || `${rows.length} locaciones del filtro principal`}</p></div>
      <button type="button" onClick={onClose} aria-label="Cerrar desglose">Cerrar ×</button>
    </header>
    <p className="overview-explorer-note">{definition.note}</p>
    {definition.rule && <p className="overview-explorer-rule">{definition.rule}</p>}
    <div className="overview-explorer-controls">
      <label>Locación del desglose<select value={focusLocation} onChange={event => onFocusLocation(event.target.value)}><option value="">Todas las seleccionadas</option>{allRows.map(row => <option key={row.location}>{row.location}</option>)}</select></label>
      <label>Ordenar<select value={sort} onChange={event => setSort(event.target.value as typeof sort)}><option value="desc">Mayor a menor</option><option value="asc">Menor a mayor</option><option value="name">Nombre</option></select></label>
      {definition.rule && <button type="button" className="overview-attention-toggle" aria-pressed={onlyAttention} onClick={() => setOnlyAttention(value => !value)}>Solo requieren revisión ({attentionCount})</button>}
      <button type="button" onClick={reset}>Restablecer desglose</button>
    </div>
    <p className="overview-explorer-count" role="status">{visible.length} de {allRows.length} locaciones · Los filtros del desglose no cambian los totales superiores.</p>
    {!visible.length ? <div className="overview-explorer-empty"><strong>{allRows.length ? 'No hay locaciones que coincidan con estos filtros.' : 'No hay datos por locación para este periodo.'}</strong>{allRows.length > 0 && <button type="button" onClick={reset}>Ver todas las locaciones seleccionadas</button>}</div> : <div className="overview-explorer-rows">
      {visible.map(row => <button type="button" key={row.location} className={`overview-explorer-row ${row.attention ? 'needs-attention' : ''}`} aria-pressed={focusLocation === row.location} aria-label={`${row.location}: ${format(row.value)}. ${focusLocation === row.location ? 'Mostrar todas las locaciones' : 'Enfocar esta locación'}`} onClick={() => onFocusLocation(focusLocation === row.location ? '' : row.location)}>
        <span className="overview-explorer-row-name">{row.location}{row.attention && <small>Revisar</small>}</span>
        <span className="overview-explorer-bar" aria-hidden="true"><span style={{ width: `${Math.abs(row.value ?? 0) / scale * 100}%` }}/></span>
        <strong>{format(row.value)}</strong><span className="overview-explorer-row-detail">{row.detail}</span>
      </button>)}
    </div>}
    {onOpenModule && modules.includes(module) && <footer className="overview-explorer-footer"><span>Continúa el seguimiento en {module}. El módulo conserva sus propios filtros.</span><button type="button" onClick={() => onOpenModule(module)}>Abrir {module} →</button></footer>}
  </section>;
}
