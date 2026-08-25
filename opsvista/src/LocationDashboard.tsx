import { useEffect, useMemo, useState } from 'react';
import CustomDateRangePicker from './CustomDateRangePicker';
import './locationDashboard.css';
import MaxDataInsights from './MaxDataInsights';

type PeriodKey='today'|'yesterday'|'this-week'|'previous-week'|'this-month'|'last-30-days'|'custom';
type LiveRow={location:string;netSales:number;discountAmount:number;discountPct:number;voidAmount:number;voidPct:number;hourlyHours:number;overtimeHours:number;hourlyLaborCost:number;salaryLaborCost:number;totalLaborCost:number;hourlyLaborPct:number;salaryLaborPct:number;totalLaborPct:number;splh:number|null};
type TaskLocation={location:string;completed:number;total:number;compliancePct:number};
type ScheduleLocation={location:string;monitoredEmployees:number;riskEmployees:number;projectedOvertimeHours:number;estimatedOvertimeCost:number;employeesMissingHourlyWage:number};
type PerformanceResponse={source:string;start:string;end:string;salaryLaborConfigured:boolean;locations:LiveRow[];totals:{netSales:number;discountAmount:number;discountPct:number;voidAmount:number;voidPct:number;hourlyHours:number;overtimeHours:number;hourlyLaborCost:number;salaryLaborCost:number;totalLaborCost:number;hourlyLaborPct:number;salaryLaborPct:number;totalLaborPct:number;splh:number|null};taskCompliance?:{locations:TaskLocation[];totals:{completed:number;total:number;compliancePct:number}}|null;taskComplianceError?:string;scheduleRisk?:{locations:ScheduleLocation[];projectedOvertimeHours:number;estimatedOvertimeCost:number}|null;scheduleRiskError?:string;notes?:{salaryLabor?:string;tasks?:string;overtime?:string}};
type LogbookEntry={id:number;date:string;locationName:string;author:string;category:string;message:string;attachments:number};
type TasksResponse={locations?:Array<{locationName:string;completed:number;total:number;completionPct:number|null}>;logbook?:LogbookEntry[];logbookError?:string;error?:string};
type Props={allowedLocations:string[];allLocations:boolean;onOpenTasks?:()=>void;onOpenLabor?:()=>void};

const money0=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
const money2=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});
const normalize=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,'');
const sameLocation=(left:string,right:string)=>{const a=normalize(left),b=normalize(right);return a===b||a.includes(b)||b.includes(a)};
const plusDays=(value:string,days:number)=>{const date=new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10)};
const daysInclusive=(start:string,end:string)=>Math.floor((Date.parse(`${end}T12:00:00Z`)-Date.parse(`${start}T12:00:00Z`))/86400000)+1;
function easternToday(){const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));return `${values.year}-${values.month}-${values.day}`}
function operatingWeekStart(value:string){const day=new Date(`${value}T12:00:00Z`).getUTCDay();return plusDays(value,-((day-3+7)%7))}
function monthStart(value:string){const [year,month]=value.split('-').map(Number);return new Date(Date.UTC(year,month-1,1,12)).toISOString().slice(0,10)}
function resolveRange(period:PeriodKey,today:string,customStart:string,customEnd:string){
  if(period==='today')return{start:today,end:today,label:'Hoy'};
  if(period==='yesterday'){const date=plusDays(today,-1);return{start:date,end:date,label:'Ayer'}}
  if(period==='this-week')return{start:operatingWeekStart(today),end:today,label:'Esta semana operativa'};
  if(period==='previous-week'){const start=plusDays(operatingWeekStart(today),-7);return{start,end:plusDays(start,6),label:'Semana anterior'}}
  if(period==='this-month')return{start:monthStart(today),end:today,label:'Este mes'};
  if(period==='last-30-days')return{start:plusDays(today,-29),end:today,label:'Últimos 30 días'};
  return{start:customStart,end:customEnd,label:'Custom'};
}
function comparisonRange(start:string,end:string){const days=daysInclusive(start,end);const comparisonEnd=plusDays(start,-1);return{start:plusDays(comparisonEnd,1-days),end:comparisonEnd}}
function findLocation<T extends {location:string}>(rows:T[]|undefined,location:string){return rows?.find(row=>sameLocation(row.location,location))}

