import postgres from 'postgres';
import type { SessionUser } from './authSession.js';

export type TransferReceiptStatus = 'Pending'|'Complete'|'Partial'|'Incomplete';
export type TransferStatus = 'Requested'|'In Transit'|'Received'|'Reconciled'|'Cancelled';
export type TransferItem = {
  id:string;
  name:string;
  unit?:string;
  expectedQty:number;
  receivedQty?:number;
  shortageQty?:number;
  note?:string;
};
export type TransferRecord = {
  id:string;
  organizationId:string;
  sourceLocation:string;
  destinationLocation:string;
  status:TransferStatus;
  receiptStatus:TransferReceiptStatus;
  createdById:string;
  createdByName:string;
  createdAt:string;
  dispatchedAt?:string;
  receiverId?:string;
  receiverName?:string;
  receivedAt?:string;
  notes?:string;
  items:TransferItem[];
  updatedAt:string;
};
export type TransferAudit = {
  id:string;transferId:string;at:string;actorId:string;actorName:string;action:string;before?:string;after?:string;reason:string;
};

let client:ReturnType<typeof postgres>|undefined;
let initialized=false;
function databaseUrl(){return process.env.OPSVISTA_DATABASE_URL||process.env.OPSVISTA_DATABASE_DATABASE_URL||'';}
function sql(){const url=databaseUrl();if(!url)throw new Error('OpsVista database URL is not configured');if(!client)client=postgres(url,{max:4,idle_timeout:20,connect_timeout:10});return client;}
async function ensureSchema(){
  if(initialized)return; const db=sql();
  await db`create table if not exists opsvista_transfers (
    id text primary key, organization_id text not null, source_location text not null, destination_location text not null,
    status text not null, receipt_status text not null default 'Pending', created_by_id text not null, created_by_name text not null,
    created_at timestamptz not null, dispatched_at timestamptz, receiver_id text, receiver_name text, received_at timestamptz,
    notes text, items jsonb not null default '[]'::jsonb, updated_at timestamptz not null default now()
  )`;
  await db`create table if not exists opsvista_transfer_audit (
    id text primary key, transfer_id text not null, at timestamptz not null, actor_id text not null, actor_name text not null,
    action text not null, before_value text, after_value text, reason text not null
  )`;
  await db`create index if not exists opsvista_transfers_created_idx on opsvista_transfers (created_at desc)`;
  await db`create index if not exists opsvista_transfers_locations_idx on opsvista_transfers (source_location,destination_location,created_at desc)`;
  await db`create index if not exists opsvista_transfer_audit_transfer_idx on opsvista_transfer_audit (transfer_id,at desc)`;
  initialized=true;
}
function norm(row:Record<string,unknown>):TransferRecord{return {
  id:String(row.id),organizationId:String(row.organization_id),sourceLocation:String(row.source_location),destinationLocation:String(row.destination_location),
  status:String(row.status) as TransferStatus,receiptStatus:String(row.receipt_status) as TransferReceiptStatus,createdById:String(row.created_by_id),createdByName:String(row.created_by_name),
  createdAt:new Date(String(row.created_at)).toISOString(),dispatchedAt:row.dispatched_at?new Date(String(row.dispatched_at)).toISOString():undefined,
  receiverId:row.receiver_id?String(row.receiver_id):undefined,receiverName:row.receiver_name?String(row.receiver_name):undefined,receivedAt:row.received_at?new Date(String(row.received_at)).toISOString():undefined,
  notes:row.notes?String(row.notes):undefined,items:Array.isArray(row.items)?row.items as TransferItem[]:[],updatedAt:new Date(String(row.updated_at)).toISOString(),
};}
function canSee(user:SessionUser,row:TransferRecord){return ['Founder','Corporate','Kitchen'].includes(user.role)||user.locations.includes(row.sourceLocation)||user.locations.includes(row.destinationLocation);}
export async function listTransfers(user:SessionUser){await ensureSchema();const rows=await sql()`select * from opsvista_transfers order by created_at desc limit 500`;return rows.map(r=>norm(r)).filter(r=>canSee(user,r));}
export async function getTransfer(id:string){await ensureSchema();const rows=await sql()`select * from opsvista_transfers where id=${id} limit 1`;return rows[0]?norm(rows[0]):null;}
export async function listTransferAudit(transferId:string){await ensureSchema();return await sql()`select * from opsvista_transfer_audit where transfer_id=${transferId} order by at desc`;}
function auditId(){return `tra-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;}
export async function createTransfer(input:{sourceLocation:string;destinationLocation:string;items:TransferItem[];notes?:string},actor:SessionUser){
  await ensureSchema(); const db=sql(); const id=`TR-${Date.now().toString(36).toUpperCase()}`; const at=new Date().toISOString(); const org=actor.organizationId||'org-puerto-vallarta';
  await db.begin(async tx=>{
    await tx`insert into opsvista_transfers (id,organization_id,source_location,destination_location,status,receipt_status,created_by_id,created_by_name,created_at,dispatched_at,notes,items)
      values (${id},${org},${input.sourceLocation},${input.destinationLocation},'In Transit','Pending',${actor.id},${actor.name},${at},${at},${input.notes??null},${tx.json(input.items)})`;
    await tx`insert into opsvista_transfer_audit (id,transfer_id,at,actor_id,actor_name,action,after_value,reason)
      values (${auditId()},${id},${at},${actor.id},${actor.name},'Transfer created',${`${input.sourceLocation} → ${input.destinationLocation}`},'Transfer dispatched')`;
  });
  return getTransfer(id);
}
export async function receiveTransfer(id:string,input:{receiptStatus:Exclude<TransferReceiptStatus,'Pending'>;receiverName:string;receivedAt:string;items:TransferItem[];notes?:string},actor:SessionUser){
  await ensureSchema(); const existing=await getTransfer(id); if(!existing)throw new Error('Transfer not found');
  const status:TransferStatus=input.receiptStatus==='Complete'?'Received':'Received'; const before=`${existing.receiptStatus} · ${existing.receiverName??'No receiver'}`; const after=`${input.receiptStatus} · ${input.receiverName}`;
  await sql().begin(async tx=>{
    await tx`update opsvista_transfers set status=${status},receipt_status=${input.receiptStatus},receiver_id=${actor.id},receiver_name=${input.receiverName},received_at=${input.receivedAt},notes=${input.notes??existing.notes??null},items=${tx.json(input.items)},updated_at=now() where id=${id}`;
    await tx`insert into opsvista_transfer_audit (id,transfer_id,at,actor_id,actor_name,action,before_value,after_value,reason)
      values (${auditId()},${id},${new Date().toISOString()},${actor.id},${actor.name},'Receipt recorded',${before},${after},${input.notes?.trim()||'Receiving location recorded delivery condition'})`;
  });
  return getTransfer(id);
}
export async function reconcileTransfer(id:string,reason:string,actor:SessionUser){
  await ensureSchema(); const existing=await getTransfer(id);if(!existing)throw new Error('Transfer not found');
  await sql().begin(async tx=>{
    await tx`update opsvista_transfers set status='Reconciled',updated_at=now() where id=${id}`;
    await tx`insert into opsvista_transfer_audit (id,transfer_id,at,actor_id,actor_name,action,before_value,after_value,reason)
      values (${auditId()},${id},${new Date().toISOString()},${actor.id},${actor.name},'Transfer reconciled',${existing.status},'Reconciled',${reason})`;
  });
  return getTransfer(id);
}
