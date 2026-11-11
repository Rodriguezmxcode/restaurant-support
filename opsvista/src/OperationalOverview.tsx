import { useI18n } from './i18n';
import { useLaborSnapshotRefresh } from './useLaborSnapshotRefresh';
import SalaryTimingPanel from './SalaryTimingPanel';
import type { SalaryTiming } from '../shared/salaryTiming';
import { useEffect, useRef, useState } from 'react';
import CustomDateRangePicker from './CustomDateRangePicker';
import './locationDashboard.css';
import OverviewCharts from './OverviewCharts';
import OverviewExplorer, { type OverviewMetric } from './OverviewExplorer';
import type { OpsVistaModule } from './accessControl';
import SalesCategoriesPanel from './SalesCategoriesPanel';

type RangeKey='today'|'yesterday'|'this-week'|'previous-week'|'this-month'|'last-month'|'custom';
export type LiveRow={location:string;netSales:number;discountAmount:number;discountPct:number;voidAmount:number;voidPct:number;hourlyHours:number;overtimeHours:number;hourlyLaborCost:number;salaryLaborCost:number;totalLaborCost:number;laborPct:number;hourlyLaborPct:number;salaryLaborPct:number;totalLaborPct:number;splh:number|null};
type LiveResponse={salaryTiming?:SalaryTiming|null;source:string;start:string;end:string;salaryLaborConfigured:boolean;taskCompliance?:SevenShiftsResponse|null;taskComplianceError?:string;locations:LiveRow[];totals:{netSales:number;discountAmount:number;discountPct:number;voidAmount:number;voidPct:number;hourlyHours:number;overtimeHours:number;hourlyLaborCost:number;salaryLaborCost:number;totalLaborCost:number;laborPct:number;hourlyLaborPct:number;salaryLaborPct:number;totalLaborPct:number;splh:number|null};notes?:{salaryLabor?:string;tasks?:string}};
export type SevenShiftsResponse={source:string;totals:{completed:number;total:number;compliancePct:number};locations:Array<{location:string;completed:number;total:number;compliancePct:number}>};
type Props={salesMode?:boolean;allowedLocations:string[];allLocations:boolean;initialLocation?:string;modules?:OpsVistaModule[];onOpenModule?:(module:OpsVistaModule)=>void};