function SummaryKpi({label,value,note,tone='neutral'}:{label:string;value:string;note:string;tone?:'neutral'|'good'|'warn'|'bad'}){
  return <article className={`location-summary-kpi ${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}
function MetricCell({label,value,note,tone='neutral'}:{label:string;value:string;note?:string;tone?:'neutral'|'good'|'warn'|'bad'}){
  return <div className={`location-metric-cell ${tone}`}><span>{label}</span><strong>{value}</strong>{note&&<small>{note}</small>}</div>;
}

export default function LocationDashboard({allowedLocations,allLocations,onOpenTasks,onOpenLabor}:Props){
  const today=useMemo(easternToday,[]);
  const [period,setPeriod]=useState<PeriodKey>(()=>{const saved=window.localStorage.getItem('opsvista-locations-period');return saved&&['today','yesterday','this-week','previous-week','this-month','last-30-days','custom'].includes(saved)?saved as PeriodKey:'today'});
  const [customStart,setCustomStart]=useState(()=>window.localStorage.getItem('opsvista-locations-custom-start')||today);
  const [customEnd,setCustomEnd]=useState(()=>window.localStorage.getItem('opsvista-locations-custom-end')||today);
  const [selectedLocations,setSelectedLocations]=useState<string[]>(()=>{try{const saved=JSON.parse(window.localStorage.getItem('opsvista-locations-selection')||'[]');return Array.isArray(saved)?saved.filter(item=>typeof item==='string'):[]}catch{return[]}});
  const [current,setCurrent]=useState<PerformanceResponse|null>(null);
  const [previous,setPrevious]=useState<PerformanceResponse|null>(null);
  const [tasks,setTasks]=useState<TasksResponse|null>(null);
  const [loading,setLoading]=useState(true);
  const [comparisonLoading,setComparisonLoading]=useState(false);
  const [tasksLoading,setTasksLoading]=useState(false);
  const [error,setError]=useState('');
  const [comparisonError,setComparisonError]=useState('');
  const [tasksError,setTasksError]=useState('');
  const range=useMemo(()=>resolveRange(period,today,customStart,customEnd),[period,today,customStart,customEnd]);
  const prior=useMemo(()=>comparisonRange(range.start,range.end),[range.start,range.end]);
  const rangeDays=daysInclusive(range.start,range.end);
  const rangeError=!range.start||!range.end||rangeDays<1?'Selecciona un periodo válido.':rangeDays>31?'El periodo puede incluir hasta 31 días.':'';
  const selectionKey=selectedLocations.join('|');
  const locationLabel=!selectedLocations.length?'All locations':selectedLocations.length===1?selectedLocations[0]:`${selectedLocations.length} locaciones`;

  useEffect(()=>{const valid=selectedLocations.filter(location=>allowedLocations.includes(location));if(valid.length!==selectedLocations.length)setSelectedLocations(valid)},[allowedLocations,selectionKey]);
  useEffect(()=>{window.localStorage.setItem('opsvista-locations-period',period);window.localStorage.setItem('opsvista-locations-custom-start',customStart);window.localStorage.setItem('opsvista-locations-custom-end',customEnd);window.localStorage.setItem('opsvista-locations-selection',JSON.stringify(selectedLocations))},[period,customStart,customEnd,selectionKey]);
  useEffect(()=>{
    if(rangeError){setLoading(false);return}
    const controller=new AbortController();
    let cancelled=false;
    setLoading(true);setComparisonLoading(false);setTasksLoading(true);
    setCurrent(null);setPrevious(null);setTasks(null);
    setError('');setComparisonError('');setTasksError('');
    const currentParams=new URLSearchParams({start:range.start,end:range.end});
    const priorParams=new URLSearchParams({start:prior.start,end:prior.end,include_tasks:'false'});
    if(selectedLocations.length){const locations=selectedLocations.join(',');currentParams.set('locations',locations);priorParams.set('locations',locations)}
    const tasksParams=new URLSearchParams({start:range.start,end:range.end});
    const performanceRequest=(params:URLSearchParams,message:string)=>fetch(`/api/operations/performance?${params}`,{credentials:'include',cache:'no-store',signal:controller.signal}).then(async response=>{const body=await response.json().catch(()=>({})) as PerformanceResponse&{error?:string};if(!response.ok)throw new Error(body.error||message);return body});

    // Render the selected Toast period first. The prior-period comparison is
    // deliberately requested afterward so a 30-day comparison cannot block it.
    void performanceRequest(currentParams,'No fue posible cargar el desempeño actual').then(async body=>{
      if(cancelled)return;
      setCurrent(body);setLoading(false);setComparisonLoading(true);
      try{
        const comparison=await performanceRequest(priorParams,'No fue posible cargar la comparación');
        if(!cancelled)setPrevious(comparison);
      }catch(reason){
        if(!cancelled&&reason instanceof Error&&reason.name!=='AbortError')setComparisonError(reason.message||'Comparación no disponible');
      }finally{
        if(!cancelled)setComparisonLoading(false);
      }
    }).catch(reason=>{
      if(!cancelled&&reason instanceof Error&&reason.name!=='AbortError'){setError(reason.message||'No fue posible cargar las locaciones');setLoading(false)}
    });

    // Tasks and Logbook are independent from Toast. A 7shifts failure cannot
    // clear valid location cards or leave the primary loading state stuck.
    void fetch(`/api/tasks/weekly?${tasksParams}`,{credentials:'include',cache:'no-store',signal:controller.signal}).then(async response=>{const body=await response.json().catch(()=>({})) as TasksResponse;if(!response.ok)throw new Error(body.error||'No fue posible cargar Logbook');return body}).then(body=>{
      if(!cancelled)setTasks(body);
    }).catch(reason=>{
      if(!cancelled&&reason instanceof Error&&reason.name!=='AbortError')setTasksError(reason.message||'Tasks y Logbook no disponibles');
    }).finally(()=>{
      if(!cancelled)setTasksLoading(false);
    });

    return()=>{cancelled=true;controller.abort()};
  },[range.start,range.end,prior.start,prior.end,selectionKey,rangeError]);

  const visibleLocations=selectedLocations.length?selectedLocations:allowedLocations;
  const toggleLocation=(location:string)=>setSelectedLocations(currentSelection=>{const next=currentSelection.includes(location)?currentSelection.filter(item=>item!==location):[...currentSelection,location];return next.length===allowedLocations.length?[]:next});
  const cards=useMemo(()=>{
    if(!current)return[];
    const expectedLogbookDays=rangeDays;
    return current.locations.filter(row=>!visibleLocations.length||visibleLocations.some(location=>sameLocation(location,row.location))).map(row=>{
      const priorRow=findLocation(previous?.locations,row.location);
      const taskRow=findLocation(current.taskCompliance?.locations,row.location)||tasks?.locations?.find(item=>sameLocation(item.locationName,row.location));
      const taskTotal=Number(taskRow?.total||0);
      let taskPct:number|null=null;
      if(taskTotal&&taskRow)taskPct='compliancePct'in taskRow?Number(taskRow.compliancePct):taskRow.completionPct===null?null:Number(taskRow.completionPct);
      const risk=findLocation(current.scheduleRisk?.locations,row.location);
      const logs=(tasks?.logbook||[]).filter(entry=>sameLocation(entry.locationName,row.location));
      const logbookDays=new Set(logs.map(entry=>entry.date)).size;
      const delta=priorRow?.netSales?((row.netSales-priorRow.netSales)/priorRow.netSales)*100:null;
      const alerts=[row.totalLaborPct>30,row.discountPct>2,row.voidPct>.5,taskPct!==null&&taskPct<80,Number(risk?.projectedOvertimeHours||0)>0,tasks!==null&&!tasksError&&logbookDays<expectedLogbookDays].filter(Boolean).length;
      return{row,priorRow,taskRow,taskPct,risk,logs,logbookDays,expectedLogbookDays,delta,alerts};
    });
  },[current,previous,tasks,tasksError,visibleLocations.join('|'),rangeDays]);
  const totals=current?.totals;
  const locationsAtRisk=cards.filter(card=>card.alerts>0).length;
  const taskTotals=current?.taskCompliance?.totals;

  return <div className="location-dashboard">
    <section className="location-dashboard-controls">
      <div><span>LOCATION PERFORMANCE</span><h2>Dashboard completo por locación</h2><p>Ventas, labor, productividad, overtime, Tasks y Logbook dentro del mismo periodo.</p></div>
      <div className="location-dashboard-filter-row">
        <details className="location-dashboard-location-picker"><summary><span>LOCACIONES</span><strong>{locationLabel}</strong></summary><div><label><input type="checkbox" checked={!selectedLocations.length} onChange={()=>setSelectedLocations([])}/>All locations</label>{allowedLocations.map(location=><label key={location}><input type="checkbox" checked={!selectedLocations.length||selectedLocations.includes(location)} onChange={()=>toggleLocation(location)}/>{location}</label>)}</div></details>
        <label className="location-dashboard-period"><span>PERIODO</span><select value={period} onChange={event=>setPeriod(event.target.value as PeriodKey)}><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="this-week">This week</option><option value="previous-week">Prior week</option><option value="this-month">This month</option><option value="last-30-days">Last 30 days</option><option value="custom">Custom</option></select></label>
        <CustomDateRangePicker active={period==='custom'} start={customStart} end={customEnd} maxDate={today} maxRangeDays={31} onApply={(start,end)=>{setCustomStart(start);setCustomEnd(end)}} ariaLabel="Seleccionar periodo de Locaciones"/>
      </div>
      <div className={`location-dashboard-source ${error||rangeError?'error':''}`}><span><strong>{range.label}</strong> · {range.start} → {range.end}</span><span>{loading?'Actualizando Toast…':error||rangeError||(current?`Live · ${comparisonLoading?'comparación cargando':tasksLoading?'7shifts cargando':current.source}`:'Fuentes pendientes')}</span></div>
    </section>

    {(comparisonError||tasksError||tasks?.logbookError)&&<section className="location-dashboard-warning"><strong>Fuentes parciales</strong><span>{[comparisonError,tasksError,tasks?.logbookError].filter(Boolean).join(' · ')}</span></section>}

    <section className="location-summary-grid">
      <SummaryKpi label="NET SALES" value={loading?'…':totals?money2.format(totals.netSales):'Pendiente'} note={`${cards.length} locaciones · periodo seleccionado`} tone={totals?'good':'neutral'}/>
      <SummaryKpi label="TOTAL LABOR" value={totals?`${totals.totalLaborPct.toFixed(2)}%`:'Pendiente'} note={totals?`${money2.format(totals.totalLaborCost)} · Hourly + salary`:'Esperando Toast y salarios'} tone={totals?(totals.totalLaborPct>30?'bad':'good'):'neutral'}/>
      <SummaryKpi label="SPLH" value={totals?.splh?money2.format(totals.splh):'—'} note={totals?`${totals.hourlyHours.toFixed(1)} horas hourly trabajadas`:'Ventas ÷ horas hourly'} tone={totals?.splh?'good':'neutral'}/>
      <SummaryKpi label="OT TRABAJADAS" value={totals?`${totals.overtimeHours.toFixed(1)} h`:'—'} note="Time entries reales de Toast" tone={totals?.overtimeHours?'warn':'good'}/>
      <SummaryKpi label="TASKS COMPLIANCE" value={taskTotals?.total?`${taskTotals.compliancePct.toFixed(1)}%`:'—'} note={taskTotals?.total?`${taskTotals.completed} de ${taskTotals.total} completadas`:'Sin Tasks verificables'} tone={taskTotals?.total?(taskTotals.compliancePct>=80?'good':'bad'):'neutral'}/>
      <SummaryKpi label="NEEDS ACTION" value={String(locationsAtRisk)} note={`${cards.length-locationsAtRisk} locaciones dentro de guardrails`} tone={locationsAtRisk?'bad':'good'}/>
    </section>

    {!!cards.length&&<MaxDataInsights title="Red de locaciones" subtitle="Comparación ejecutiva de ventas y labor. Pulsa una barra, punto, mapa o fila para actualizar el foco y las conclusiones." rows={cards.map(card=>({location:card.row.location,primary:card.row.netSales,secondary:card.row.totalLaborPct,status:card.alerts>1?'bad':card.alerts===1?'watch':'good'}))} primaryLabel="Ventas netas" secondaryLabel="Labor total" primaryFormat={value=>money0.format(value)} secondaryFormat={value=>`${value.toFixed(1)}%`} conclusion={filtered=>{if(!filtered.length)return['Sin datos para las locaciones seleccionadas.'];const sales=[...filtered].sort((a,b)=>b.primary-a.primary);const alerts=filtered.filter(row=>row.status!=='good');return[`${sales[0].location} lidera ventas con ${money0.format(sales[0].primary)}.`,`${alerts.length} de ${filtered.length} locaciones muestran al menos una señal que revisar.`,alerts.length?`Abre el detalle de ${alerts.map(row=>row.location).join(', ')} antes de definir la acción.`:'La red visible permanece dentro de los guardrails configurados.'];}}/>}

    <section className="location-dashboard-heading"><div><h2>Desempeño por locación</h2><p>Comparación contra el periodo inmediatamente anterior de la misma duración.</p></div><span>{cards.length} locaciones</span></section>
    {!loading&&!error&&!cards.length&&<section className="location-dashboard-empty">No se recibieron locaciones para este periodo y alcance. OpsVista no sustituirá información demo.</section>}
    <section className="location-card-grid">{cards.map(({row,taskPct,risk,logs,logbookDays,expectedLogbookDays,delta,alerts})=>{
      const laborTone=row.totalLaborPct>30?'bad':row.totalLaborPct>27?'warn':'good';
      return <article className={`location-performance-card ${alerts?'needs-action':''}`} key={row.location}>
        <header><div><span>⌖</span><div><small>LOCATION</small><h3>{row.location}</h3></div></div><strong className={alerts?'bad':'good'}>{alerts} alerta{alerts===1?'':'s'}</strong></header>
        <div className="location-sales-row"><div><span>VENTAS NETAS</span><strong>{money2.format(row.netSales)}</strong></div><div className={delta===null?'neutral':delta>=0?'good':'bad'}><span>VS. PERIODO ANTERIOR</span><strong>{delta===null?'—':`${delta>=0?'↗':'↘'} ${Math.abs(delta).toFixed(1)}%`}</strong></div></div>
        <div className="location-metric-grid">
          <MetricCell label="Hourly labor" value={`${row.hourlyLaborPct.toFixed(2)}%`} note={`${money0.format(row.hourlyLaborCost)} · ${row.hourlyHours.toFixed(1)} h`} tone={row.hourlyLaborPct>23?'warn':'good'}/>
          <MetricCell label="Salary labor" value={`${row.salaryLaborPct.toFixed(2)}%`} note={current?.salaryLaborConfigured?money0.format(row.salaryLaborCost):'Clasificación salarial pendiente'} tone={current?.salaryLaborConfigured?'good':'warn'}/>
          <MetricCell label="Total labor" value={`${row.totalLaborPct.toFixed(2)}%`} note={money0.format(row.totalLaborCost)} tone={laborTone}/>
          <MetricCell label="SPLH" value={row.splh?money2.format(row.splh):'—'} note="Sales per hourly labor hour" tone={row.splh?'good':'neutral'}/>
          <MetricCell label="OT trabajadas" value={`${row.overtimeHours.toFixed(1)} h`} note={risk?`${risk.projectedOvertimeHours.toFixed(1)} h proyectadas · ${risk.riskEmployees} en riesgo`:'Proyección 7shifts pendiente'} tone={row.overtimeHours||risk?.projectedOvertimeHours?'warn':'good'}/>
          <MetricCell label="Tasks" value={taskPct===null?'—':`${taskPct.toFixed(1)}%`} note={taskPct===null?'Sin registros verificables':taskPct>=80?'Meta ≥ 80%':'Debajo de meta'} tone={taskPct===null?'neutral':taskPct>=80?'good':'bad'}/>
          <MetricCell label="Descuentos" value={`${row.discountPct.toFixed(2)}%`} note={`${money2.format(row.discountAmount)} · meta ≤ 2.00%`} tone={row.discountPct>2?'bad':'good'}/>
          <MetricCell label="Voids" value={`${row.voidPct.toFixed(2)}%`} note={`${money2.format(row.voidAmount)} · meta ≤ 0.50%`} tone={row.voidPct>.5?'bad':'good'}/>
          <MetricCell label="Logbook" value={tasks===null?'Pendiente':`${logbookDays}/${expectedLogbookDays} días`} note={logs.length?`${logs.length} entradas · última ${logs.map(log=>log.date).sort().at(-1)}`:'Sin registros en el periodo'} tone={tasks===null?'neutral':logbookDays>=expectedLogbookDays?'good':'bad'}/>
        </div>
        <footer><div><span>{current?.source||'Fuentes operativas'}</span>{risk?.employeesMissingHourlyWage?<strong>{risk.employeesMissingHourlyWage} tarifas faltantes</strong>:null}</div><div>{onOpenTasks&&<button onClick={onOpenTasks}>Abrir Tasks →</button>}{onOpenLabor&&<button onClick={onOpenLabor}>Abrir Horarios →</button>}</div></footer>
      </article>;
    })}</section>
  </div>;
}
