import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parsePvInvoice, receivePvInvoice, listPvInvoices, PvInvoiceConflict } from './pvInvoiceStore.js';
import { pvInvoiceEndpoint } from './pvInvoiceEndpoint.js';
import type { SessionUser } from './authSession.js';
const org='org-puerto-vallarta';
const user: SessionUser={id:'fixture',name:'Fixture',email:'fixture@example.invalid',title:'',role:'Founder',organizationId:org,locations:[]};
const invoice=()=>({client_id:randomUUID(),source:'pv-control',location_id:'avon',transaction_date:'2026-09-22',vendor_name:'Fixture Vendor',number:'PV-1',amount:123.45,currency:'USD',lane:'vendor',key_item:'Food',notes:'Fixture'});
const headers={host:'opsvista.invalid',origin:'https://opsvista.invalid','sec-fetch-site':'same-origin','x-pv-source':'pv-control','content-type':'application/json'};
function response(){return {code:0,body:null as any,headers:{} as Record<string,string>,status(code:number){this.code=code;return this},json(body:unknown){this.body=body},setHeader(key:string,value:string){this.headers[key]=value}}}
test('intake validates dates, cents, source, tenant locations and a bounded strict schema',()=>{
  assert.equal(parsePvInvoice(invoice()).amount,123.45);
  for(const changes of [{amount:0},{amount:-1},{amount:null},{amount:'123'},{amount:1.234},{amount:Infinity},{amount:10000001},{transaction_date:'2026-02-30'},{location_id:'other'},{source:'restaurant365'},{currency:'MXN'},{client_id:'r365:1'},{lane:'IC'},{number:''},{vendor_name:' '},{notes:'x'.repeat(2001)},{organization_id:'other'},{payment_status:'paid'}])assert.throws(()=>parsePvInvoice({...invoice(),...changes}));
});
test('intake denies unsigned, wrong-role, cross-site, non-JSON and unknown-query writes before storage',async()=>{
  const base={method:'POST',headers,query:{endpoint:'submissions'},body:invoice()};
  const deps={receive:async()=>{throw Error('must not write')},list:async()=>{throw Error('must not read')}} as any;
  for(const [actor,status] of [[null,401],[{...user,role:'Corporate'},403],[{...user,organizationId:'other'},403]] as const){const res=response();await pvInvoiceEndpoint(base,res,actor as SessionUser|null,deps);assert.equal(res.code,status)}
  for(const override of [{origin:undefined},{origin:'https://evil.invalid'},{origin:'http://opsvista.invalid'},{'sec-fetch-site':'same-site'},{'x-pv-source':'other'}]){const res=response();await pvInvoiceEndpoint({...base,headers:{...headers,...override}},res,user,deps);assert.equal(res.code,403)}
  const nonJson=response();await pvInvoiceEndpoint({...base,headers:{...headers,'content-type':'text/plain'}},nonJson,user,deps);assert.equal(nonJson.code,415);
  const params=response();await pvInvoiceEndpoint({...base,query:{endpoint:'submissions',organization_id:'other'}},params,user,deps);assert.equal(params.code,400);
  const tooBig=response();await pvInvoiceEndpoint({...base,body:{...invoice(),notes:'x'.repeat(17000)}},tooBig,user,deps);assert.equal(tooBig.code,413);
  const unavailable=response();await pvInvoiceEndpoint(base,unavailable,user,deps);assert.equal(unavailable.code,503);assert.doesNotMatch(JSON.stringify(unavailable.body),/must not write/);
});
test('durable storage deduplicates concurrent retries, keeps original values, and isolates tenants',async()=>{
  process.env.OPSVISTA_DATABASE_URL='postgres://fixture';
  const body=parsePvInvoice(invoice());
  const saved=await Promise.all(Array.from({length:5},()=>receivePvInvoice(org,user.id,body)));
  assert.equal(saved.filter(x=>x.created).length,1);assert.equal(new Set(saved.map(x=>x.invoice.id)).size,1);
  const alias=await receivePvInvoice(org,user.id,{...body,client_id:randomUUID()});assert.equal(alias.created,false);assert.equal(alias.invoice.id,saved[0].invoice.id);
  await assert.rejects(()=>receivePvInvoice(org,user.id,{...body,amount:124}),PvInvoiceConflict);
  await assert.rejects(()=>receivePvInvoice(org,user.id,{...body,client_id:randomUUID(),amount:125}),PvInvoiceConflict);
  assert.equal((await listPvInvoices(org)).total,1);assert.equal((await listPvInvoices('other')).total,0);
  await receivePvInvoice('other','other',body);assert.equal((await listPvInvoices('other')).total,1);
  const received=(await listPvInvoices(org)).data[0];assert.equal(received.amount,123.45);assert.equal(received.receipt_status,'received');assert.equal(received.payment_status,'unavailable');assert.equal('created_by' in received,false);
  // Same invoice received on the other lane is explicitly a receiving record, not another vendor bill.
  await receivePvInvoice(org,user.id,{...body,client_id:randomUUID(),lane:'receiving'});assert.equal((await listPvInvoices(org)).total,2);
});
test('endpoint acknowledges the caller ID only after a committed receipt and returns 409 on edits',async()=>{
  process.env.OPSVISTA_DATABASE_URL='postgres://fixture';
  const body={...invoice(),number:'PV-ENDPOINT'};
  const req={method:'POST',headers,query:{endpoint:'submissions'},body};
  const first=response();await pvInvoiceEndpoint(req,first,user);assert.equal(first.code,201);assert.equal(first.body.client_id,body.client_id);
  const retry=response();await pvInvoiceEndpoint(req,retry,user);assert.equal(retry.code,200);assert.equal(retry.body.invoice.id,first.body.invoice.id);
  const changed=response();await pvInvoiceEndpoint({...req,body:{...body,amount:99}},changed,user);assert.equal(changed.code,409);
  const get=response();await pvInvoiceEndpoint({...req,method:'GET'},get,user);assert.equal(get.code,200);assert.ok(get.body.data.some((r:any)=>r.id===first.body.invoice.id));assert.equal(get.headers['Cache-Control'],'private, no-store');
});
