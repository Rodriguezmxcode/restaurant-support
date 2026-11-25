import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoSync } from '../public/restocore-sync.js';
import '../public/restocore-runs.js';
const period={start:'2026-11-01',end:'2026-11-14'};
const time=Date.parse('2026-11-15T02:00:00Z');
function source({snapshot=new Date(time).toISOString(),pending=false}={}){return {api_version:'1',organization_id:'org-puerto-vallarta',data:[],pagination:{total:0,offset:0,next_offset:null,snapshot_at:snapshot},source:{snapshot_at:snapshot,refresh_pending:pending}};}
function harness(invoices=()=>source()){
 const result={published:[],messages:[],locked:[],refreshes:0};
 result.request=async path=>path==='health'?{ok:true,organization_id:'org-puerto-vallarta'}:path==='locations'?{api_version:'1',organization_id:'org-puerto-vallarta',data:[{id:'st',name:'Stamford'}]}:invoices(path);
 result.options={request:result.request,refreshSource:async()=>{result.refreshes++;return {memory:{pending:false}};},publish:p=>result.published.push(p),status:(...x)=>result.messages.push(x),lock:x=>result.locked.push(x),now:()=>time};
 return result;
}
test('Loads on invocation, no manual transfer; fresh snapshots do not reload R365',async()=>{const h=harness();await createAutoSync(h.options).run(period);assert.equal(h.published.length,1);assert.equal(h.refreshes,0);assert.equal(h.published[0].batch.rows.length,0);});
test('Stale snapshot refreshes source then publishes complete updated query',async()=>{let n=0;const h=harness(()=>source({snapshot:new Date(time-(n++===0?3600000:0)).toISOString()}));await createAutoSync(h.options).run(period);assert.equal(h.refreshes,1);assert.equal(h.published.length,2);assert.equal(h.published[1].batch.snapshot,new Date(time).toISOString());});
test('Failure preserves last complete dataset and throttles source retries',async()=>{const h=harness(()=>source({pending:true}));h.options.refreshSource=async()=>{h.refreshes++;throw Error('Temporary source outage');};const sync=createAutoSync(h.options);await sync.run(period);await sync.run(period);assert.equal(h.refreshes,1);assert.equal(h.published.length,2);assert(h.messages.some(m=>m[1]===true));});
test('Expired session locks without exposing stale source data',async()=>{const h=harness();h.options.request=async()=>{throw Object.assign(Error('Expired'),{status:401});};await createAutoSync(h.options).run(period);assert.deepEqual(h.locked,['Expired']);assert.equal(h.published.length,0);});
test('Rapid range changes cannot publish superseded responses',async()=>{const h=harness();let release;const deferred=new Promise(r=>release=r);const original=h.options.request;h.options.request=async(path,...rest)=>{if(path.includes('start=2026-11-01')){await deferred;}return original(path,...rest);};const sync=createAutoSync(h.options);const a=sync.run(period);await new Promise(r=>setImmediate(r));await sync.run({start:'2026-11-02',end:'2026-11-14'});release();await a;assert.equal(h.published.length,1);assert.equal(h.published[0].batch.start,'2026-11-02');});
test('Incomplete pagination never replaces previous source',async()=>{const h=harness(()=>({...source(),pagination:{...source().pagination,total:1}}));await createAutoSync(h.options).run(period);assert.equal(h.published.length,0);assert.equal(h.messages.at(-1)[1],true);});
const row={id:'one',type:'Invoice',r365Status:'Approved',amount:10000,location:'Stamford',number:'123',vendor:'Test vendor',date:'2026-11-02',source:{snapshot:new Date(time).toISOString()}};
const input={name:'Test draft',paymentDate:'2026-11-14',location:'Stamford',method:'Check',actor:'Test'};
test('Payment Run drafts retain source amount and unknown balance without marking paid',()=>{const r=RCRuns.create(input,['one'],[row],[]);assert.equal(r.status,'draft');assert.equal(r.origin,'restocore-local');assert.equal(r.lines[0].remainingAmount,null);assert.equal(r.lines[0].originalAmount,10000);assert.equal(row.paymentStatus,undefined);});
test('Payment Run prevents unknown amounts, unapproved rows, cross-branch and duplicate inclusion',()=>{for(const bad of [{...row,amount:null},{...row,r365Status:'Sin aprobar'},{...row,location:'Orange'}])assert.throws(()=>RCRuns.create(input,['one'],[bad],[]));const r=RCRuns.create(input,['one'],[row],[]);assert.throws(()=>RCRuns.create(input,['one'],[row],[r]));assert.throws(()=>RCRuns.create(input,['one','one'],[row],[]));});
test('Draft dates validate American input converted to ISO calendar dates',()=>{assert.throws(()=>RCRuns.create({...input,paymentDate:'2026-02-29'},['one'],[row],[]));assert.equal(RCRuns.create({...input,paymentDate:'2024-02-29'},['one'],[row],[]).paymentDate,'2024-02-29');});
