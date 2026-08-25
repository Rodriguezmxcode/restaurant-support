import { useEffect, useMemo, useState } from 'react';
import CustomDateRangePicker from './CustomDateRangePicker';
import MaxDataInsights from './MaxDataInsights';

type RangeKey='today'|'yesterday'|'this-week'|'previous-week'|'this-month'|'last-month'|'custom';
type BaselineRow={location:string;sales:number;tasks?:number;voidPct?:number;discountPct?:number};
type LiveRow={location:string;netSales:number;discountAmount:number;discountPct:number;voidAmount:number;voidPct:number;hourlyHours:number;overtimeHours:number;hourlyLaborCost:number;salaryLaborCost:number;totalLaborCost:number;laborPct:number;hourlyLaborPct:number;salaryLaborPct:number;totalLaborPct:number;splh:number|null};
type LiveResponse={source:string;start:string;end:string;salaryLaborConfigured:boolean;taskCompliance?:SevenShiftsResponse|null;taskComplianceError?:string;locations:LiveRow[];totals:{netSales:number;discountAmount:number;discountPct:number;voidAmount:number;voidPct:number;hourlyHours:number;overtimeHours:number;hourlyLaborCost:number;salaryLaborCost:number;totalLaborCost:number;laborPct:number;hourlyLaborPct:number;salaryLaborPct:number;totalLaborPct:number;splh:number|null};notes?:{salaryLabor?:string;tasks?:string}};
type SevenShiftsResponse={source:string;totals:{completed:number;total:number;compliancePct:number};locations:Array<{location:string;completed:number;total:number;compliancePct:number}>};
type Props={allowedLocations:string[];allLocations:boolean;initialLocation?:string};

const baselineRows:BaselineRow[]=[
  {location:'Stamford',sales:85461.56,tasks:92.61,voidPct:.26,discountPct:2.20},{location:'Orange',sales:79441.33,tasks:93.39,voidPct:.22,discountPct:3.60},{location:'Fairfield',sales:52178.88,tasks:94.60,voidPct:.10,discountPct:1.96},{location:'Danbury',sales:46985.81,tasks:71.82,voidPct:.85,discountPct:2.08},{location:'Avon',sales:46015.09,tasks:95.37,voidPct:.07,discountPct:2.17},{location:'Southington',sales:37791.11,tasks:50.91,voidPct:.12,discountPct:1.85},
];
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
function Kpi({label,value,note,status='ready'}:{label:string;value:string;note:string;status?:'ready'|'pending'|'warning'}){const accent=status==='warning'?'#b45309':status==='pending'?'#64748b':'#0f766e';return <div style={{background:'#fff',border:'1px solid #dce6f0',borderRadius:14,padding:'16px 17px',minHeight:120,boxShadow:'0 2px 8px rgba(15,23,42,.035)'}}><div style={{fontSize:11,fontWeight:850,letterSpacing:'.055em',color:'#526174'}}>{label}</div><div style={{fontSize:27,fontWeight:850,letterSpacing:'-.035em',color:'#142235',marginTop:9}}>{value}</div><div style={{fontSize:12.5,lineHeight:1.4,color:accent,fontWeight:650,marginTop:7}}>{note}</div></div>}

