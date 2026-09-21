import { useLaborSnapshotRefresh } from './useLaborSnapshotRefresh';
import SalaryTimingPanel from './SalaryTimingPanel';
import type { SalaryTiming } from '../shared/salaryTiming';
import { useEffect, useMemo, useState } from 'react';
import './laborIntelligence.css';
import './laborFilters.css';
import ScheduleOvertimeMonitor, { type ScheduleRisk } from './ScheduleOvertimeMonitor';
import CustomDateRangePicker from './CustomDateRangePicker';
import MaxDataInsights from './MaxDataInsights';
import type { ExternalEscalation } from './actionCenterTypes';
import { useI18n } from './i18n';

type Props={onEscalate?:(item:ExternalEscalation)=>Promise<unknown>|void;allowedLocations?:string[]};
type LiveRow={location:string;netSales:number;hourlyHours:number;overtimeHours:number;hourlyLaborCost:number;salaryLaborCost:number;totalLaborCost:number;hourlyLaborPct:number;salaryLaborPct:number;totalLaborPct:number;splh:number|null};
type LiveResponse={salaryTiming?:SalaryTiming|null;start:string;end:string;scheduleStart:string;scheduleEnd:string;overtimeEnd:string;locations:LiveRow[];scheduleRisk:ScheduleRisk|null;scheduleRiskError?:string;error?:string};
type Insight=LiveRow&{targetLaborPct:number;gap:number;estimatedExcess:number;severity:'Healthy'|'Watch'|'Action'};
type PeriodKey='today'|'yesterday'|'this_week'|'prior_week'|'last_30'|'custom';

