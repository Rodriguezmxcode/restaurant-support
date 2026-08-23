import { useEffect, useMemo, useState } from 'react';
import { calculateWeeklyBonus } from './bonusEngine';
import CustomDateRangePicker from './CustomDateRangePicker';

type Period='today'|'yesterday'|'this-week'|'previous-week'|'this-month'|'last-30-days'|'custom';
type TaskLocation={locationName:string;completionPct:number|null};
type TaskResponse={locations?:TaskLocation[];error?:string};
type ToastLocation={location:string;discountPct:number;bonusDiscountPct?:number;bonusDiscountAmount?:number;uberEatsDiscountAmount?:number;voidPct:number;overtimeLaborPct?:number};
type ToastResponse={locations?:ToastLocation[];error?:string};
type Row={location:string;tasks?:number;discounts?:number;uberEatsExcluded?:number;voids?:number;ot?:number;points:number;availableMax:number;failed:string[]};

const locationsDefault=['Stamford','Orange','Fairfield','Danbury','Avon','Southington'];
const pct=(v:number|undefined,digits=1)=>v===undefined?'Pending':`${v.toFixed(digits)}%`;
const iso=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function selectedRange(key:Period,customStart:string,customEnd:string){const now=new Date();const sinceWed=(now.getDay()-3+7)%7;const weekStart=new Date(now.getFullYear(),now.getMonth(),now.getDate()-sinceWed);if(key==='custom')return{start:customStart,end:customEnd};if(key==='today')return{start:iso(now),end:iso(now)};if(key==='yesterday'){const yesterday=new Date(now);yesterday.setDate(yesterday.getDate()-1);return{start:iso(yesterday),end:iso(yesterday)}}if(key==='this-month')return{start:iso(new Date(now.getFullYear(),now.getMonth(),1)),end:iso(now)};if(key==='last-30-days'){const start=new Date(now);start.setDate(start.getDate()-29);return{start:iso(start),end:iso(now)}}if(key==='previous-week'){const start=new Date(weekStart);start.setDate(start.getDate()-7);const end=new Date(start);end.setDate(end.getDate()+6);return{start:iso(start),end:iso(end)}}return{start:iso(weekStart),end:iso(now)};}

