import { useEffect, useMemo, useState } from 'react';
import './laborIntelligence.css';

type LaborEscalation={location:string;title:string;signal:string;cause:string;recommendation:string;impact:string;severity:'High'|'Medium'|'Low'};
type Props={onEscalate?:(item:LaborEscalation)=>void;allowedLocations?:string[]};
type LiveRow={location:string;netSales:number;hourlyHours:number;overtimeHours:number;hourlyLaborCost:number;salaryLaborCost:number;totalLaborCost:number;hourlyLaborPct:number;salaryLaborPct:number;totalLaborPct:number;splh:number|null};
type LiveResponse={start:string;end:string;locations:LiveRow[];error?:string};
type Insight=LiveRow&{targetLaborPct:number;gap:number;estimatedExcess:number;severity:'Healthy'|'Watch'|'Action'};

const money=(value:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
const pct=(value:number)=>`${value.toFixed(1)}%`;
const targetFor=(location:string)=>/Avon|Southington|Danbury/i.test(location)?22:21;
function operationalRange(){const now=new Date();const since=(now.getDay()-3+7)%7;const start=new Date(now.getFullYear(),now.getMonth(),now.getDate()-since);const iso=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;return{start:iso(start),end:iso(now)}}

export default function LaborIntelligenceView({onEscalate,allowedLocations}:Props){
  const range=useMemo(operationalRange,[]);
  const [data,setData]=useState<LiveResponse|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [selected,setSelected]=useState<Insight|null>(null);
  const [escalated,setEscalated]=useState<string[]>([]);

  useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');
    const params=new URLSearchParams(range);
    fetch(`/api/operations/performance?${params}`,{credentials:'include',cache:'no-store',signal:controller.signal}).then(async response=>{const body=await response.json().catch(()=>({})) as LiveResponse;if(!response.ok)throw new Error(body.error||'Live labor data unavailable');setData(body)}).catch(e=>{if(e?.name!=='AbortError')setError(e instanceof Error?e.message:'Live labor data unavailable')}).finally(()=>setLoading(false));
    return()=>controller.abort();
  },[range.start,range.end]);

  const rows=useMemo<Insight[]>(()=>((data?.locations||[])
    .filter(row=>!allowedLocations?.length||allowedLocations.some(location=>row.location.toLowerCase().includes(location.toLowerCase())))
    .map(row=>{const targetLaborPct=targetFor(row.location);const gap=row.totalLaborPct-targetLaborPct;return{...row,targetLaborPct,gap,estimatedExcess:Math.max(0,row.totalLaborCost-row.netSales*targetLaborPct/100),severity:gap>=3||row.overtimeHours>=8?'Action':gap>=1||row.overtimeHours>=4?'Watch':'Healthy'} as Insight})
    .sort((a,b)=>b.gap-a.gap)),[data,allowedLocations]);
  const totals=useMemo(()=>rows.reduce((a,r)=>({sales:a.sales+r.netSales,labor:a.labor+r.totalLaborCost,hours:a.hours+r.hourlyHours,ot:a.ot+r.overtimeHours,excess:a.excess+r.estimatedExcess}),{sales:0,labor:0,hours:0,ot:0,excess:0}),[rows]);

  const sendToActionCenter=(row:Insight)=>{onEscalate?.({location:row.location,title:`${row.location} labor review`,signal:`Total labor is ${pct(row.totalLaborPct)} against a ${pct(row.targetLaborPct)} target for ${range.start}–${range.end}; overtime is ${row.overtimeHours.toFixed(1)} hours.`,cause:row.gap>0?'Labor cost is above the operating target for the selected period.':'Labor is within target, but management requested a documented review.',recommendation:'Review staffing, overtime, peak coverage, prep and closing requirements before making schedule changes.',impact:`${money(row.estimatedExcess)} labor cost above target in the selected period`,severity:row.severity==='Action'?'High':row.severity==='Watch'?'Medium':'Low'});setEscalated(items=>items.includes(row.location)?items:[...items,row.location]);};

  return <div className="labor-page">
    <div className="detail-block" style={{marginBottom:16}}><label>LIVE PERIOD</label><p>{range.start} → {range.end} · Toast sales and labor + OpsVista salary allocation</p>{error&&<p style={{color:'#b91c1c'}}>{error}</p>}</div>
    <section className="labor-summary-grid">
      <article className="labor-card labor-hero"><span>TOTAL LABOR</span><strong>{loading?'…':pct(totals.sales?totals.labor/totals.sales*100:0)}</strong><p>Hourly + salary labor</p></article>
      <article className="labor-card"><span>NET SALES</span><strong>{money(totals.sales)}</strong><p>Live Toast</p></article>
      <article className="labor-card"><span>SPLH</span><strong>{money(totals.hours?totals.sales/totals.hours:0)}</strong><p>Sales per hourly labor hour</p></article>
      <article className="labor-card labor-warn"><span>ABOVE TARGET</span><strong>{money(totals.excess)}</strong><p>Actual period variance</p></article>
      <article className="labor-card"><span>OT HOURS</span><strong>{totals.ot.toFixed(1)}h</strong><p>Live worked overtime</p></article>
      <article className="labor-card"><span>NEEDS ACTION</span><strong>{rows.filter(r=>r.severity==='Action').length}</strong><p>{rows.filter(r=>r.severity==='Watch').length} additional watch locations</p></article>
    </section>
    <section className="labor-guidance"><div><strong>OpsVista Labor Guardrail</strong><span>Review actual demand, required positions, service levels, prep and closing standards before reducing hours.</span></div><div className="labor-guide-chips"><span>Live sales</span><span>Hourly + salary</span><span>Total labor %</span><span>SPLH</span><span>Overtime</span></div></section>
    <section className="labor-panel"><div className="labor-panel-head"><div><h2>Live Labor Intelligence by Location</h2><p>Actual performance for the selected operating period.</p></div><span>{rows.length} locations</span></div>
      <div className="labor-table-wrap"><table className="labor-table"><thead><tr><th>Location</th><th>Net Sales</th><th>Hourly Labor</th><th>Salary Labor</th><th>Total Labor</th><th>Target</th><th>SPLH</th><th>OT Hours</th><th>Above Target</th><th>Status</th><th></th></tr></thead>
      <tbody>{rows.map(row=><tr key={row.location} className={row.severity==='Action'?'labor-action-row':''}><td><strong>{row.location}</strong></td><td>{money(row.netSales)}</td><td>{money(row.hourlyLaborCost)} · {pct(row.hourlyLaborPct)}</td><td>{money(row.salaryLaborCost)} · {pct(row.salaryLaborPct)}</td><td><strong className={row.gap>1?'labor-negative':''}>{money(row.totalLaborCost)} · {pct(row.totalLaborPct)}</strong></td><td>{pct(row.targetLaborPct)}</td><td>{row.splh?money(row.splh):'—'}</td><td>{row.overtimeHours.toFixed(1)}h</td><td className="labor-money">{money(row.estimatedExcess)}</td><td><span className={`labor-status ${row.severity.toLowerCase()}`}>{row.severity}</span></td><td><button onClick={()=>setSelected(row)}>Review</button></td></tr>)}</tbody></table></div>
    </section>
    {selected&&<div className="labor-drawer-backdrop" onClick={()=>setSelected(null)}><aside className="labor-drawer" onClick={e=>e.stopPropagation()}><div className="labor-drawer-head"><div><span>LIVE LABOR INTELLIGENCE</span><h2>{selected.location}</h2><p>{range.start} → {range.end}</p></div><button onClick={()=>setSelected(null)}>×</button></div>
      <div className="labor-drawer-grid"><div><label>Net sales</label><strong>{money(selected.netSales)}</strong></div><div><label>Total labor</label><strong>{money(selected.totalLaborCost)} · {pct(selected.totalLaborPct)}</strong></div><div><label>Hourly labor</label><strong>{money(selected.hourlyLaborCost)}</strong></div><div><label>Salary labor</label><strong>{money(selected.salaryLaborCost)}</strong></div><div><label>OT hours</label><strong>{selected.overtimeHours.toFixed(1)}h</strong></div><div><label>SPLH</label><strong>{selected.splh?money(selected.splh):'—'}</strong></div></div>
      <div className="labor-signal"><label>SIGNAL</label><p>{selected.location} is at {pct(selected.totalLaborPct)} total labor against a {pct(selected.targetLaborPct)} target.</p></div>
      <div className="labor-recommendation"><label>OPSVISTA RECOMMENDATION</label><p>Review staffing and overtime against actual demand. Protect rush coverage, prep, closing and required positions before changing the schedule.</p></div>
      <div className="labor-impact"><span>Actual period variance</span><strong>{money(selected.estimatedExcess)} above target</strong><small>{selected.overtimeHours.toFixed(1)} overtime hours</small></div>
      <div className="labor-actions"><button className="labor-primary" disabled={escalated.includes(selected.location)} onClick={()=>sendToActionCenter(selected)}>{escalated.includes(selected.location)?'Added to Action Center':'Send to Action Center'}</button><button onClick={()=>setSelected(null)}>Close</button></div>
    </aside></div>}
  </div>;
}
