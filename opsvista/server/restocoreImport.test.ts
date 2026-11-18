import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
const pg=new PGlite();
function adapter(connection:any){
 const sql:any=async(parts:TemplateStringsArray,...values:any[])=>{const query=parts.reduce((text,part,index)=>text+(index?`$${index}`:'')+part,'');return (await connection.query(query,values.map(v=>v?.__json!==undefined?JSON.stringify(v.__json):v))).rows;};
 sql.json=(value:unknown)=>({__json:value});sql.begin=(callback:any)=>pg.transaction(tx=>callback(adapter(tx)));return sql;
}
mock.module('postgres',{defaultExport:()=>adapter(pg)});
let sourceCalls:any[]=[],failure=false;
const xml=`<edmx:Edmx><Schema><EntityType Name="Locations"><Key><PropertyRef Name="locationId"/></Key><Property Name="locationId"/><Property Name="name"/></EntityType><EntityType Name="Transactions"><Key><PropertyRef Name="transactionId"/></Key><Property Name="transactionId"/><Property Name="date"/><Property Name="locationId"/></EntityType><EntityContainer><EntitySet Name="Location" EntityType="R365.Locations"/><EntitySet Name="Transaction" EntityType="R365.Transactions"/></EntityContainer></Schema></edmx:Edmx>`;
mock.module('./restaurant365OData.js',{namedExports:{readRestaurant365ArchiveSource:async(org:string,view:string,params:any)=>{
 sourceCalls.push({org,view,params});
 if(org==='synthetic-line-collision'){
  if(view==='$metadata')return '<Schema><EntityType Name="Details"><Key><PropertyRef Name="transactionDetailId"/></Key><Property Name="transactionDetailId"/></EntityType><EntityContainer><EntitySet Name="TransactionDetail" EntityType="R365.Details"/></EntityContainer></Schema>';
  return params.$skip==='0'?[{transactionDetailId:'shared',glAccountId:'gl',quantity:1},{transactionDetailId:'first'}]:[{transactionDetailId:'shared',glAccountId:'gl',quantity:2},{transactionDetailId:'second'}];
 }
 if(failure&&view==='Transaction')throw Error('Temporary upstream failure');if(view==='$metadata')return xml;
 if(view==='Location')return params.$skip==='0'?[{locationId:'loc-a',name:'Southington'}]:[];
 if(view==='Transaction')return params.$skip==='0'?[{transactionId:'invoice-a',date:'2026-11-10T00:00:00Z',locationId:'loc-a',transactionNumber:'SYNTHETIC',type:'AP Invoice',name:org+' test'}]:[];
 throw Error('Unexpected source');
}}});
process.env.OPSVISTA_DATABASE_URL='postgres://test';
const archive=await import('./restocoreImport.js');
test('metadata retains real keys and discovers views without guessing endpoint names',()=>{
 const views=archive.parseArchiveMetadata(xml);assert.equal(views.length,2);assert.equal(views[0].name,'Location');assert.deepEqual(views[1].keys,['transactionId']);assert.throws(()=>archive.parseArchiveMetadata('<svg/>'));
 const namespaced=xml.replace(/<(\/)?(EntityType|Key|PropertyRef|Property|EntitySet|EntityContainer)\b/g,'<$1x:$2');assert.equal(archive.parseArchiveMetadata(namespaced).length,2);
});
test('line keys retain distinct rows even when transactionDetailId is shared',()=>{
 const view={name:'TransactionDetail',keys:['transactionDetailId'],fields:[],label:'Details',daily:false};
 const a=archive.archiveRecord(view,{transactionDetailId:'group',transactionDetailAutoId:1,quantity:2,unitOfMeasureName:'CS'}),b=archive.archiveRecord(view,{transactionDetailId:'group',transactionDetailAutoId:2});assert.notEqual(a.source_id,b.source_id);assert.equal(a.payload.quantity,2);const reusedA=archive.archiveRecord(view,{transactionDetailId:'line-a',transactionDetailAutoId:0,transactionId:'t'}),reusedB=archive.archiveRecord(view,{transactionDetailId:'line-b',transactionDetailAutoId:0,transactionId:'t'});assert.notEqual(reusedA.source_id,reusedB.source_id);const accounting=archive.archiveRecord(view,{transactionDetailId:'shared',transactionId:'invoice',glAccountId:'gl-payable'}),product=archive.archiveRecord(view,{transactionDetailId:'shared',transactionId:'invoice',glAccountId:'gl-food',itemId:'item'});assert.notEqual(accounting.source_id,product.source_id);assert.throws(()=>archive.archiveRecord(view,{quantity:3}));
});
test('partial pages do not claim completeness and repeated pages halt without advancing',()=>{
 const view=archive.parseArchiveMetadata(xml)[1],cursor={offset:0,pageSize:100},rows=[{transactionId:'a'}];
 const first=archive.advanceArchiveCursor(view,cursor,rows);assert.equal(first.complete,false);assert.equal(first.cursor.offset,1);assert.throws(()=>archive.advanceArchiveCursor(view,first.cursor,rows));assert.equal(archive.advanceArchiveCursor(view,first.cursor,[]).complete,true);
});
test('sales historical queries stay within one day and continue across day boundaries',()=>{
 const view={name:'SalesDetail',label:'Sales',keys:['salesdetailID'],fields:['modifiedOn'],daily:true};const cursor={offset:0,pageSize:100,day:'2026-01-01',until:'2026-01-03'};
 const q=archive.archiveQuery(view,cursor);assert.match(q.$filter,/2026-01-01T00:00:00Z.*2026-01-02T00:00:00Z/);assert.ok(!q.$select);
 const next=archive.advanceArchiveCursor(view,cursor,[]);assert.equal(next.complete,false);assert.equal(next.cursor.day,'2026-01-02');assert.equal(archive.advanceArchiveCursor(view,next.cursor,[]).complete,true);
});
test('durable import resumes page checkpoints, preserves fields and isolates organizations',async()=>{
 for(let i=0;i<4;i++)await archive.runRestocoreImport('synthetic-a');
 const result:any=await archive.readRestocoreArchive('synthetic-a',{view:'Transaction',location:'loc-a'});assert.equal(result.rows.length,1);assert.equal(result.rows[0].data.transactionNumber,'SYNTHETIC');assert.equal(result.rows[0].location,'Southington');assert.equal(result.views.every((v:any)=>v.state==='complete'),true);
 const last=await archive.runRestocoreImport('synthetic-a');assert.equal(last.processed,0);assert.equal(last.records,2);
 const other:any=await archive.readRestocoreArchive('synthetic-b',{});assert.equal(other.views.length,0);
 const empty:any=await archive.readRestocoreArchive('synthetic-a',{view:'Transaction',search:"' or 1=1 --"});assert.equal(empty.rows.length,0);
});
test('source failure preserves imported data and cursor, then resumes the same page',async()=>{
 await archive.runRestocoreImport('synthetic-retry');await archive.runRestocoreImport('synthetic-retry');await archive.runRestocoreImport('synthetic-retry');failure=true;
 const bad=await archive.runRestocoreImport('synthetic-retry');assert.equal(bad.errors,1);const saved:any=await archive.readRestocoreArchive('synthetic-retry',{view:'Transaction'});assert.equal(saved.rows.length,1);assert.equal(saved.views.find((v:any)=>v.name==='Transaction').state,'error');failure=false;
 await pg.query("update opsvista_r365_archive_views set next_attempt=now() where organization_id='synthetic-retry'");const resumed=await archive.runRestocoreImport('synthetic-retry');assert.equal(resumed.errors,0);assert.equal(resumed.remaining,0);assert.equal(resumed.records,2);
});
test('conflicting line identities across pages cannot overwrite saved quantities',async()=>{
 await archive.runRestocoreImport('synthetic-line-collision');
 const result=await archive.runRestocoreImport('synthetic-line-collision');assert.equal(result.errors,1);assert.equal(result.records,2);
 const saved:any=await archive.readRestocoreArchive('synthetic-line-collision',{view:'TransactionDetail'});
 assert.equal(saved.rows.find((r:any)=>r.data.transactionDetailId==='shared').data.quantity,1);
 assert.equal(saved.rows.some((r:any)=>r.data.transactionDetailId==='second'),false);
});
test.after(async()=>{await pg.close();});