export default function WeeklyBonusLivePanel({allowedLocations}:{allowedLocations?:string[]}){
  const today=iso(new Date());
  const [period,setPeriod]=useState<Period>(()=>{if(typeof window==='undefined'||!window.localStorage.getItem('opsvista-bonus-period-v2'))return'today';const saved=window.localStorage.getItem('opsvista-bonus-period')??window.sessionStorage.getItem('opsvista-bonus-period');return saved&&['today','yesterday','this-week','previous-week','this-month','last-30-days','custom'].includes(saved)?saved as Period:'today'});
  const [customStart,setCustomStart]=useState(()=>typeof window!=='undefined'?(window.localStorage.getItem('opsvista-bonus-custom-start')||today):today);
  const [customEnd,setCustomEnd]=useState(()=>typeof window!=='undefined'?(window.localStorage.getItem('opsvista-bonus-custom-end')||today):today);
  const [selected,setSelected]=useState(()=>typeof window!=='undefined'?window.sessionStorage.getItem('opsvista-bonus-location')||'All locations':'All locations');
  const range=useMemo(()=>selectedRange(period,customStart,customEnd),[period,customStart,customEnd]);
  const rangeDays=Math.floor((Date.parse(`${range.end}T00:00:00Z`)-Date.parse(`${range.start}T00:00:00Z`))/86400000)+1;
  const rangeError=!range.start||!range.end||rangeDays<1?'Selecciona una fecha inicial y final válidas.':rangeDays>31?'El rango personalizado puede incluir hasta 31 días.':undefined;
  const [tasks,setTasks]=useState<TaskResponse>({});const [toast,setToast]=useState<ToastResponse>({});const [loading,setLoading]=useState(true);
  const scope=allowedLocations?.length?allowedLocations:locationsDefault;
  useEffect(()=>{window.sessionStorage.setItem('opsvista-bonus-period',period);window.localStorage.setItem('opsvista-bonus-period',period);window.localStorage.setItem('opsvista-bonus-period-v2','1');window.localStorage.setItem('opsvista-bonus-custom-start',customStart);window.localStorage.setItem('opsvista-bonus-custom-end',customEnd)},[period,customStart,customEnd]);
  useEffect(()=>{window.sessionStorage.setItem('opsvista-bonus-location',selected)},[selected]);
  useEffect(()=>{if(selected!=='All locations'&&!scope.includes(selected))setSelected('All locations')},[selected,scope.join('|')]);
  useEffect(()=>{if(rangeError){setLoading(false);return}let cancelled=false;const run=async()=>{setLoading(true);const qs=new URLSearchParams({start:range.start,end:range.end});const [tr,sr]=await Promise.allSettled([fetch(`/api/tasks/weekly?${qs}`,{credentials:'include',cache:'no-store'}),fetch(`/api/operations/performance?${qs}`,{credentials:'include',cache:'no-store'})]);
    if(cancelled)return;
    if(tr.status==='fulfilled'){const b=await tr.value.json().catch(()=>({})) as TaskResponse;setTasks(b);}else setTasks({error:'7shifts unavailable'});
    if(sr.status==='fulfilled'){const b=await sr.value.json().catch(()=>({})) as ToastResponse;setToast(b);}else setToast({error:'Toast unavailable'});
    setLoading(false);};void run();return()=>{cancelled=true};},[range.start,range.end,rangeError]);
  const visibleScope=selected==='All locations'?scope:[selected];
  const rows=useMemo<Row[]>(()=>visibleScope.map(location=>{
    const t=tasks.locations?.find(x=>x.locationName.toLowerCase().includes(location.toLowerCase())||location.toLowerCase().includes(x.locationName.toLowerCase()))?.completionPct??undefined;
    const s=toast.locations?.find(x=>x.location.toLowerCase().includes(location.toLowerCase())||location.toLowerCase().includes(x.location.toLowerCase()));
    const bonusDiscountPct=s?.bonusDiscountPct;
    const result=calculateWeeklyBonus({tasksPct:t??undefined,discountsPct:bonusDiscountPct,voidsPct:s?.voidPct,overtimeLaborPct:s?.overtimeLaborPct});
    const ready=result.metrics.filter(m=>m.ready);return{location,tasks:t??undefined,discounts:bonusDiscountPct,uberEatsExcluded:s?.uberEatsDiscountAmount,voids:s?.voidPct,ot:s?.overtimeLaborPct,points:ready.reduce((n,m)=>n+(m.points??0),0),availableMax:ready.reduce((n,m)=>n+m.weight,0),failed:result.eligibilityReasons};
  }).sort((a,b)=>{const aScore=a.availableMax?a.points/a.availableMax:-1;const bScore=b.availableMax?b.points/b.availableMax:-1;return bScore-aScore||b.points-a.points||a.location.localeCompare(b.location)}),[visibleScope.join('|'),tasks,toast]);
  return <section className="panel" style={{marginBottom:16}}><div className="panel-header"><div><h2>Bono semanal · Live Scorecard</h2><p>{range.start} → {range.end} · Todas las métricas corresponden al mismo periodo seleccionado.</p></div><div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}><span className="count-pill">{loading?'SYNCING':'LIVE SOURCES'}</span><select value={period} onChange={e=>setPeriod(e.target.value as Period)}><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="this-week">This week</option><option value="previous-week">Prior week</option><option value="this-month">This month</option><option value="last-30-days">Last 30 days</option><option value="custom">Custom</option></select><CustomDateRangePicker active={period==='custom'} start={customStart} end={customEnd} maxDate={today} maxRangeDays={31} onApply={(start,end)=>{setCustomStart(start);setCustomEnd(end);}} ariaLabel="Seleccionar periodo de Bono semanal"/><select value={selected} onChange={e=>setSelected(e.target.value)}><option>All locations</option>{scope.map(location=><option key={location}>{location}</option>)}</select></div></div><div style={{padding:18,display:'grid',gap:12}}>
    {rangeError&&<div className="detail-block"><label>RANGO DE FECHAS</label><p>{rangeError}</p></div>}
    {(tasks.error||toast.error)&&<div className="detail-block"><label>ESTADO DE FUENTES</label><p>{tasks.error?`7shifts: ${tasks.error}. `:''}{toast.error?`Toast: ${toast.error}.`:''}</p><p style={{color:'#64748b'}}>Las fuentes faltantes permanecen pendientes; OpsVista no sustituye números demo.</p></div>}
    <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:1080}}><thead><tr>{['RANK','LOCATION','TASKS · 35','DISCOUNTS SIN UBER EATS · 20','VOIDS · 15','OT · 15','LIVE POINTS','ELIGIBILITY GATES','REMAINING'].map(h=><th key={h} style={{textAlign:'left',padding:10,borderBottom:'1px solid #e2e8f0'}}>{h}</th>)}</tr></thead><tbody>{rows.map((r,index)=><tr key={r.location}><td style={{padding:10,fontWeight:900}}>#{index+1}</td><td style={{padding:10,fontWeight:850}}>{r.location}</td><td style={{padding:10,fontWeight:700}}>{pct(r.tasks)}</td><td style={{padding:10}}><strong>{pct(r.discounts,2)}</strong><small style={{display:'block',marginTop:3,color:'#64748b'}}>{r.uberEatsExcluded===undefined?'Exclusión pendiente':`${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(r.uberEatsExcluded)} Uber Eats excluido`}</small></td><td style={{padding:10}}>{pct(r.voids,2)}</td><td style={{padding:10}}>{pct(r.ot,2)}</td><td style={{padding:10,fontWeight:850}}>{r.availableMax?`${r.points.toFixed(1)} / ${r.availableMax}`:'Pending'}</td><td style={{padding:10,fontWeight:800,color:r.failed.length?'#b45309':'#166534'}}>{r.failed.length?r.failed.join(' · '):r.availableMax>=85?'PASS SO FAR':'Pending sources'}</td><td style={{padding:10,color:'#64748b'}}>Liquor 5 + Leadership 10</td></tr>)}</tbody></table></div>
    <div style={{fontSize:12,color:'#64748b'}}>Ranking de mayor a menor según el porcentaje de puntos disponibles (Live Points ÷ Available Max). Para calificar Discounts, OpsVista usa descuentos controlables ÷ ventas netas y excluye promociones identificadas por Toast como Uber Eats. Ventas y los demás módulos conservan el descuento total. El subtotal en vivo puede alcanzar 85 puntos: Tasks 35 + Discounts 20 + Voids 15 + OT 15.</div>
  </div></section>;
}