const money=(value:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
const pct=(value:number)=>`${value.toFixed(1)}%`;
const targetFor=(location:string)=>/Avon|Southington|Danbury/i.test(location)?22:21;
const periodLabels=(language:'en'|'es'):Record<PeriodKey,string>=>language==='es'?{today:'Hoy',yesterday:'Ayer',this_week:'Esta semana',prior_week:'Semana anterior',last_30:'Últimos 30 días',custom:'Personalizado'}:{today:'Today',yesterday:'Yesterday',this_week:'This week',prior_week:'Prior week',last_30:'Last 30 days',custom:'Custom'};
const stored=(key:string)=>typeof window==='undefined'?'':window.localStorage.getItem(key)||'';
function addDays(iso:string,days:number){const date=new Date(`${iso}T00:00:00.000Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
function easternToday(){const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));return `${value.year}-${value.month}-${value.day}`;}
function operatingWeek(date:string){const day=new Date(`${date}T00:00:00.000Z`).getUTCDay();const start=addDays(date,-((day-3+7)%7));return{start,end:addDays(start,6)};}
function selectedRange(period:PeriodKey,customStart:string,customEnd:string){
  const today=easternToday(),week=operatingWeek(today);
  if(period==='yesterday'){const day=addDays(today,-1);return{start:day,end:day};}
  if(period==='this_week')return{start:week.start,end:today};
  if(period==='prior_week')return{start:addDays(week.start,-7),end:addDays(week.start,-1)};
  if(period==='last_30')return{start:addDays(today,-29),end:today};
  if(period==='custom')return{start:customStart||today,end:customEnd||today};
  return{start:today,end:today};
}

export default function LaborIntelligenceView({onEscalate,allowedLocations}:Props){
  const {language,t}=useI18n();
  const labels=periodLabels(language);
  const today=easternToday();
  const [period,setPeriod]=useState<PeriodKey>(()=>{const saved=stored('opsvista-labor-period') as PeriodKey;return saved in labels?saved:'today';});
  const [customStart,setCustomStart]=useState(()=>stored('opsvista-labor-custom-start')||today);
  const [customEnd,setCustomEnd]=useState(()=>stored('opsvista-labor-custom-end')||today);
  const [selectedLocations,setSelectedLocations]=useState<string[]>(()=>{try{const parsed=JSON.parse(stored('opsvista-labor-locations')||'[]');return Array.isArray(parsed)?parsed.filter(item=>typeof item==='string'):[];}catch{return[];}});
  const range=useMemo(()=>selectedRange(period,customStart,customEnd),[period,customStart,customEnd]);
  const overtimeWeek=useMemo(()=>operatingWeek(range.end),[range.end]);
  const overtimeEnd=range.end<today?range.end:today<overtimeWeek.end?today:overtimeWeek.end;
  const selectionKey=selectedLocations.join('|');
  const [data,setData]=useState<LiveResponse|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [selected,setSelected]=useState<Insight|null>(null);
  const [escalated,setEscalated]=useState<string[]>([]);

  useEffect(()=>{const valid=selectedLocations.filter(location=>allowedLocations?.includes(location));if(valid.length!==selectedLocations.length)setSelectedLocations(valid);},[allowedLocations,selectionKey]);
  useEffect(()=>{window.localStorage.setItem('opsvista-labor-period',period);window.localStorage.setItem('opsvista-labor-custom-start',customStart);window.localStorage.setItem('opsvista-labor-custom-end',customEnd);window.localStorage.setItem('opsvista-labor-locations',JSON.stringify(selectedLocations));},[period,customStart,customEnd,selectionKey]);
  const {revision:liveRevision,refresh:refreshLabor}=useLaborSnapshotRefresh(!loading&&range.start===range.end&&range.start===easternToday());
  useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');
    setData(null);
    const params=new URLSearchParams({start:range.start,end:range.end,schedule_start:overtimeWeek.start,schedule_end:overtimeWeek.end,overtime_end:overtimeEnd,include_tasks:'false',salary_basis:'elapsed'});
    if(selectedLocations.length)params.set('locations',selectedLocations.join(','));
    fetch(`/api/operations/performance?${params}`,{credentials:'include',cache:'no-store',signal:controller.signal}).then(async response=>{const body=await response.json().catch(()=>({})) as LiveResponse;if(!response.ok)throw new Error(body.error||'Live labor data unavailable');setData(body)}).catch(e=>{if(e?.name!=='AbortError')setError(e instanceof Error?e.message:t('Live labor data unavailable','Datos de labor en vivo no disponibles'))}).finally(()=>setLoading(false));
    return()=>controller.abort();
  },[range.start,range.end,overtimeWeek.start,overtimeWeek.end,overtimeEnd,selectionKey,liveRevision]);

  const rows=useMemo<Insight[]>(()=>((data?.locations||[])
    .filter(row=>!allowedLocations?.length||allowedLocations.some(location=>row.location.toLowerCase().includes(location.toLowerCase())))
    .map(row=>{const targetLaborPct=targetFor(row.location);const gap=row.totalLaborPct-targetLaborPct;return{...row,targetLaborPct,gap,estimatedExcess:Math.max(0,row.totalLaborCost-row.netSales*targetLaborPct/100),severity:gap>=3||row.overtimeHours>=8?'Action':gap>=1||row.overtimeHours>=4?'Watch':'Healthy'} as Insight})
    .sort((a,b)=>b.gap-a.gap)),[data,allowedLocations]);
  const totals=useMemo(()=>rows.reduce((a,r)=>({sales:a.sales+r.netSales,labor:a.labor+r.totalLaborCost,hours:a.hours+r.hourlyHours,ot:a.ot+r.overtimeHours,excess:a.excess+r.estimatedExcess}),{sales:0,labor:0,hours:0,ot:0,excess:0}),[rows]);

  const sendToActionCenter=async(row:Insight)=>{if(!onEscalate)return;try{await onEscalate({location:row.location,title:t(`${row.location} labor review`,`Revisión de labor · ${row.location}`),signal:t(`Total labor is ${pct(row.totalLaborPct)} against a ${pct(row.targetLaborPct)} target for ${range.start}–${range.end}; overtime is ${row.overtimeHours.toFixed(1)} hours.`,`Labor total ${pct(row.totalLaborPct)} contra meta ${pct(row.targetLaborPct)} para ${range.start}–${range.end}; overtime ${row.overtimeHours.toFixed(1)} horas.`),cause:row.gap>0?t('Labor cost is above the operating target for the selected period.','El costo de labor está por encima de la meta operativa del periodo seleccionado.'):t('Labor is within target, but management requested a documented review.','Labor está dentro de la meta, pero management solicitó una revisión documentada.'),recommendation:t('The location manager must review staffing, overtime, peak coverage, prep and closing requirements, document the adjustment, and verify the next labor result.','El manager debe revisar staffing, overtime, cobertura de rush, prep y cierre, documentar el ajuste y verificar el siguiente resultado de labor.'),impact:t(`${money(row.estimatedExcess)} labor cost above target in the selected period`,`${money(row.estimatedExcess)} de costo de labor sobre la meta en el periodo seleccionado`),severity:row.severity==='Action'?'High':row.severity==='Watch'?'Medium':'Low',accountableName:t(`${row.location} management team`,`Equipo de management · ${row.location}`),accountableRole:t('Labor and schedule control','Control de labor y horarios'),automationKey:`labor-variance::${row.location}::${range.start}::${range.end}`,sources:['Toast Labor','7shifts Schedule'],sourceIds:[`${row.location}:${range.start}:${range.end}`]});setEscalated(items=>items.includes(row.location)?items:[...items,row.location]);}catch(error){if(error instanceof Error&&error.message==='Action assignment cancelled')return;setError(error instanceof Error?error.message:'Action could not be assigned');}};

  const locationLabel=!selectedLocations.length?t('All locations','Todas las locaciones'):selectedLocations.length===1?selectedLocations[0]:t(`${selectedLocations.length} locations`,`${selectedLocations.length} locaciones`);
  const toggleLocation=(location:string)=>setSelectedLocations(current=>{const next=current.includes(location)?current.filter(item=>item!==location):[...current,location];return next.length===allowedLocations?.length?[]:next;});

  return <div className="labor-page">
    <section className="labor-filter-bar">
      <div className="labor-period-control"><label htmlFor="labor-period">{t('Period','Periodo')}</label><select id="labor-period" value={period} onChange={event=>setPeriod(event.target.value as PeriodKey)}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
      <CustomDateRangePicker active={period==='custom'} start={customStart} end={customEnd} maxDate={today} maxRangeDays={31} onApply={(start,end)=>{setCustomStart(start);setCustomEnd(end);}} ariaLabel={t('Select schedule period','Seleccionar periodo de horarios')} />
      <details className="labor-location-picker"><summary><span>{t('Locations','Locaciones')}</span><strong>{locationLabel}</strong></summary><div className="labor-location-menu"><label><input type="checkbox" checked={!selectedLocations.length} onChange={()=>setSelectedLocations([])}/><span>{t('All locations','Todas las locaciones')}</span></label>{(allowedLocations||[]).map(location=><label key={location}><input type="checkbox" checked={!selectedLocations.length||selectedLocations.includes(location)} onChange={()=>toggleLocation(location)}/><span>{location}</span></label>)}</div></details>
      <div className="labor-period-explanation"><span>{t('RESULTS SHOWN','RESULTADOS MOSTRADOS')}</span><strong>{labels[period]} · {range.start} → {range.end}</strong><small>{t('Toast sales, worked hours and labor cost for','Ventas Toast, horas trabajadas y costo de labor para')} {locationLabel}.</small></div>
      <div className="labor-period-explanation overtime"><span>{t('OVERTIME EVALUATION','EVALUACIÓN DE OVERTIME')}</span><strong>{overtimeWeek.start} → {overtimeWeek.end}</strong><small>{t('The 40-hour threshold always uses the Wednesday–Tuesday operating week.','El umbral de 40 horas siempre usa la semana operativa miércoles–martes.')}</small></div>
    </section>
    {error&&<div className="labor-data-error">{error}</div>}
    <SalaryTimingPanel data={data?.salaryTiming} language={language} onRefresh={refreshLabor}/>
    <section className="labor-summary-grid">
      <article className="labor-card labor-hero"><span>{data?.salaryTiming?.applied?t('ACCRUED LABOR','LABOR ACUMULADO'):t('TOTAL LABOR','LABOR TOTAL')}</span><strong>{loading?'…':pct(totals.sales?totals.labor/totals.sales*100:0)}</strong><p>{t('Hourly + salary labor','Labor por hora + salario')}</p></article>
      <article className="labor-card"><span>{t('NET SALES','VENTAS NETAS')}</span><strong>{money(totals.sales)}</strong><p>{t('Live Toast','Toast en vivo')}</p></article>
      <article className="labor-card"><span>SPLH</span><strong>{money(totals.hours?totals.sales/totals.hours:0)}</strong><p>{t('Sales per hourly labor hour','Ventas por hora de labor')}</p></article>
      <article className="labor-card labor-warn"><span>{t('ABOVE TARGET','SOBRE META')}</span><strong>{money(totals.excess)}</strong><p>{t('Actual period variance','Variación real del periodo')}</p></article>
      <article className="labor-card"><span>{t('OT HOURS','HORAS OT')}</span><strong>{totals.ot.toFixed(1)}h</strong><p>{t('Live worked overtime','Overtime trabajado en vivo')}</p></article>
      <article className="labor-card"><span>{t('NEEDS ACTION','REQUIERE ACCIÓN')}</span><strong>{rows.filter(r=>r.severity==='Action').length}</strong><p>{rows.filter(r=>r.severity==='Watch').length} {t('additional watch locations','locaciones adicionales en vigilancia')}</p></article>
    </section>
    {!!rows.length&&<MaxDataInsights title={t('Labor by location','Labor por locación')} subtitle={t('Cost over sales and overtime with cross-filters to detect operational pressure without losing coverage context.','Costo sobre ventas y overtime con filtros cruzados para detectar presión operativa sin perder contexto de cobertura.')} rows={rows.map(row=>({location:row.location,primary:row.totalLaborPct,secondary:row.overtimeHours,status:row.severity==='Action'?'bad':row.severity==='Watch'?'watch':'good'}))} primaryLabel={t('Total labor','Labor total')} secondaryLabel={t('Worked overtime','Overtime trabajado')} primaryFormat={value=>`${value.toFixed(1)}%`} secondaryFormat={value=>`${value.toFixed(1)} h`} conclusion={filtered=>{if(!filtered.length)return[t('No labor data for this filter.','Sin datos de labor para este filtro.')];const gap=[...filtered].sort((a,b)=>b.primary-a.primary);const overtime=[...filtered].sort((a,b)=>(b.secondary??0)-(a.secondary??0));const action=filtered.filter(row=>row.status==='bad');return[t(`${gap[0].location} has the highest labor percentage: ${gap[0].primary.toFixed(1)}%.`,`${gap[0].location} tiene la mayor proporción de labor: ${gap[0].primary.toFixed(1)}%.`),t(`${overtime[0].location} has ${(overtime[0].secondary??0).toFixed(1)} overtime hours.`,`${overtime[0].location} concentra ${(overtime[0].secondary??0).toFixed(1)} horas de overtime.`),action.length?t(`Prioritize ${action.map(row=>row.location).join(', ')} and protect rush, prep and closing before changing shifts.`,`Prioriza ${action.map(row=>row.location).join(', ')} y protege rush, prep y cierre antes de ajustar turnos.`):t('No locations are in Action status within this filter.','No hay locaciones en estado Acción dentro del filtro.')];}}/>}
    <section className="labor-guidance"><div><strong>{t('OpsVista Labor Guardrail','Guardrail de Labor OpsVista')}</strong><span>{t('Review actual demand, required positions, service levels, prep and closing standards before reducing hours.','Revisa demanda real, puestos requeridos, niveles de servicio, prep y estándares de cierre antes de reducir horas.')}</span></div><div className="labor-guide-chips"><span>{t('Live sales','Ventas en vivo')}</span><span>{t('Hourly + salary','Por hora + salario')}</span><span>{t('Total labor %','Labor total %')}</span><span>SPLH</span><span>Overtime</span></div></section>
    <ScheduleOvertimeMonitor data={data?.scheduleRisk||null} error={data?.scheduleRiskError} loading={loading} onEscalate={onEscalate}/>
    <section className="labor-panel"><div className="labor-panel-head"><div><h2>{t('Live Labor Intelligence by Location','Labor Intelligence en vivo por locación')}</h2><p>{t('Actual performance for the selected operating period.','Desempeño real para el periodo operativo seleccionado.')}</p></div><span>{rows.length} {t('locations','locaciones')}</span></div>
      <div className="labor-table-wrap"><table className="labor-table"><thead><tr><th>{t('Location','Locación')}</th><th>{t('Net Sales','Ventas netas')}</th><th>{t('Hourly Labor','Labor por hora')}</th><th>{t('Salary Labor','Labor salarial')}</th><th>{t('Total Labor','Labor total')}</th><th>{t('Target','Meta')}</th><th>SPLH</th><th>{t('OT Hours','Horas OT')}</th><th>{t('Above Target','Sobre meta')}</th><th>{t('Status','Estado')}</th><th></th></tr></thead>
      <tbody>{rows.map(row=><tr key={row.location} className={row.severity==='Action'?'labor-action-row':''}><td><strong>{row.location}</strong></td><td>{money(row.netSales)}</td><td>{money(row.hourlyLaborCost)} · {pct(row.hourlyLaborPct)}</td><td>{money(row.salaryLaborCost)} · {pct(row.salaryLaborPct)}</td><td><strong className={row.gap>1?'labor-negative':''}>{money(row.totalLaborCost)} · {pct(row.totalLaborPct)}</strong></td><td>{pct(row.targetLaborPct)}</td><td>{row.splh?money(row.splh):'—'}</td><td>{row.overtimeHours.toFixed(1)}h</td><td className="labor-money">{money(row.estimatedExcess)}</td><td><span className={`labor-status ${row.severity.toLowerCase()}`}>{row.severity==='Healthy'?t('Healthy','Saludable'):row.severity==='Watch'?t('Watch','Vigilar'):t('Action','Acción')}</span></td><td><button onClick={()=>setSelected(row)}>{t('Review','Revisar')}</button></td></tr>)}</tbody></table></div>
    </section>
    {selected&&<div className="labor-drawer-backdrop" onClick={()=>setSelected(null)}><aside className="labor-drawer" onClick={e=>e.stopPropagation()}><div className="labor-drawer-head"><div><span>LIVE LABOR INTELLIGENCE</span><h2>{selected.location}</h2><p>{range.start} → {range.end}</p></div><button onClick={()=>setSelected(null)}>×</button></div>
      <div className="labor-drawer-grid"><div><label>{t('Net sales','Ventas netas')}</label><strong>{money(selected.netSales)}</strong></div><div><label>{t('Total labor','Labor total')}</label><strong>{money(selected.totalLaborCost)} · {pct(selected.totalLaborPct)}</strong></div><div><label>{t('Hourly labor','Labor por hora')}</label><strong>{money(selected.hourlyLaborCost)}</strong></div><div><label>{t('Salary labor','Labor salarial')}</label><strong>{money(selected.salaryLaborCost)}</strong></div><div><label>{t('OT hours','Horas OT')}</label><strong>{selected.overtimeHours.toFixed(1)}h</strong></div><div><label>SPLH</label><strong>{selected.splh?money(selected.splh):'—'}</strong></div></div>
      <div className="labor-signal"><label>{t('SIGNAL','SEÑAL')}</label><p>{selected.location} {t('is at','está en')} {pct(selected.totalLaborPct)} {t('total labor against a','de labor total contra una meta de')} {pct(selected.targetLaborPct)}.</p></div>
      <div className="labor-recommendation"><label>{t('OPSVISTA RECOMMENDATION','RECOMENDACIÓN OPSVISTA')}</label><p>{t('Review staffing and overtime against actual demand. Protect rush coverage, prep, closing and required positions before changing the schedule.','Revisa staffing y overtime contra la demanda real. Protege cobertura de rush, prep, cierre y puestos requeridos antes de cambiar el horario.')}</p></div>
      <div className="labor-impact"><span>{t('Actual period variance','Variación real del periodo')}</span><strong>{money(selected.estimatedExcess)} {t('above target','sobre la meta')}</strong><small>{selected.overtimeHours.toFixed(1)} {t('overtime hours','horas de overtime')}</small></div>
      <div className="labor-actions"><button className="labor-primary" disabled={escalated.includes(selected.location)} onClick={()=>void sendToActionCenter(selected)}>{escalated.includes(selected.location)?t('Assigned in Action Center','Asignado en Action Center'):t('Assign to location manager','Asignar al manager')}</button><button onClick={()=>setSelected(null)}>{t('Close','Cerrar')}</button></div>
    </aside></div>}
  </div>;
}
