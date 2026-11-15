// RestoCore planning drafts. These are never represented as native R365 payment runs.
(function(root){
 'use strict';
 const eligible=i=>i.type==='Invoice'&&i.r365Status==='Approved'&&Number.isSafeInteger(i.amount)&&i.amount>0;
 const date=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
 function create({name,paymentDate,location,bankAlias,method,actor,notes}, selected, invoices, runs){
  if(!String(name||'').trim()||!String(actor||'').trim())throw Error('Completa el nombre del lote y el responsable.');
  if(!date(paymentDate))throw Error('Escribe la fecha de pago como mes/día/año.');
  if(!location||!['Check','ACH','R365 Payments','Other'].includes(method))throw Error('Selecciona sucursal y método.');
  if(!Array.isArray(selected)||!selected.length)throw Error('Selecciona al menos una factura.');
  const seen=new Set();
  const lines=selected.map(id=>{
   const row=invoices.find(i=>i.id===id);
   if(seen.has(id)||!row||!eligible(row)||row.location!==location)throw Error('La selección cambió o contiene una factura no elegible. Revisa el lote.');
   if(runs.some(r=>!r.cancelledAt&&r.lines.some(l=>l.id===id)))throw Error('Una factura ya está incluida en otro borrador activo.');
   seen.add(id);
   return {id:row.id,number:row.number,vendor:row.vendor,date:row.date,location:row.location,originalAmount:row.amount,remainingAmount:null,sourceSnapshot:row.source.snapshot};
  });
  return {id:root.crypto.randomUUID(),name:name.trim(),paymentDate,location,bankAlias:String(bankAlias||'').trim()||null,method,actor:actor.trim(),notes:String(notes||'').trim(),status:'draft',origin:'restocore-local',createdAt:new Date().toISOString(),lines};
 }
 root.RCRuns={eligible,create};
 if(typeof module!=='undefined')module.exports=root.RCRuns;
})(typeof globalThis==='undefined'?this:globalThis);
