import { useMemo, useState } from 'react';
import { bonusPolicy, calculateWeeklyBonus, type BonusInputs } from './bonusEngine';

const locations=['Stamford','Orange','Fairfield','Danbury','Avon','Southington'];
const inputStyle={width:'100%',boxSizing:'border-box' as const,padding:9,border:'1px solid #cbd8e6',borderRadius:8};
const pct=(v?:number,d=1)=>v===undefined?'Pending source':`${v.toFixed(d)}%`;

export default function WeeklyBonusPanel({allowedLocations}:{allowedLocations?:string[]}){
 const visible=allowedLocations?.length?locations.filter(x=>allowedLocations.includes(x)):locations;
 const [location,setLocation]=useState(visible[0]||locations[0]);
 // Live values are intentionally undefined until source connectors return verified data.
 const input:BonusInputs={};
 const result=useMemo(()=>calculateWeeklyBonus(input),[location]);
 return <section className="panel" style={{marginBottom:16}}>
  <div className="panel-header"><div><h2>Weekly Bonus Tracking</h2><p>Operational week Wednesday–Tuesday. Scores remain pending until each verified source is connected.</p></div><span className="count-pill">100 PTS</span></div>
  <div style={{padding:18,display:'grid',gap:14}}>
   <div style={{display:'grid',gridTemplateColumns:'220px 1fr',gap:12,alignItems:'end'}}><div><label>LOCATION</label><select style={inputStyle} value={location} onChange={e=>setLocation(e.target.value)}>{visible.map(x=><option key={x}>{x}</option>)}</select></div><div className="impact-box"><span>WEEKLY ELIGIBILITY</span><strong>{result.eligible===null?'Pending verified sources':result.eligible?'Eligible':'Not eligible'}</strong></div></div>
   <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:760}}><thead><tr>{['METRIC','WEIGHT','CURRENT','POINTS','SOURCE','RULE'].map(h=><th key={h} style={{textAlign:'left',padding:9,borderBottom:'1px solid #e5ecf3'}}>{h}</th>)}</tr></thead><tbody>{result.metrics.map(m=><tr key={m.key}><td style={{padding:9,fontWeight:800}}>{m.label}</td><td style={{padding:9}}>{m.weight}%</td><td style={{padding:9,fontWeight:700,color:m.ready?'#17263a':'#64748b'}}>{pct(m.value,m.key==='discounts'||m.key==='voids'||m.key==='overtime'?2:1)}</td><td style={{padding:9}}>{m.points===undefined?'—':m.points.toFixed(2)}</td><td style={{padding:9}}>{m.source}</td><td style={{padding:9,fontSize:12,color:'#64748b'}}>{m.note}</td></tr>)}</tbody></table></div>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}><div className="impact-box"><span>TASKS REQUIREMENT</span><strong>≥ {bonusPolicy.requirements.tasksPct}%</strong></div><div className="impact-box"><span>DISCOUNTS</span><strong>≤ {bonusPolicy.requirements.discountsPct.toFixed(2)}%</strong></div><div className="impact-box"><span>VOIDS</span><strong>≤ {bonusPolicy.requirements.voidsPct.toFixed(2)}%</strong></div><div className="impact-box"><span>OVERTIME</span><strong>≤ {bonusPolicy.requirements.overtimeLaborPct.toFixed(2)}%</strong></div></div>
   <div className="detail-block"><label>ELIGIBILITY GUARDRAILS</label><p>Logbook must be complete and the location must have no disqualifying disciplinary issue. OpsVista will show the exact reason whenever a location fails eligibility; it will not silently remove a restaurant from the ranking.</p></div>
  </div>
 </section>;
}
