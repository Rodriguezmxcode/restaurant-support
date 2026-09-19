import { useEffect, useMemo, useRef, useState } from 'react';
import CustomDateRangePicker from './CustomDateRangePicker';
import './locationDashboard.css';
import MaxDataInsights from './MaxDataInsights';
import OverviewExplorer, { type OverviewMetric } from './OverviewExplorer';
import type { OpsVistaModule } from './accessControl';

type RangeKey='today'|'yesterday'|'this-week'|'previous-week'|'this-month'|'last-month'|'custom';
export type LiveRow={location:string;netSales:number;discountAmount:number;discountPct:number;voidAmount:number;voidPct:number;hourlyHours:number;overtimeHours:number;hourlyLaborCost:number;salaryLaborCost:number;totalLaborCost:number;laborPct:number;hourlyLaborPct:number;salaryLaborPct:number;totalLaborPct:number;splh:number|null};
type LiveResponse={source:string;start:string;end:string;salaryLaborConfigured:boolean;taskCompliance?:SevenShiftsResponse|null;taskComplianceError?:string;locations:LiveRow[];totals:{netSales:number;discountAmount:number;discountPct:number;voidAmount:number;voidPct:number;hourlyHours:number;overtimeHours:number;hourlyLaborCost:number;salaryLaborCost:number;totalLaborCost:number;laborPct:number;hourlyLaborPct:number;salaryLaborPct:number;totalLaborPct:number;splh:number|null};notes?:{salaryLabor?:string;tasks?:string}};
export type SevenShiftsResponse={source:string;totals:{completed:number;total:number;compliancePct:number};locations:Array<{location:string;completed:number;total:number;compliancePct:number}>};
type Props={allowedLocations:string[];allLocations:boolean;initialLocation?:string;modules?:OpsVistaModule[];onOpenModule?:(module:OpsVistaModule)=>void};

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
  const accent=status==='warning'?'#b45309':status==='pending'?'#64748b':'#0f766e';
  return <button type="button" id={`overview-kpi-${metric}`} className="overview-kpi" aria-pressed={active} aria-controls="overview-metric-detail" disabled={disabled} onClick={()=>onOpen(metric)}><span className="overview-kpi-label">{label}</span><strong className="overview-kpi-value">{value}</strong><span className="overview-kpi-note" style={{color:accent}}>{note}</span><span className="overview-kpi-action">{disabled?'Esperando datos':active?'Viendo desglose ↓':'Explorar por locación →'}</span></button>;
}