const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
const money2=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});
function easternToday(){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
function plusDays(value:string,n:number){const date=new Date(`${value}T00:00:00.000Z`);date.setUTCDate(date.getUTCDate()+n);return date.toISOString().slice(0,10)}
function startOfOperationalWeek(value:string){const day=new Date(`${value}T00:00:00.000Z`).getUTCDay();return plusDays(value,-((day-3+7)%7))}
function monthBoundary(value:string,offset:number,end=false){const [year,month]=value.split('-').map(Number);const date=end?new Date(Date.UTC(year,month+offset,0)):new Date(Date.UTC(year,month-1+offset,1));return date.toISOString().slice(0,10)}
function resolveRange(key:RangeKey,customStart:string,customEnd:string){const today=easternToday();if(key==='today')return{start:today,end:today,label:'Today'};if(key==='yesterday'){const yesterday=plusDays(today,-1);return{start:yesterday,end:yesterday,label:'Yesterday'}};if(key==='this-week'){const start=startOfOperationalWeek(today);return{start,end:today,label:'This operating week'}};if(key==='previous-week'){const start=plusDays(startOfOperationalWeek(today),-7);return{start,end:plusDays(start,6),label:'Previous operating week'}};if(key==='this-month')return{start:monthBoundary(today,0),end:today,label:'This month'};if(key==='last-month')return{start:monthBoundary(today,-1),end:monthBoundary(today,-1,true),label:'Last month'};return{start:customStart,end:customEnd,label:'Custom range'}}
function Kpi({label,value,note,status='ready',metric,active,disabled,onOpen}:{label:string;value:string;note:string;status?:'ready'|'pending'|'warning';metric:OverviewMetric;active:boolean;disabled:boolean;onOpen:(metric:OverviewMetric)=>void}){
  const {t}=useI18n();
  return <button type="button" id={`overview-kpi-${metric}`} className="overview-kpi" data-status={status} aria-pressed={active} aria-controls="overview-metric-detail" disabled={disabled} onClick={()=>onOpen(metric)}><span className="overview-kpi-label">{label}{status==='warning'&&<span className="overview-kpi-review">{t('Review','Revisar')}</span>}</span><strong className="overview-kpi-value">{value}</strong><span className="overview-kpi-note">{note}</span><span className="overview-kpi-action">{disabled?t('Waiting for data','Esperando datos'):active?t('Viewing breakdown ↓','Viendo desglose ↓'):t('Explore by location →','Explorar por locación →')}</span></button>;
}

export default function OperationalOverview({salesMode=false,allowedLocations,initialLocation='All locations',modules,onOpenModule}:Props){
  const {t,language}=useI18n();
  const [salesTab,setSalesTab]=useState<'summary'|'categories'>('summary');
  const categoriesActive=salesMode&&salesTab==='categories';
  const today=easternToday();
  const [range,setRange]=useState<RangeKey>(()=>{
    const saved=typeof window!=='undefined'?window.localStorage.getItem('opsvista-overview-range'):null;
    return saved&&['today','yesterday','this-week','previous-week','this-month','last-month','custom'].includes(saved)?saved as RangeKey:'today';
  });
  const [customStart,setCustomStart]=useState(()=>typeof window!=='undefined'?window.localStorage.getItem('opsvista-overview-custom-start')||today:today);
  const [customEnd,setCustomEnd]=useState(()=>typeof window!=='undefined'?window.localStorage.getItem('opsvista-overview-custom-end')||today:today);
  const [selectedLocations,setSelectedLocations]=useState<string[]>(()=>{
    if(typeof window==='undefined')return initialLocation==='All locations'?[]:[initialLocation];
    try{
      const saved=JSON.parse(window.localStorage.getItem('opsvista-overview-locations')||'null');
      if(Array.isArray(saved))return saved.filter(item=>typeof item==='string');
    }catch{/* Fall back to the previous single-location preference. */}
    const legacy=window.localStorage.getItem('opsvista-overview-location')||initialLocation;
    return legacy&&legacy!=='All locations'?[legacy]:[];
  });
  const [live,setLive]=useState<LiveResponse|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
  const [refresh,setRefresh]=useState(0);const [readAt,setReadAt]=useState('');
  const [metric,setMetric]=useState<OverviewMetric|null>(null);const [focusLocation,setFocusLocation]=useState('');
  const [detailFocus,setDetailFocus]=useState(0);const detailRef=useRef<HTMLDivElement>(null);
  const triggerRef=useRef<HTMLElement|null>(null);
  const openMetric=(next:OverviewMetric,location='')=>{triggerRef.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setMetric(next);setFocusLocation(location);setDetailFocus(value=>value+1)};
  const closeMetric=()=>{const previous=metric;setMetric(null);if(previous)window.requestAnimationFrame(()=>{const trigger=triggerRef.current; if(trigger?.isConnected)trigger.focus();else document.getElementById(`overview-kpi-${previous}`)?.focus()})};
  useEffect(()=>{if(detailFocus){detailRef.current?.focus({preventScroll:true});detailRef.current?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'nearest'})}},[detailFocus]);
  const resolved=resolveRange(range,customStart,customEnd);
  const selectionKey=selectedLocations.join('|');
  const effectiveLocations=selectedLocations.length?selectedLocations:allowedLocations;
  const effectiveLocationKey=effectiveLocations.join('|');
  const locationLabel=!selectedLocations.length?`${t('All','Todas')} · ${allowedLocations.length} ${t('locations','locaciones')}`:selectedLocations.length===1?selectedLocations[0]:`${selectedLocations.length} ${t('locations','locaciones')}`;
  const toggleLocation=(location:string)=>setSelectedLocations(current=>{const base=current.length?current:allowedLocations;if(base.length===1&&base.includes(location))return base;const next=base.includes(location)?base.filter(item=>item!==location):[...base,location];return next.length===allowedLocations.length?[]:next});

  useEffect(()=>{
    const valid=selectedLocations.filter(location=>allowedLocations.includes(location));
    if(valid.length!==selectedLocations.length)setSelectedLocations(valid);
  },[allowedLocations,selectionKey]);

  useEffect(()=>{
    window.localStorage.setItem('opsvista-overview-range',range);
    window.localStorage.setItem('opsvista-overview-custom-start',customStart);
    window.localStorage.setItem('opsvista-overview-custom-end',customEnd);
    window.localStorage.setItem('opsvista-overview-locations',JSON.stringify(selectedLocations));
  },[range,customStart,customEnd,selectionKey]);

  const {revision:liveRevision,refresh:refreshLabor}=useLaborSnapshotRefresh(!categoriesActive&&!loading&&resolved.start===resolved.end&&resolved.start===easternToday());
  useEffect(()=>{
    if(categoriesActive){setLoading(false);return;}
    const controller=new AbortController();setLoading(true);setError('');setLive(null);
    const params=new URLSearchParams({start:resolved.start,end:resolved.end,salary_basis:'elapsed'});
    if(effectiveLocations.length)params.set('locations',effectiveLocations.join(','));
    fetch(`/api/operations/performance?${params}`,{credentials:'include',cache:'no-store',signal:controller.signal}).then(async response=>{const body=await response.json().catch(()=>({})) as LiveResponse&{error?:string;requiredEnvironmentVariables?:string[]};if(!response.ok)throw new Error(body.error||'Live performance source unavailable');if(!controller.signal.aborted){setLive(body);setReadAt(new Intl.DateTimeFormat('es-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date()))}}).catch(err=>{if(!controller.signal.aborted)setError(err instanceof Error?err.message:'Live performance source unavailable')}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
  },[resolved.start,resolved.end,effectiveLocationKey,refresh,liveRevision,categoriesActive]);

  const total=live?.totals;
  const tasks=live?.taskCompliance??null;
  const tasksError=live?.taskComplianceError||'';
  const metricProps=(key:OverviewMetric)=>({metric:key,active:metric===key,disabled:loading||(key==='tasks'?!tasks:!total),onOpen:openMetric});
  return <div className="overview-dashboard overview-dashboard-visual">
    <section className="overview-filter-panel">
      <div className="overview-filter-heading">
        <div><h2>{salesMode?t('Sales reports','Reportes de ventas'):t('Your operational dashboard','Tu dashboard operativo')}</h2><p>{t('Operating week: Wednesday–Tuesday','Semana operativa: miércoles–martes')}</p></div>
        <div className="overview-filter-controls">
          <details className="location-dashboard-location-picker"><summary><span>{t('LOCATIONS','LOCACIONES')}</span><strong>{locationLabel}</strong></summary><div><label><input type="checkbox" checked={!selectedLocations.length} onChange={()=>setSelectedLocations([])}/>{t('All locations','Todas las locaciones')} ({allowedLocations.length})</label>{allowedLocations.map(location=><label key={location}><input type="checkbox" checked={!selectedLocations.length||selectedLocations.includes(location)} onChange={()=>toggleLocation(location)}/>{location}</label>)}</div></details>
          <select className="overview-period-select" aria-label={t('Overview period','Periodo del resumen')} value={range} onChange={e=>setRange(e.target.value as RangeKey)}><option value="today">{t('Today','Hoy')}</option><option value="yesterday">{t('Yesterday','Ayer')}</option><option value="this-week">{t('This week','Esta semana')}</option><option value="previous-week">{t('Previous week','Semana anterior')}</option><option value="this-month">{t('This month','Este mes')}</option><option value="last-month">{t('Last month','Mes anterior')}</option><option value="custom">{t('Custom range','Periodo personalizado')}</option></select>
          <CustomDateRangePicker active={range==='custom'} start={customStart} end={customEnd} maxDate={today} maxRangeDays={31} onApply={(start,end)=>{setCustomStart(start);setCustomEnd(end);}} ariaLabel={t('Select overview or sales period','Seleccionar periodo de Resumen o Ventas')}/>
          <button type="button" className="overview-refresh" disabled={loading&&!categoriesActive} onClick={()=>setRefresh(value=>value+1)}>{loading&&!categoriesActive?t('Updating…','Actualizando…'):t('Refresh data ↻','Actualizar datos ↻')}</button>
        </div>
      </div>
      <div className="overview-source-strip" data-error={!categoriesActive&&Boolean(error)} role="status"><span><strong>{t(resolved.label,({today:'Hoy',yesterday:'Ayer','this-week':'Esta semana operativa','previous-week':'Semana operativa anterior','this-month':'Este mes','last-month':'Mes anterior',custom:'Periodo personalizado'} as Record<RangeKey,string>)[range])}</strong> · {resolved.start} → {resolved.end}</span><span>{categoriesActive?t('Source: Toast · Sales categories','Fuente: Toast · Categorías de venta'):loading?t('Loading live Toast data…','Consultando datos de Toast…'):error?error:live?`${live.source} · ${t('Checked','Consultado')} ${readAt} ET`:t('Waiting for source','Esperando fuente')}</span></div>
    </section>

    {salesMode&&<div className="sales-category-tabs" aria-label={t('Sales sections','Secciones de Ventas')}><button type="button" aria-pressed={!categoriesActive} onClick={()=>setSalesTab('summary')}>{t('Overview','Resumen')}</button><button type="button" aria-pressed={categoriesActive} onClick={()=>setSalesTab('categories')}>{t('Sales by category','Ventas por categoría')}</button></div>}
    {categoriesActive?<SalesCategoriesPanel start={resolved.start} end={resolved.end} locations={effectiveLocations.filter(location=>allowedLocations.includes(location))} refresh={refresh}/>:<>
    <section className="overview-primary-kpis" aria-label={t('Primary indicators','Indicadores principales')}>
      <Kpi {...metricProps('sales')} label={t('Net sales','Ventas netas')} value={loading?t('Loading…','Cargando…'):total?money.format(total.netSales):t('Pending source','Fuente pendiente')} note={total?`Toast · ${effectiveLocations.length} ${t('locations selected','locaciones seleccionadas')}`:t('Toast connection required','Se requiere conexión con Toast')} status={total?'ready':'pending'} />
      <Kpi {...metricProps('labor')} label={live?.salaryTiming?.applied?t('Labor accrued','Labor acumulado'):t('Total labor','Labor total')} value={loading?t('Loading…','Cargando…'):total?money2.format(total.totalLaborCost):t('Pending source','Fuente pendiente')} note={total?`${total.totalLaborPct.toFixed(2)}% · ${t('Hourly','Por hora')} ${total.hourlyLaborPct.toFixed(2)}% + ${t('Salary','Salarios')} ${total.salaryLaborPct.toFixed(2)}%`:t('Hourly labor + salary allocation','Labor por hora + asignación de salarios')} status={total&&total.totalLaborPct>30?'warning':total?'ready':'pending'} />
      <Kpi {...metricProps('tasks')} label={t('Tasks compliance','Cumplimiento de Tasks')} value={tasks?(tasks.totals.total>0?`${tasks.totals.compliancePct.toFixed(1)}%`:t('No tasks','Sin tareas')):loading?t('Loading…','Cargando…'):tasksError?t('Connection error','Error de conexión'):t('No data','Sin datos')} note={tasks?`${tasks.totals.completed} / ${tasks.totals.total} ${t('tasks completed','tasks completados')} · 7shifts`:tasksError} status={tasks&&tasks.totals.total>0?(tasks.totals.compliancePct>=80?'ready':'warning'):'pending'} />
    </section>
    {loading ? <div className="ov-chart-main-grid" aria-busy="true"><div className="ov-chart-skeleton">{t('Loading sales chart…','Cargando gráfica de ventas…')}</div><div className="ov-chart-skeleton">{t('Loading labor chart…','Cargando gráfica de labor…')}</div></div> : live ? <OverviewCharts rows={live.locations} totals={live.totals} tasks={tasks} salaryConfigured={live.salaryLaborConfigured} onExplore={openMetric}/> : <div className="ov-chart-empty">{t('Charts will be available when operational data can be loaded.','Las gráficas estarán disponibles cuando se puedan consultar los datos operativos.')}</div>}

    <div id="overview-metric-detail" className="overview-detail-region" ref={detailRef} tabIndex={-1} role="region" aria-label="Desglose del indicador" hidden={!metric||!live}>
      {live&&metric&&<OverviewExplorer key={`${metric}:${resolved.start}:${resolved.end}:${effectiveLocationKey}`} metric={metric} rows={live.locations} tasks={tasks} salaryConfigured={live.salaryLaborConfigured} start={live.start} end={live.end} focusLocation={live.locations.some(row=>row.location===focusLocation)?focusLocation:''} onFocusLocation={setFocusLocation} onClose={closeMetric} modules={modules} onOpenModule={onOpenModule}/>}
    </div>

    <details className="overview-disclosure"><summary><span>{t('Costs and supporting indicators','Costos e indicadores de detalle')}</span><small>{t('Hourly · salary · voids · discounts','Por hora · salarios · voids · descuentos')}</small></summary><div className="overview-disclosure-body">
    <section className="overview-secondary-kpis" aria-label={t('Supporting indicators','Indicadores de detalle')}>
      <Kpi {...metricProps('hourly')} label={t('Hourly labor','Labor por hora')} value={loading?t('Loading…','Cargando…'):total?money2.format(total.hourlyLaborCost):t('Pending source','Fuente pendiente')} note={total?`${total.hourlyHours.toFixed(1)} hrs · OT ${total.overtimeHours.toFixed(1)} hrs · ${total.laborPct.toFixed(2)}%`:t('Toast time entries required','Se requieren registros de tiempo de Toast')} status={total&&total.laborPct>30?'warning':total?'ready':'pending'} />
      <Kpi {...metricProps('salary')} label={live?.salaryTiming?.applied?t('Salary accrued','Salarios acumulados'):t('Salary labor','Labor asalariado')} value={loading?t('Loading…','Cargando…'):total?money2.format(total.salaryLaborCost):t('Pending source','Fuente pendiente')} note={total?`${total.salaryLaborPct.toFixed(2)}% · ${live?.notes?.salaryLabor||t('Salary allocation','Asignación de salarios')}`:t('Weekly salary allocation required','Se requiere asignación semanal de salarios')} status={live?.salaryLaborConfigured?'ready':'pending'} />
      <Kpi {...metricProps('voids')} label={t('Voids','Voids')} value={total?`${money2.format(total.voidAmount)} · ${total.voidPct.toFixed(2)}%`:t('Pending source','Fuente pendiente')} note={t('Toast order voids','Voids de órdenes en Toast')} status={total&&total.voidPct>.5?'warning':total?'ready':'pending'} />
      <Kpi {...metricProps('discounts')} label={t('Discounts','Descuentos')} value={total?`${money2.format(total.discountAmount)} · ${total.discountPct.toFixed(2)}%`:t('Pending source','Fuente pendiente')} note={t('Check + item discounts · target ≤ 2.00%','Descuentos de cuenta + ítem · meta ≤ 2.00%')} status={total&&total.discountPct>2?'warning':total?'ready':'pending'} />
    </section>

    </div></details>
    {live?.salaryTiming && <details className="overview-disclosure" open={!live.salaryTiming.applied || Boolean(live.salaryTiming.hoursError)}><summary><span>{t('Salary timing and opening hours','Distribución de salarios y horarios')}</span><small>{live.salaryTiming.applied ? t('Accrued salary included in labor','Salario acumulado incluido en labor') : t('Configuration needs review','Configuración pendiente de revisión')}</small></summary><SalaryTimingPanel data={live.salaryTiming} language={language} onRefresh={refreshLabor}/></details>}

    {live&&<details className="overview-disclosure"><summary><span>{t('Full location comparison','Comparación completa por locación')}</span><small>{t('Sales, costs and productivity in one table','Ventas, costos y productividad en una tabla')}</small></summary><section className="overview-live-table"><div style={{padding:'15px 17px',borderBottom:'1px solid #e5ecf3'}}><strong style={{fontSize:16,color:'#17263a'}}>{t('Location performance','Desempeño por locación')}</strong><div style={{fontSize:12.5,color:'#64748b',marginTop:3}}>{live.start} → {live.end} · Toast Standard API</div></div><div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:900}}><thead><tr>{[t('LOCATION','LOCACIÓN'),t('NET SALES','VENTAS NETAS'),t('HOURLY LABOR','LABOR POR HORA'),t('SALARY LABOR','SALARIOS'),t('TOTAL LABOR','LABOR TOTAL'),'TOTAL %',t('SALES / HOUR','VENTAS / HORA'),'OT HRS','VOIDS',t('DISCOUNTS','DESCUENTOS')].map(h=><th key={h} style={{textAlign:'left',padding:'10px 14px',fontSize:10.5,letterSpacing:'.05em',color:'#64748b',background:'#f8fafc',borderBottom:'1px solid #e5ecf3'}}>{h}</th>)}</tr></thead><tbody>{live.locations.map(row=><tr key={row.location}><td style={{padding:'12px 14px',fontWeight:800,borderBottom:'1px solid #eef2f6'}}><button type="button" className="overview-location-link" onClick={()=>openMetric('sales',row.location)} aria-label={`Explorar ${row.location}`}>{row.location}</button></td><td style={{padding:'12px 14px',fontWeight:750,borderBottom:'1px solid #eef2f6'}}>{money.format(row.netSales)}</td><td style={{padding:'12px 14px',borderBottom:'1px solid #eef2f6'}}>{money2.format(row.hourlyLaborCost)} · {row.hourlyLaborPct.toFixed(2)}%</td><td style={{padding:'12px 14px',borderBottom:'1px solid #eef2f6'}}>{money2.format(row.salaryLaborCost)} · {row.salaryLaborPct.toFixed(2)}%</td><td style={{padding:'12px 14px',fontWeight:800,borderBottom:'1px solid #eef2f6'}}>{money2.format(row.totalLaborCost)}</td><td style={{padding:'12px 14px',fontWeight:800,borderBottom:'1px solid #eef2f6'}}>{row.totalLaborPct.toFixed(2)}%</td><td style={{padding:'12px 14px',borderBottom:'1px solid #eef2f6'}}>{row.splh?money2.format(row.splh):'—'}</td><td style={{padding:'12px 14px',borderBottom:'1px solid #eef2f6'}}>{row.overtimeHours.toFixed(1)}</td><td style={{padding:'12px 14px',borderBottom:'1px solid #eef2f6'}}>{money2.format(row.voidAmount)} · {row.voidPct.toFixed(2)}%</td><td style={{padding:'12px 14px',borderBottom:'1px solid #eef2f6'}}>{money2.format(row.discountAmount)} · {row.discountPct.toFixed(2)}%</td></tr>)}</tbody></table></div></section></details>}

    <section className="overview-data-source"><span className="overview-data-source-label">{t('Data source','Fuente de datos')}</span><strong>{loading?t('Checking operational data…','Consultando datos operativos…'):error?t('Operational source unavailable','Fuente operativa no disponible'):live?t('Toast connected','Toast conectado'):t('Waiting for source','Esperando fuente')}</strong><p>{t('Total labor = hourly labor + salary allocation for the selected period.','Labor total = labor por hora + asignación de salarios del periodo seleccionado.')}</p></section>

    </>}
  </div>;
}
