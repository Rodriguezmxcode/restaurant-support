(function(root){
 'use strict';
 const origin='https://restaurant-support.vercel.app';
 const names=['Stamford','Orange','Fairfield','Danbury','Avon','Southington','Corporate Office'];
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
 root.RCOv={origin,period,empty,dataset};
 if(typeof module!=='undefined')module.exports=root.RCOv;
})(typeof globalThis==='undefined'?this:globalThis);
