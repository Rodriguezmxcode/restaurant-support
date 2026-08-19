import { useMemo, useState } from 'react';

type RangeKey = 'today'|'this-week'|'previous-week'|'this-month'|'last-month'|'custom';
type LocationRow = { location:string; sales:number; tasks?:number; voidPct?:number; discountPct?:number };
type Props = { allowedLocations:string[]; allLocations:boolean; initialLocation?:string };

const verifiedBaseline = {
  label:'Operational week · Aug 5–11, 2026',
  sales:360246.94,
  discounts:9700.27,
  discountPct:2.62,
  voids:947.47,
  voidPct:0.26,
  tasksPct:83.12,
};

const baselineRows:LocationRow[] = [
  {location:'Stamford',sales:85461.56,tasks:92.61,voidPct:.26,discountPct:2.20},
  {location:'Orange',sales:79441.33,tasks:93.39,voidPct:.22,discountPct:3.60},
  {location:'Fairfield',sales:52178.88,tasks:94.60,voidPct:.10,discountPct:1.96},
  {location:'Danbury',sales:46985.81,tasks:71.82,voidPct:.85,discountPct:2.08},
  {location:'Avon',sales:46015.09,tasks:95.37,voidPct:.07,discountPct:2.17},
  {location:'Southington',sales:37791.11,tasks:50.91,voidPct:.12,discountPct:1.85},
];

const money = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
const money2 = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});

function startOfOperationalWeek(date:Date) { const d=new Date(date); d.setHours(0,0,0,0); const delta=(d.getDay()-3+7)%7; d.setDate(d.getDate()-delta); return d; }
function iso(d:Date){return d.toISOString().slice(0,10)}
function plusDays(d:Date,n:number){const x=new Date(d);x.setDate(x.getDate()+n);return x}
function monthStart(d:Date,offset=0){return new Date(d.getFullYear(),d.getMonth()+offset,1)}
function monthEnd(d:Date,offset=0){return new Date(d.getFullYear(),d.getMonth()+offset+1,0)}

function resolveRange(key:RangeKey,customStart:string,customEnd:string){
  const now=new Date();
  if(key==='today') return {start:iso(now),end:iso(now),label:'Today'};
  if(key==='this-week'){const s=startOfOperationalWeek(now);return {start:iso(s),end:iso(now),label:'This operating week'};}
  if(key==='previous-week'){const s=plusDays(startOfOperationalWeek(now),-7);return {start:iso(s),end:iso(plusDays(s,6)),label:'Previous operating week'};}
  if(key==='this-month') return {start:iso(monthStart(now)),end:iso(now),label:'This month'};
  if(key==='last-month') return {start:iso(monthStart(now,-1)),end:iso(monthEnd(now,-1)),label:'Last month'};
  return {start:customStart,end:customEnd,label:'Custom range'};
}

function Kpi({label,value,note,status='ready'}:{label:string;value:string;note:string;status?:'ready'|'pending'|'warning'}){
  const accent=status==='warning'?'#b45309':status==='pending'?'#64748b':'#0f766e';
  return <div style={{background:'#fff',border:'1px solid #dce6f0',borderRadius:14,padding:'16px 17px',minHeight:120,boxShadow:'0 2px 8px rgba(15,23,42,.035)'}}>
    <div style={{fontSize:11,fontWeight:850,letterSpacing:'.055em',color:'#526174'}}>{label}</div>
    <div style={{fontSize:27,fontWeight:850,letterSpacing:'-.035em',color:'#142235',marginTop:9}}>{value}</div>
    <div style={{fontSize:12.5,lineHeight:1.4,color:accent,fontWeight:650,marginTop:7}}>{note}</div>
  </div>;
}

