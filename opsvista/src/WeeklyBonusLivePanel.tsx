import { useEffect, useMemo, useState } from 'react';
import { calculateWeeklyBonus } from './bonusEngine';

type TaskLocation={locationName:string;completionPct:number|null};
type TaskResponse={locations?:TaskLocation[];error?:string};
type ToastLocation={location:string;discountPct:number;voidPct:number;overtimeLaborPct?:number};
type ToastResponse={locations?:ToastLocation[];error?:string};
type Row={location:string;tasks?:number;discounts?:number;voids?:number;ot?:number;points:number;availableMax:number;failed:string[]};

const locationsDefault=['Stamford','Orange','Fairfield','Danbury','Avon','Southington'];
const pct=(v:number|undefined,digits=1)=>v===undefined?'Pending':`${v.toFixed(digits)}%`;
function operationalWeek(){const now=new Date();const day=now.getDay();const since=(day-3+7)%7;const start=new Date(now.getFullYear(),now.getMonth(),now.getDate()-since);const end=new Date(start);end.setDate(start.getDate()+6);const iso=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;return{start:iso(start),end:iso(end)};}

export default function WeeklyBonusLivePanel({allowedLocations}:{allowedLocations?:string[]}){
  const week=useMemo(operationalWeek,[]);const [tasks,setTasks]=useState<TaskResponse>({});const [toast,setToast]=useState<ToastResponse>({});const [loading,setLoading]=useState(true);
  const scope=allowedLocations?.length?allowedLocations:locationsDefault;
  useEffect(()=>{let cancelled=false;const run=async()=>{setLoading(true);const qs=new URLSearchParams({start:week.start,end:week.end});const [tr,sr]=await Promise.allSettled([fetch(`/api/tasks/weekly?${qs}`,{credentials:'include',cache:'no-store'}),fetch(`/api/operations/performance?${qs}`,{credentials:'include',cache:'no-store'})]);
    if(cancelled)return;
    if(tr.status==='fulfilled'){const b=await tr.value.json().catch(()=>({})) as TaskResponse;setTasks(b);}else setTasks({error:'7shifts unavailable'});
    if(sr.status==='fulfilled'){const b=await sr.value.json().catch(()=>({})) as ToastResponse;setToast(b);}else setToast({error:'Toast unavailable'});
    setLoading(false);};void run();return()=>{cancelled=true};},[week.start,week.end]);
  const rows=useMemo<Row[]>(()=>scope.map(location=>{
    const t=tasks.locations?.find(x=>x.locationName.localeCompare(location,undefined,{sensitivity:'base'})===0)?.completionPct??undefined;
    const s=toast.locations?.find(x=>x.location.localeCompare(location,undefined,{sensitivity:'base'})===0);
    const result=calculateWeeklyBonus({tasksPct:t??undefined,discountsPct:s?.discountPct,voidsPct:s?.voidPct,overtimeLaborPct:s?.overtimeLaborPct});
    const ready=result.metrics.filter(m=>m.ready);return{location,tasks:t??undefined,discounts:s?.discountPct,voids:s?.voidPct,ot:s?.overtimeLaborPct,points:ready.reduce((n,m)=>n+(m.points??0),0),availableMax:ready.reduce((n,m)=>n+m.weight,0),failed:result.eligibilityReasons};
  }),[scope.join('|'),tasks,toast]);
  return <section className="panel" style={{marginBottom:16}}><div className="panel-header"><div><h2>Weekly Bonus · Live Scorecard</h2><p>{week.start} → {week.end} · Wednesday–Tuesday · Live Tasks + Toast metrics</p></div><span className="count-pill">{loading?'SYNCING':'LIVE SOURCES'}</span></div><div style={{padding:18,display:'grid',gap:12}}>
    {(tasks.error||toast.error)&&<div className="detail-block"><label>SOURCE STATUS</label><p>{tasks.error?`7shifts: ${tasks.error}. `:''}{toast.error?`Toast: ${toast.error}.`:''}</p><p style={{color:'#64748b'}}>Missing sources remain Pending; OpsVista does not substitute demo numbers.</p></div>}
    <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:980}}><thead><tr>{['LOCATION','TASKS · 35','DISCOUNTS · 20','VOIDS · 15','OT · 15','LIVE POINTS','ELIGIBILITY GATES','REMAINING'].map(h=><th key={h} style={{textAlign:'left',padding:10,borderBottom:'1px solid #e2e8f0'}}>{h}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.location}><td style={{padding:10,fontWeight:850}}>{r.location}</td><td style={{padding:10,fontWeight:700}}>{pct(r.tasks)}</td><td style={{padding:10}}>{pct(r.discounts,2)}</td><td style={{padding:10}}>{pct(r.voids,2)}</td><td style={{padding:10}}>{pct(r.ot,2)}</td><td style={{padding:10,fontWeight:850}}>{r.availableMax?`${r.points.toFixed(1)} / ${r.availableMax}`:'Pending'}</td><td style={{padding:10,fontWeight:800,color:r.failed.length?'#b45309':'#166534'}}>{r.failed.length?r.failed.join(' · '):r.availableMax>=85?'PASS SO FAR':'Pending sources'}</td><td style={{padding:10,color:'#64748b'}}>Liquor 5 + Leadership 10</td></tr>)}</tbody></table></div>
    <div style={{fontSize:12,color:'#64748b'}}>The live subtotal can reach 85 points: Tasks 35 + Discounts 20 + Voids 15 + OT 15. Liquor Cost (5) and Logbook/Leadership (10) remain separate until their production sources are connected. Final eligibility is not declared until every required gate is known.</div>
  </div></section>;
}