export default function OperationalOverview({allowedLocations,allLocations,initialLocation='All locations'}:Props){
  const today=useMemo(easternToday,[]);
  const [range,setRange]=useState<RangeKey>(()=>{
    const saved=typeof window!=='undefined'?window.localStorage.getItem('opsvista-overview-range'):null;
    return saved&&['today','yesterday','this-week','previous-week','this-month','last-month','custom'].includes(saved)?saved as RangeKey:'today';
  });
  const [customStart,setCustomStart]=useState(()=>typeof window!=='undefined'?window.localStorage.getItem('opsvista-overview-custom-start')||today:today);
  const [customEnd,setCustomEnd]=useState(()=>typeof window!=='undefined'?window.localStorage.getItem('opsvista-overview-custom-end')||today:today);
  const [location,setLocation]=useState(()=>typeof window!=='undefined'?window.localStorage.getItem('opsvista-overview-location')||initialLocation:initialLocation);
  const [live,setLive]=useState<LiveResponse|null>(null);const [loading,setLoading]=useState(false);const [error,setError]=useState('');
  const resolved=resolveRange(range,customStart,customEnd);
  const visibleBaselineRows=useMemo(()=>baselineRows.filter(r=>allLocations||allowedLocations.includes(r.location)),[allLocations,allowedLocations]);

  useEffect(()=>{
    const validLocations=[...(allLocations?['All locations']:[]),...visibleBaselineRows.map(row=>row.location)];
    if(!validLocations.includes(location))setLocation(validLocations[0]??initialLocation);
  },[allLocations,initialLocation,location,visibleBaselineRows]);

  useEffect(()=>{
    window.localStorage.setItem('opsvista-overview-range',range);
    window.localStorage.setItem('opsvista-overview-custom-start',customStart);
    window.localStorage.setItem('opsvista-overview-custom-end',customEnd);
    window.localStorage.setItem('opsvista-overview-location',location);
  },[range,customStart,customEnd,location]);

  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');setLive(null);
    const params=new URLSearchParams({start:resolved.start,end:resolved.end,location});
    fetch(`/api/operations/performance?${params}`,{credentials:'include',cache:'no-store',signal:controller.signal}).then(async response=>{const body=await response.json().catch(()=>({})) as LiveResponse&{error?:string;requiredEnvironmentVariables?:string[]};if(!response.ok)throw new Error(body.error||'Live performance source unavailable');setLive(body)}).catch(err=>{if(err?.name!=='AbortError')setError(err instanceof Error?err.message:'Live performance source unavailable')}).finally(()=>setLoading(false));
    return()=>controller.abort();
  },[resolved.start,resolved.end,location]);

  const total=live?.totals;
  const tasks=live?.taskCompliance??null;
  const tasksError=live?.taskComplianceError||'';
  return <div style={{display:'grid',gap:16}}>
    <section style={{background:'#fff',border:'1px solid #dce6f0',borderRadius:14,padding:16}}><div style={{display:'flex',gap:10,alignItems:'end',justifyContent:'space-between',flexWrap:'wrap'}}><div><div style={{fontSize:11,fontWeight:900,letterSpacing:'.07em',color:'#0f766e'}}>OPERATIONAL PERFORMANCE</div><h2 style={{fontSize:22,margin:'5px 0 3px',color:'#142235'}}>Performance Dashboard</h2><div style={{fontSize:13,color:'#64748b'}}>Wednesday–Tuesday operating week · live Toast data follows the selected range.</div></div><div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}><select value={location} onChange={e=>setLocation(e.target.value)} style={{padding:'9px 11px',border:'1px solid #cbd8e6',borderRadius:9,fontWeight:700,color:'#233247',background:'#fff'}}>{allLocations&&<option>All locations</option>}{visibleBaselineRows.map(r=><option key={r.location}>{r.location}</option>)}</select><select value={range} onChange={e=>setRange(e.target.value as RangeKey)} style={{padding:'9px 11px',border:'1px solid #cbd8e6',borderRadius:9,fontWeight:700,color:'#233247',background:'#fff'}}><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="this-week">This week</option><option value="previous-week">Previous week</option><option value="this-month">This month</option><option value="last-month">Last month</option><option value="custom">Custom range</option></select><CustomDateRangePicker active={range==='custom'} start={customStart} end={customEnd} maxDate={today} maxRangeDays={31} onApply={(start,end)=>{setCustomStart(start);setCustomEnd(end);}} ariaLabel="Seleccionar periodo de Resumen o Ventas"/></div></div><div style={{marginTop:13,padding:'9px 11px',borderRadius:9,background:error?'#fff7ed':'#f0fdfa',fontSize:12.5,color:error?'#9a3412':'#115e59',display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><span><strong>{resolved.label}</strong> · {resolved.start} → {resolved.end}</span><span>{loading?'Loading live Toast data…':error?error:live?`Live · ${live.source}`:'Waiting for source'}</span></div></section>

    <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12}}>
      <Kpi label="NET SALES" value={loading?'Loading…':total?money.format(total.netSales):'Pending source'} note={total?`Live Toast · ${resolved.start} → ${resolved.end}`:'Toast Standard API connection required'} status={total?'ready':'pending'} />
      <Kpi label="HOURLY LABOR" value={loading?'Loading…':total?money2.format(total.hourlyLaborCost):'Pending source'} note={total?`${total.hourlyHours.toFixed(1)} hrs · OT ${total.overtimeHours.toFixed(1)} hrs · ${total.laborPct.toFixed(2)}%`:'Toast time entries required'} status={total&&total.laborPct>30?'warning':total?'ready':'pending'} />
      <Kpi label="SALARY LABOR" value={loading?'Loading…':total?money2.format(total.salaryLaborCost):'Pending source'} note={total?`${total.salaryLaborPct.toFixed(2)}% · ${live?.notes?.salaryLabor||'Salary allocation'}`:'Weekly salary allocation required'} status={live?.salaryLaborConfigured?'ready':'pending'} />
      <Kpi label="TOTAL LABOR" value={loading?'Loading…':total?money2.format(total.totalLaborCost):'Pending source'} note={total?`${total.totalLaborPct.toFixed(2)}% · Hourly ${total.hourlyLaborPct.toFixed(2)}% + Salary ${total.salaryLaborPct.toFixed(2)}%`:'Hourly + salary labor combined automatically'} status={total&&total.totalLaborPct>30?'warning':total?'ready':'pending'} />
      <Kpi label="TASKS COMPLIANCE" value={tasks?`${tasks.totals.compliancePct.toFixed(1)}%`:tasksError?'Connection error':'Loading…'} note={tasks?`${tasks.totals.completed} of ${tasks.totals.total} tasks completed · Live 7shifts`:tasksError} status={tasks?(tasks.totals.compliancePct>=80?'ready':'warning'):'pending'} />
      <Kpi label="VOIDS" value={total?`${money2.format(total.voidAmount)} · ${total.voidPct.toFixed(2)}%`:'Pending source'} note="Live Toast order void calculation" status={total&&total.voidPct>.5?'warning':total?'ready':'pending'} />
      <Kpi label="DISCOUNTS" value={total?`${money2.format(total.discountAmount)} · ${total.discountPct.toFixed(2)}%`:'Pending source'} note="Live active check + item discounts · target ≤ 2.00%" status={total&&total.discountPct>2?'warning':total?'ready':'pending'} />
    </section>

    {live&&<MaxDataInsights title="Performance que conduce a una decisión" subtitle="Ventas y labor en la misma escala comparativa; cualquier marca filtra gráficos, mapa, conclusiones y tabla." rows={live.locations.map(row=>({location:row.location,primary:row.netSales,secondary:row.totalLaborPct,status:row.totalLaborPct>30?'bad':row.totalLaborPct>27?'watch':'good'}))} primaryLabel="Ventas netas" secondaryLabel="Labor total" primaryColorScale="higher-is-better" primaryFormat={value=>money.format(value)} secondaryFormat={value=>`${value.toFixed(1)}%`} conclusion={rows=>{if(!rows.length)return['Sin datos verificables para este filtro.'];const sales=[...rows].sort((a,b)=>b.primary-a.primary);const labor=[...rows].filter(row=>row.secondary!=null).sort((a,b)=>(b.secondary??0)-(a.secondary??0));const atRisk=rows.filter(row=>row.status!=='good');return[`${sales[0].location} concentra la mayor venta: ${money.format(sales[0].primary)}.`,labor.length?`${labor[0].location} registra la mayor presión de labor: ${(labor[0].secondary??0).toFixed(1)}%.`:'Labor aún no disponible.',atRisk.length?`${atRisk.length} locación${atRisk.length===1?'':'es'} requiere${atRisk.length===1?'':'n'} revisar labor antes de reducir cobertura.`:'Todas las locaciones visibles están dentro del guardrail de labor.'];}}/>}

    {live&&<section style={{background:'#fff',border:'1px solid #dce6f0',borderRadius:14,overflow:'hidden'}}><div style={{padding:'15px 17px',borderBottom:'1px solid #e5ecf3'}}><strong style={{fontSize:16,color:'#17263a'}}>Live location performance</strong><div style={{fontSize:12.5,color:'#64748b',marginTop:3}}>{live.start} → {live.end} · Toast Standard API</div></div><div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:900}}><thead><tr>{['LOCATION','NET SALES','HOURLY LABOR','SALARY LABOR','TOTAL LABOR','TOTAL %','SPLH','OT HRS','VOIDS','DISCOUNTS'].map(h=><th key={h} style={{textAlign:'left',padding:'10px 14px',fontSize:10.5,letterSpacing:'.05em',color:'#64748b',background:'#f8fafc',borderBottom:'1px solid #e5ecf3'}}>{h}</th>)}</tr></thead><tbody>{live.locations.map(row=><tr key={row.location}><td style={{padding:'12px 14px',fontWeight:800,borderBottom:'1px solid #eef2f6'}}>{row.location}</td><td style={{padding:'12px 14px',fontWeight:750,borderBottom:'1px solid #eef2f6'}}>{money.format(row.netSales)}</td><td style={{padding:'12px 14px',borderBottom:'1px solid #eef2f6'}}>{money2.format(row.hourlyLaborCost)} · {row.hourlyLaborPct.toFixed(2)}%</td><td style={{padding:'12px 14px',borderBottom:'1px solid #eef2f6'}}>{money2.format(row.salaryLaborCost)} · {row.salaryLaborPct.toFixed(2)}%</td><td style={{padding:'12px 14px',fontWeight:800,borderBottom:'1px solid #eef2f6'}}>{money2.format(row.totalLaborCost)}</td><td style={{padding:'12px 14px',fontWeight:800,borderBottom:'1px solid #eef2f6'}}>{row.totalLaborPct.toFixed(2)}%</td><td style={{padding:'12px 14px',borderBottom:'1px solid #eef2f6'}}>{row.splh?money2.format(row.splh):'—'}</td><td style={{padding:'12px 14px',borderBottom:'1px solid #eef2f6'}}>{row.overtimeHours.toFixed(1)}</td><td style={{padding:'12px 14px',borderBottom:'1px solid #eef2f6'}}>{money2.format(row.voidAmount)} · {row.voidPct.toFixed(2)}%</td><td style={{padding:'12px 14px',borderBottom:'1px solid #eef2f6'}}>{money2.format(row.discountAmount)} · {row.discountPct.toFixed(2)}%</td></tr>)}</tbody></table></div></section>}

    <section style={{background:'#132238',color:'#fff',borderRadius:14,padding:17}}><div style={{fontSize:10.5,fontWeight:850,letterSpacing:'.06em',opacity:.68}}>DATA SOURCE STATUS</div><div style={{fontSize:18,fontWeight:850,marginTop:8}}>{live?'Toast live feed connected':'Toast live feed awaiting environment configuration'}</div><p style={{fontSize:13,lineHeight:1.5,opacity:.82,margin:'7px 0 0'}}>Sales, hourly labor and salary allocation are calculated server-side. Total Labor always equals Hourly Labor + Salary Labor for the selected period.</p></section>

  </div>;
}