export default function OperationalOverview({allowedLocations,allLocations,initialLocation='All locations'}:Props){
  const [range,setRange]=useState<RangeKey>('this-month');
  const [customStart,setCustomStart]=useState('2026-08-01');
  const [customEnd,setCustomEnd]=useState('2026-08-19');
  const [location,setLocation]=useState(initialLocation);
  const resolved=resolveRange(range,customStart,customEnd);
  const visibleBaselineRows=useMemo(()=>baselineRows.filter(r=>allLocations||allowedLocations.includes(r.location)),[allLocations,allowedLocations]);
  const selectedBaselineRows=location==='All locations'?visibleBaselineRows:visibleBaselineRows.filter(r=>r.location===location);

  return <div style={{display:'grid',gap:16}}>
    <section style={{background:'#fff',border:'1px solid #dce6f0',borderRadius:14,padding:16}}>
      <div style={{display:'flex',gap:10,alignItems:'end',justifyContent:'space-between',flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:11,fontWeight:900,letterSpacing:'.07em',color:'#0f766e'}}>OPERATIONAL PERFORMANCE</div>
          <h2 style={{fontSize:22,margin:'5px 0 3px',color:'#142235'}}>Performance Dashboard</h2>
          <div style={{fontSize:13,color:'#64748b'}}>Wednesday–Tuesday operating week · live values must match the selected date range.</div>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          <select value={location} onChange={e=>setLocation(e.target.value)} style={{padding:'9px 11px',border:'1px solid #cbd8e6',borderRadius:9,fontWeight:700,color:'#233247',background:'#fff'}}>
            {allLocations&&<option>All locations</option>}{visibleBaselineRows.map(r=><option key={r.location}>{r.location}</option>)}
          </select>
          <select value={range} onChange={e=>setRange(e.target.value as RangeKey)} style={{padding:'9px 11px',border:'1px solid #cbd8e6',borderRadius:9,fontWeight:700,color:'#233247',background:'#fff'}}>
            <option value="today">Today</option><option value="this-week">This week</option><option value="previous-week">Previous week</option><option value="this-month">This month</option><option value="last-month">Last month</option><option value="custom">Custom range</option>
          </select>
          {range==='custom'&&<><input type="date" value={customStart} onChange={e=>setCustomStart(e.target.value)} style={{padding:8,border:'1px solid #cbd8e6',borderRadius:9}}/><input type="date" value={customEnd} onChange={e=>setCustomEnd(e.target.value)} style={{padding:8,border:'1px solid #cbd8e6',borderRadius:9}}/></>}
        </div>
      </div>
      <div style={{marginTop:13,padding:'9px 11px',borderRadius:9,background:'#fff7ed',fontSize:12.5,color:'#9a3412',display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
        <span><strong>{resolved.label}</strong> · {resolved.start} → {resolved.end}</span><span>Live Toast / 7shifts range feed not connected yet</span>
      </div>
    </section>

    <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12}}>
      <Kpi label="NET SALES" value="Pending source" note={`Waiting for live Toast sales for ${resolved.start} → ${resolved.end}`} status="pending" />
      <Kpi label="HOURLY LABOR" value="Pending source" note="Toast / 7shifts labor feed needs production wiring" status="pending" />
      <Kpi label="SALARY LABOR" value="Pending source" note="Payroll salary allocation needs production wiring" status="pending" />
      <Kpi label="TOTAL LABOR" value="Pending source" note="Will combine hourly + salaried labor automatically" status="pending" />
      <Kpi label="TASKS COMPLIANCE" value="Pending source" note={`Waiting for live task compliance for ${resolved.start} → ${resolved.end}`} status="pending" />
      <Kpi label="VOIDS" value="Pending source" note="Waiting for live void amount, rate and authorization detail" status="pending" />
      <Kpi label="DISCOUNTS" value="Pending source" note="Waiting for live discount amount, rate and type detail" status="pending" />
    </section>

    <section style={{display:'grid',gridTemplateColumns:'minmax(0,1.7fr) minmax(250px,.7fr)',gap:14}}>
      <div style={{background:'#fff',border:'1px solid #dce6f0',borderRadius:14,overflow:'hidden'}}>
        <div style={{padding:'15px 17px',borderBottom:'1px solid #e5ecf3'}}><strong style={{fontSize:16,color:'#17263a'}}>Last verified operational baseline</strong><div style={{fontSize:12.5,color:'#64748b',marginTop:3}}>{verifiedBaseline.label} · Reference only, not the selected live range.</div></div>
        <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:680}}><thead><tr>{['LOCATION','NET SALES','TASKS','VOIDS','DISCOUNTS','STATUS'].map(h=><th key={h} style={{textAlign:'left',padding:'10px 14px',fontSize:10.5,letterSpacing:'.05em',color:'#64748b',background:'#f8fafc',borderBottom:'1px solid #e5ecf3'}}>{h}</th>)}</tr></thead><tbody>{selectedBaselineRows.map(row=>{const needs=(row.tasks??100)<80||(row.voidPct??0)>.5||(row.discountPct??0)>2;return <tr key={row.location}><td style={{padding:'12px 14px',fontWeight:800,color:'#1f2d40',borderBottom:'1px solid #eef2f6'}}>{row.location}</td><td style={{padding:'12px 14px',fontWeight:750,borderBottom:'1px solid #eef2f6'}}>{money.format(row.sales)}</td><td style={{padding:'12px 14px',borderBottom:'1px solid #eef2f6',fontWeight:700,color:(row.tasks??0)<80?'#b45309':'#185f50'}}>{row.tasks?.toFixed(1)}%</td><td style={{padding:'12px 14px',borderBottom:'1px solid #eef2f6',fontWeight:700,color:(row.voidPct??0)>.5?'#b45309':'#334155'}}>{row.voidPct?.toFixed(2)}%</td><td style={{padding:'12px 14px',borderBottom:'1px solid #eef2f6',fontWeight:700,color:(row.discountPct??0)>2?'#b45309':'#334155'}}>{row.discountPct?.toFixed(2)}%</td><td style={{padding:'12px 14px',borderBottom:'1px solid #eef2f6'}}><span style={{fontSize:11,fontWeight:850,padding:'5px 8px',borderRadius:999,background:needs?'#fff7ed':'#ecfdf5',color:needs?'#9a3412':'#166534'}}>{needs?'REVIEW':'ON TRACK'}</span></td></tr>})}</tbody></table></div>
      </div>
      <div style={{display:'grid',gap:12,alignContent:'start'}}>
        <div style={{background:'#132238',color:'#fff',borderRadius:14,padding:17}}><div style={{fontSize:10.5,fontWeight:850,letterSpacing:'.06em',opacity:.68}}>DATA INTEGRITY</div><div style={{fontSize:18,fontWeight:850,marginTop:8}}>No stale numbers presented as live</div><p style={{fontSize:13,lineHeight:1.5,opacity:.82,margin:'7px 0 0'}}>OpsVista now separates verified historical reference data from the currently selected reporting period.</p></div>
        <div style={{background:'#fff',border:'1px solid #dce6f0',borderRadius:14,padding:17}}><div style={{fontSize:11,fontWeight:850,color:'#526174'}}>LAST VERIFIED TOTALS</div><div style={{display:'grid',gap:8,marginTop:11,fontSize:12.5}}><div><strong>Sales:</strong> {money2.format(verifiedBaseline.sales)}</div><div><strong>Tasks:</strong> {verifiedBaseline.tasksPct.toFixed(1)}%</div><div><strong>Voids:</strong> {money2.format(verifiedBaseline.voids)} · {verifiedBaseline.voidPct.toFixed(2)}%</div><div><strong>Discounts:</strong> {money2.format(verifiedBaseline.discounts)} · {verifiedBaseline.discountPct.toFixed(2)}%</div></div></div>
      </div>
    </section>
  </div>;
}
