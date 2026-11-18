(function(root){
 'use strict';
 const origin='https://restaurant-support.vercel.app';
 const names=['Stamford','Orange','Fairfield','Danbury','Avon','Southington','Corporate Office','Middletown'];
 const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
 function period(start,end){if(!validDate(start)||!validDate(end)||start>end||Date.parse(end)-Date.parse(start)>=31*86400000)throw Error('Selecciona un período de hasta 31 días.');}
 function empty(){return {kind:'opsvista',locations:[],sources:[],invoices:[],bank:[],accounts:[],sync:null};}
 function dataset(payload){
  const batch=payload?.batch,locations=payload?.locations;
  if(!batch||!Array.isArray(batch.rows)||batch.rows.length>10200||!Array.isArray(locations)||!locations.length||typeof batch.snapshot!=='string'||!Number.isFinite(Date.parse(batch.snapshot))||typeof batch.pending!=='boolean')throw Error('Consulta de OpsVista incompleta. Se conserva la anterior.');
  period(batch.start,batch.end);
  const locMap=new Map(),seenNames=new Set();
  for(const l of locations){if(typeof l.id!=='string'||!l.id||!names.includes(l.name)||locMap.has(l.id)||seenNames.has(l.name))throw Error('Sucursales de OpsVista no válidas.');locMap.set(l.id,l.name);seenNames.add(l.name);}
  const ids=new Set();
  const invoices=batch.rows.map(row=>{
   if(typeof row.id!=='string'||!/^r365:[a-f0-9-]{36}$/i.test(row.id)||ids.has(row.id)||!locMap.has(row.location_id)||!validDate(row.transaction_date)||row.transaction_date<batch.start||row.transaction_date>batch.end||!['approved','unapproved','unknown'].includes(row.approval_status)||row.currency!=='USD'||(row.amount!==null&&(typeof row.amount!=='number'||!Number.isFinite(row.amount)||!Number.isSafeInteger(Math.round(row.amount*100))||Math.abs(row.amount*100-Math.round(row.amount*100))>1e-6)))throw Error('Factura duplicada, fuera del período o incompleta. No se importó el lote.');
   for(const key of ['number','vendor_name'])if(row[key]!==null&&typeof row[key]!=='string')throw Error('Campos de factura no válidos.');
   ids.add(row.id);
   return {id:row.id,type:'Invoice',r365Status:{approved:'Approved',unapproved:'Sin aprobar',unknown:'No disponible'}[row.approval_status],location:locMap.get(row.location_id),number:row.number||'Número no disponible',date:row.transaction_date,vendor:row.vendor_name||'Proveedor no disponible',amount:row.amount===null?null:Math.round(row.amount*100),currency:'USD',po:null,missingItemsReported:'No disponible',attachmentReported:null,categoryFromPNL:null,includedInPNL:true,source:{id:'opsvista-r365',snapshot:batch.snapshot},raw:structuredClone(row)};
  });
  return {...empty(),locations:[...locMap.values()],invoices,sources:[{id:'opsvista-r365',name:'Restaurant365 vía OpsVista',url:origin+'/pv-control.html',version:'API v1'}],sync:{start:batch.start,end:batch.end,snapshot:batch.snapshot,refreshPending:batch.pending,count:invoices.length,receivedAt:new Date().toISOString()}};
 }
 function range(start,end){if(!validDate(start)||!validDate(end)||start>end||Date.parse(end)-Date.parse(start)>=366*86400000)throw Error('Selecciona un período de hasta un año. Los meses se consultan por separado automáticamente.');}
 function splitMonths(start,end){range(start,end);const parts=[];let cursor=start;while(cursor<=end){const d=new Date(cursor+'T12:00:00Z'),last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).toISOString().slice(0,10),until=last<end?last:end;parts.push({start:cursor,end:until});cursor=new Date(Date.parse(until)+86400000).toISOString().slice(0,10);}return parts;}
 function merge(payloads){
  if(!payloads.length)return empty();
  const latest=new Map();for(const p of payloads){const d=dataset(p),key=d.sync.start+':'+d.sync.end+':'+[...d.locations].sort().join('|'),prior=latest.get(key);if(!prior||Date.parse(prior.d.sync.snapshot)<=Date.parse(d.sync.snapshot))latest.set(key,{p,d});}
  const batches=[...latest.values()].sort((a,b)=>Date.parse(a.d.sync.snapshot)-Date.parse(b.d.sync.snapshot));
  const rows=new Map(),locations=new Set(),ranges=[];
  for(const {d} of batches){const locs=new Set(d.locations);for(const [id,i]of rows)if(i.date>=d.sync.start&&i.date<=d.sync.end&&locs.has(i.location))rows.delete(id);for(const i of d.invoices)rows.set(i.id,i);d.locations.forEach(l=>locations.add(l));ranges.push({...d.sync,locations:d.locations});}
  const last=batches.at(-1).d;
  return {...last,locations:[...locations],invoices:[...rows.values()],sync:{...last.sync,start:ranges.map(r=>r.start).sort()[0],end:ranges.map(r=>r.end).sort().at(-1),ranges,multi:ranges.length>1,refreshPending:ranges.some(r=>r.refreshPending),count:rows.size}};
 }
 const scopeMatches=(location,scope)=>!scope||scope==='__restaurants__'?(!scope||location!=='Corporate Office'):location===scope;
 function coverage(data,year,scope='',today=new Date().toISOString().slice(0,10)){
  const ranges=data.sync?.ranges||(data.sync?[{...data.sync,locations:data.locations}]:[]),locs=data.locations.filter(l=>scopeMatches(l,scope));
  return Array.from({length:12},(_,m)=>{const start=`${year}-${String(m+1).padStart(2,'0')}-01`,end=new Date(Date.UTC(year,m+1,0)).toISOString().slice(0,10),days=new Date(Date.UTC(year,m+1,0)).getUTCDate();
   let covered=0;for(let day=1;day<=days;day++){const d=`${start.slice(0,8)}${String(day).padStart(2,'0')}`;if(locs.length&&locs.every(l=>ranges.some(r=>r.locations.includes(l)&&r.start<=d&&r.end>=d)))covered++;}
   const count=data.invoices.filter(i=>i.date>=start&&i.date<=end&&scopeMatches(i.location,scope)).length;
   return {month:start.slice(0,7),start,end,count,covered,days,status:covered===days?'complete':covered?'partial':start>today?'future':'unknown'};
  });
 }
 root.RCOv={origin,period,range,splitMonths,merge,coverage,scopeMatches,empty,dataset};
 if(typeof module!=='undefined')module.exports=root.RCOv;
})(typeof globalThis==='undefined'?this:globalThis);