export default function OperationalOverview({allowedLocations,initialLocation='All locations',modules,onOpenModule}:Props){
  const today=useMemo(easternToday,[]);
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
  const openMetric=(next:OverviewMetric,location='')=>{setMetric(next);setFocusLocation(location);setDetailFocus(value=>value+1)};
  const closeMetric=()=>{const previous=metric;setMetric(null);if(previous)window.requestAnimationFrame(()=>document.getElementById(`overview-kpi-${previous}`)?.focus())};
  useEffect(()=>{if(detailFocus){detailRef.current?.focus({preventScroll:true});detailRef.current?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'nearest'})}},[detailFocus]);
  const resolved=resolveRange(range,customStart,customEnd);
  const selectionKey=selectedLocations.join('|');
  const effectiveLocations=selectedLocations.length?selectedLocations:allowedLocations;
  const effectiveLocationKey=effectiveLocations.join('|');
  const locationLabel=!selectedLocations.length?`Todas · ${allowedLocations.length} locaciones`:selectedLocations.length===1?selectedLocations[0]:`${selectedLocations.length} locaciones`;
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

  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');setLive(null);
    const params=new URLSearchParams({start:resolved.start,end:resolved.end});
    if(effectiveLocations.length)params.set('locations',effectiveLocations.join(','));
    fetch(`/api/operations/performance?${params}`,{credentials:'include',cache:'no-store',signal:controller.signal}).then(async response=>{const body=await response.json().catch(()=>({})) as LiveResponse&{error?:string;requiredEnvironmentVariables?:string[]};if(!response.ok)throw new Error(body.error||'Live performance source unavailable');if(!controller.signal.aborted){setLive(body);setReadAt(new Intl.DateTimeFormat('es-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date()))}}).catch(err=>{if(!controller.signal.aborted)setError(err instanceof Error?err.message:'Live performance source unavailable')}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
  },[resolved.start,resolved.end,effectiveLocationKey,refresh]);

  const total=live?.totals;
  const tasks=live?.taskCompliance??null;
  const tasksError=live?.taskComplianceError||'';
  const metricProps=(key:OverviewMetric)=>({metric:key,active:metric===key,disabled:loading||(key==='tasks'?!tasks:!total),onOpen:openMetric});
  return <div style={{display:'grid',gap:16}}>
    <section style={{background:'#fff',border:'1px solid #dce6f0',borderRadius:14,padding:16}}><div style={{display:'flex',gap:10,alignItems:'end',justifyContent:'space-between',flexWrap:'wrap'}}><div><div style={{fontSize:11,fontWeight:900,letterSpacing:'.07em',color:'#0f766e'}}>OPERATIONAL PERFORMANCE</div><h2 style={{fontSize:22,margin:'5px 0 3px',color:'#142235'}}>Performance Dashboard</h2><div style={{fontSize:13,color:'#64748b'}}>Wednesday–Tuesday operating week · live Toast data follows the selected range.</div></div><div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}><details className="location-dashboard-location-picker"><summary><span>LOCACIONES</span><strong>{locationLabel}</strong></summary><div><label><input type="checkbox" checked={!selectedLocations.length} onChange={()=>setSelectedLocations([])}/>Todas las locaciones ({allowedLocations.length})</label>{allowedLocations.map(location=><label key={location}><input type="checkbox" checked={!selectedLocations.length||selectedLocations.includes(location)} onChange={()=>toggleLocation(location)}/>{location}</label>)}</div></details><select aria-label="Periodo del resumen" value={range} onChange={e=>setRange(e.target.value as RangeKey)} style={{padding:'9px 11px',height:52,border:'1px solid #cbd8e6',borderRadius:9,fontWeight:700,color:'#233247',background:'#fff'}}><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="this-week">This week</option><option value="previous-week">Previous week</option><option value="this-month">This month</option><option value="last-month">Last month</option><option value="custom">Custom range</option></select><CustomDateRangePicker active={range==='custom'} start={customStart} end={customEnd} maxDate={today} maxRangeDays={31} onApply={(start,end)=>{setCustomStart(start);setCustomEnd(end);}} ariaLabel="Seleccionar periodo de Resumen o Ventas"/><button type="button" className="overview-refresh" disabled={loading} onClick={()=>setRefresh(value=>value+1)}>{loading?'Actualizando…':'Actualizar datos ↻'}</button></div></div><div className="location-dashboard-scope"><strong>Incluye {effectiveLocations.length} locación{effectiveLocations.length===1?'':'es'}:</strong><span>{effectiveLocations.join(' · ')}</span></div><div style={{marginTop:10,padding:'9px 11px',borderRadius:9,background:error?'#fff7ed':'#f0fdfa',fontSize:12.5,color:error?'#9a3412':'#115e59',display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><span><strong>{resolved.label}</strong> · {resolved.start} → {resolved.end}</span><span>{loading?'Loading live Toast data…':error?error:live?`Live · ${live.source} · Consultado ${readAt} ET`:'Waiting for source'}</span></div></section>

    <p className="overview-drill-hint">Toca una tarjeta para explorar su desglose, ordenar locaciones y revisar excepciones.</p>
    <section aria-label="Indicadores interactivos" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12}}>
      <Kpi {...metricProps('sales')} label="NET SALES" value={loading?'Loading…':total?money.format(total.netSales):'Pending source'} note={total?`Live Toast · ${effectiveLocations.length} locaciones · ${resolved.start} → ${resolved.end}`:'Toast Standard API connection required'} status={total?'ready':'pending'} />
      <Kpi {...metricProps('hourly')} label="HOURLY LABOR" value={loading?'Loading…':total?money2.format(total.hourlyLaborCost):'Pending source'} note={total?`${total.hourlyHours.toFixed(1)} hrs · OT ${total.overtimeHours.toFixed(1)} hrs · ${total.laborPct.toFixed(2)}%`:'Toast time entries required'} status={total&&total.laborPct>30?'warning':total?'ready':'pending'} />
      <Kpi {...metricProps('salary')} label="SALARY LABOR" value={loading?'Loading…':total?money2.format(total.salaryLaborCost):'Pending source'} note={total?`${total.salaryLaborPct.toFixed(2)}% · ${live?.notes?.salaryLabor||'Salary allocation'}`:'Weekly salary allocation required'} status={live?.salaryLaborConfigured?'ready':'pending'} />
      <Kpi {...metricProps('labor')} label="TOTAL LABOR" value={loading?'Loading…':total?money2.format(total.totalLaborCost):'Pending source'} note={total?`${total.totalLaborPct.toFixed(2)}% · Hourly ${total.hourlyLaborPct.toFixed(2)}% + Salary ${total.salaryLaborPct.toFixed(2)}%`:'Hourly + salary labor combined automatically'} status={total&&total.totalLaborPct>30?'warning':total?'ready':'pending'} />
      <Kpi {...metricProps('tasks')} label="TASKS COMPLIANCE" value={tasks?(tasks.totals.total>0?`${tasks.totals.compliancePct.toFixed(1)}%`:'Sin tareas'):loading?'Loading…':tasksError?'Connection error':'Sin datos'} note={tasks?`${tasks.totals.completed} of ${tasks.totals.total} tasks completed · Live 7shifts`:tasksError} status={tasks&&tasks.totals.total>0?(tasks.totals.compliancePct>=80?'ready':'warning'):'pending'} />
      <Kpi {...metricProps('voids')} label="VOIDS" value={total?`${money2.format(total.voidAmount)} · ${total.voidPct.toFixed(2)}%`:'Pending source'} note="Live Toast order void calculation" status={total&&total.voidPct>.5?'warning':total?'ready':'pending'} />
      <Kpi {...metricProps('discounts')} label="DISCOUNTS" value={total?`${money2.format(total.discountAmount)} · ${total.discountPct.toFixed(2)}%`:'Pending source'} note="Live active check + item discounts · target ≤ 2.00%" status={total&&total.discountPct>2?'warning':total?'ready':'pending'} />
    </section>

    <div id="overview-metric-detail" className="overview-detail-region" ref={detailRef} tabIndex={-1} role="region" aria-label="Desglose del indicador" hidden={!metric||!live}>
      {live&&metric&&<OverviewExplorer key={`${metric}:${resolved.start}:${resolved.end}:${effectiveLocationKey}`} metric={metric} rows={live.locations} tasks={tasks} salaryConfigured={live.salaryLaborConfigured} start={live.start} end={live.end} focusLocation={live.locations.some(row=>row.location===focusLocation)?focusLocation:''} onFocusLocation={setFocusLocation} onClose={closeMetric} modules={modules} onOpenModule={onOpenModule}/>}
    </div>

    {live&&<MaxDataInsights title="Performance que conduce a una decisión" subtitle="Ventas y labor en la misma escala comparativa; cualquier marca filtra gráficos, mapa, conclusiones y tabla." rows={live.locations.map(row=>({location:row.location,primary:row.netSales,secondary:row.totalLaborPct,status:row.totalLaborPct>30?'bad':row.totalLaborPct>27?'watch':'good'}))} primaryLabel="Ventas netas" secondaryLabel="Labor total" primaryColorScale="higher-is-better" primaryFormat={value=>money.format(value)} secondaryFormat={value=>`${value.toFixed(1)}%`} conclusion={rows=>{if(!rows.length)return['Sin datos verificables para este filtro.'];const sales=[...rows].sort((a,b)=>b.primary-a.primary);const labor=[...rows].filter(row=>row.secondary!=null).sort((a,b)=>(b.secondary??0)-(a.secondary??0));const atRisk=rows.filter(row=>row.status!=='good');return[`${sales[0].location} concentra la mayor venta: ${money.format(sales[0].primary)}.`,labor.length?`${labor[0].location} registra la mayor presión de labor: ${(labor[0].secondary??0).toFixed(1)}%.`:'Labor aún no disponible.',atRisk.length?`${atRisk.length} locación${atRisk.length===1?'':'es'} requiere${atRisk.length===1?'':'n'} revisar labor antes de reducir cobertura.`:'Todas las locaciones visibles están dentro del guardrail de labor.'];}}/>}

    {live&&<section style={{background:'#fff',border:'1px solid #dce6f0',borderRadius:14,overflow:'hidden'}}><div style={{padding:'15px 17px',borderBottom:'1px solid #e5ecf3'}}><strong style={{fontSize:16,color:'#17263a'}}>Live location performance</strong><div style={{fontSize:12.5,color:'#64748b',marginTop:3}}>{live.start} → {live.end} · Toast Standard API</div></div><div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:900}}><thead><tr>{['LOCATION','NET SALES','HOURLY LABOR','SALARY LABOR','TOTAL LABOR','TOTAL %','SPLH','OT HRS','VOIDS','DISCOUNTS'].map(h=><th key={h} style={{textAlign:'left',padding:'10px 14px',fontSize:10.5,letterSpacing:'.05em',color:'#64748b',background:'#f8fafc',borderBottom:'1px solid #e5ecf3'}}>{h}</th>)}</tr></thead><tbody>{live.locations.map(row=><tr key={row.location}><td style={{padding:'12px 14px',fontWeight:800,borderBottom:'1px solid #eef2f6'}}><button type="button" className="overview-location-link" onClick={()=>openMetric('sales',row.location)} aria-label={`Explorar ${row.location}`}>{row.location}</button></td><td style={{padding:'12px 14px',fontWeight:750,borderBottom:'1px solid #eef2f6'}}>{money.format(row.netSales)}</td><td style={{padding:'12px 14px',borderBottom:'1px solid #eef2f6'}}>{money2.format(row.hourlyLaborCost)} · {row.hourlyLaborPct.toFixed(2)}%</td><td style={{padding:'12px 14px',borderBottom:'1px solid #eef2f6'}}>{money2.format(row.salaryLaborCost)} · {row.salaryLaborPct.toFixed(2)}%</td><td style={{padding:'12px 14px',fontWeight:800,borderBottom:'1px solid #eef2f6'}}>{money2.format(row.totalLaborCost)}</td><td style={{padding:'12px 14px',fontWeight:800,borderBottom:'1px solid #eef2f6'}}>{row.totalLaborPct.toFixed(2)}%</td><td style={{padding:'12px 14px',borderBottom:'1px solid #eef2f6'}}>{row.splh?money2.format(row.splh):'—'}</td><td style={{padding:'12px 14px',borderBottom:'1px solid #eef2f6'}}>{row.overtimeHours.toFixed(1)}</td><td style={{padding:'12px 14px',borderBottom:'1px solid #eef2f6'}}>{money2.format(row.voidAmount)} · {row.voidPct.toFixed(2)}%</td><td style={{padding:'12px 14px',borderBottom:'1px solid #eef2f6'}}>{money2.format(row.discountAmount)} · {row.discountPct.toFixed(2)}%</td></tr>)}</tbody></table></div></section>}

    <section style={{background:'#132238',color:'#fff',borderRadius:14,padding:17}}><div style={{fontSize:10.5,fontWeight:850,letterSpacing:'.06em',opacity:.68}}>DATA SOURCE STATUS</div><div style={{fontSize:18,fontWeight:850,marginTop:8}}>{live?'Toast live feed connected':loading?'Consultando datos operativos…':'Datos operativos no disponibles'}</div><p style={{fontSize:13,lineHeight:1.5,opacity:.82,margin:'7px 0 0'}}>Sales, hourly labor and salary allocation are calculated server-side. Total Labor always equals Hourly Labor + Salary Labor for the selected period.</p></section>

  </div>;
}
