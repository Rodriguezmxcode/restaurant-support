import postgres from 'postgres';
import type { SessionUser } from './authSession.js';

export type ActionSeverity='High'|'Medium'|'Low';
export type ActionStatus='Open'|'Assigned'|'Investigating'|'Completed'|'Dismissed';
export type ActionVerificationStatus='Pending'|'Worked'|'Did not work'|'Not enough evidence yet';

export type ActionRecord={
  id:string;organizationId:string;location:string;category:string;title:string;severity:ActionSeverity;status:ActionStatus;
  signal:string;cause:string;recommendation:string;impact:string;ownerId?:string;ownerName?:string;dueAt?:string;
  automationKey?:string;automated:boolean;priorityScore:number;sources:string[];sourceIds:string[];detectedAt?:string;
  verificationStatus:ActionVerificationStatus;verificationNote?:string;verifiedAt?:string;
  createdById:string;createdByName:string;createdAt:string;updatedAt:string;
};

export type ActionCreateInput=Pick<ActionRecord,'location'|'category'|'title'|'severity'|'signal'|'cause'|'recommendation'|'impact'>&Partial<Pick<ActionRecord,'ownerId'|'ownerName'|'dueAt'|'automationKey'|'automated'|'priorityScore'|'sources'|'sourceIds'|'detectedAt'>>;
export type ActionUpdateInput=Partial<Pick<ActionRecord,'status'|'severity'|'ownerId'|'ownerName'|'dueAt'|'verificationStatus'|'verificationNote'|'verifiedAt'>>;

let client:ReturnType<typeof postgres>|undefined;
let initialized=false;
function databaseUrl(){return process.env.OPSVISTA_DATABASE_URL||process.env.OPSVISTA_DATABASE_DATABASE_URL||'';}
function sql(){const url=databaseUrl();if(!url)throw new Error('OpsVista database URL is not configured');if(!client)client=postgres(url,{max:4,idle_timeout:20,connect_timeout:10});return client;}
async function ensureSchema(){
  if(initialized)return;
  const db=sql();
  await db`create table if not exists opsvista_actions (
    id text primary key, organization_id text not null, location text not null, category text not null, title text not null,
    severity text not null, status text not null default 'Open', signal text not null, cause text not null,
    recommendation text not null, impact text not null, owner_id text, owner_name text, due_at date,
    automation_key text, automated boolean not null default false, priority_score integer not null default 0,
    sources jsonb not null default '[]'::jsonb, source_ids jsonb not null default '[]'::jsonb, detected_at timestamptz,
    verification_status text not null default 'Pending', verification_note text, verified_at timestamptz,
    created_by_id text not null, created_by_name text not null, created_at timestamptz not null, updated_at timestamptz not null default now()
  )`;
  await db`create table if not exists opsvista_action_audit (
    id text primary key, action_id text not null, at timestamptz not null, actor_id text not null, actor_name text not null,
    event text not null, before_value text, after_value text, reason text not null
  )`;
  await db`create index if not exists opsvista_actions_org_status_idx on opsvista_actions(organization_id,status,updated_at desc)`;
  await db`create index if not exists opsvista_actions_location_idx on opsvista_actions(organization_id,location,updated_at desc)`;
  await db`create index if not exists opsvista_actions_automation_idx on opsvista_actions(organization_id,automation_key)`;
  await db`create index if not exists opsvista_action_audit_idx on opsvista_action_audit(action_id,at desc)`;
  initialized=true;
}
const strings=(value:unknown)=>Array.isArray(value)?value.filter(item=>typeof item==='string') as string[]:[];
function norm(row:Record<string,unknown>):ActionRecord{return{
  id:String(row.id),organizationId:String(row.organization_id),location:String(row.location),category:String(row.category),title:String(row.title),
  severity:String(row.severity) as ActionSeverity,status:String(row.status) as ActionStatus,signal:String(row.signal),cause:String(row.cause),
  recommendation:String(row.recommendation),impact:String(row.impact),ownerId:row.owner_id?String(row.owner_id):undefined,ownerName:row.owner_name?String(row.owner_name):undefined,
  dueAt:row.due_at?String(row.due_at).slice(0,10):undefined,automationKey:row.automation_key?String(row.automation_key):undefined,
  automated:Boolean(row.automated),priorityScore:Number(row.priority_score)||0,sources:strings(row.sources),sourceIds:strings(row.source_ids),
  detectedAt:row.detected_at?new Date(String(row.detected_at)).toISOString():undefined,verificationStatus:String(row.verification_status) as ActionVerificationStatus,
  verificationNote:row.verification_note?String(row.verification_note):undefined,verifiedAt:row.verified_at?new Date(String(row.verified_at)).toISOString():undefined,
  createdById:String(row.created_by_id),createdByName:String(row.created_by_name),createdAt:new Date(String(row.created_at)).toISOString(),updatedAt:new Date(String(row.updated_at)).toISOString(),
};}
const organization=(user:SessionUser)=>user.organizationId||'org-puerto-vallarta';
const canSee=(user:SessionUser,row:ActionRecord)=>['Founder','Corporate','HR','Administration','Maintenance'].includes(user.role)||user.locations.includes(row.location);
const auditId=()=>`aca-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;

export async function listActions(user:SessionUser){await ensureSchema();const rows=await sql()`select * from opsvista_actions where organization_id=${organization(user)} order by priority_score desc,updated_at desc limit 1000`;return rows.map(row=>norm(row)).filter(row=>canSee(user,row));}
export async function getAction(id:string){await ensureSchema();const rows=await sql()`select * from opsvista_actions where id=${id} limit 1`;return rows[0]?norm(rows[0]):null;}
export async function listActionAudit(id:string){await ensureSchema();return await sql()`select * from opsvista_action_audit where action_id=${id} order by at desc`;}

export async function createAction(input:ActionCreateInput,actor:SessionUser){
  await ensureSchema();const db=sql();const org=organization(actor);
  if(input.automationKey){const existing=await db`select * from opsvista_actions where organization_id=${org} and automation_key=${input.automationKey} and status not in ('Completed','Dismissed') order by updated_at desc limit 1`;if(existing[0])return norm(existing[0]);}
  const id=`ACT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;const at=new Date().toISOString();
  await db.begin(async tx=>{
    await tx`insert into opsvista_actions(id,organization_id,location,category,title,severity,status,signal,cause,recommendation,impact,owner_id,owner_name,due_at,automation_key,automated,priority_score,sources,source_ids,detected_at,verification_status,created_by_id,created_by_name,created_at)
      values(${id},${org},${input.location},${input.category},${input.title},${input.severity},'Open',${input.signal},${input.cause},${input.recommendation},${input.impact},${input.ownerId??null},${input.ownerName??null},${input.dueAt??null},${input.automationKey??null},${input.automated??false},${input.priorityScore??0},${tx.json(input.sources??[])},${tx.json(input.sourceIds??[])},${input.detectedAt??at},'Pending',${actor.id},${actor.name},${at})`;
    await tx`insert into opsvista_action_audit(id,action_id,at,actor_id,actor_name,event,after_value,reason) values(${auditId()},${id},${at},${actor.id},${actor.name},'Action created','Open',${input.signal})`;
  });
  return getAction(id);
}

export async function updateActionRecord(id:string,patch:ActionUpdateInput,reason:string,actor:SessionUser){
  await ensureSchema();const existing=await getAction(id);if(!existing)throw new Error('Action not found');
  if(existing.organizationId!==organization(actor))throw new Error('Action not found');
  const next={...existing,...patch,updatedAt:new Date().toISOString()};
  const before=`${existing.status} · ${existing.ownerName||'Unassigned'} · ${existing.verificationStatus}`;
  const after=`${next.status} · ${next.ownerName||'Unassigned'} · ${next.verificationStatus}`;
  await sql().begin(async tx=>{
    await tx`update opsvista_actions set status=${next.status},severity=${next.severity},owner_id=${next.ownerId??null},owner_name=${next.ownerName??null},due_at=${next.dueAt??null},verification_status=${next.verificationStatus},verification_note=${next.verificationNote??null},verified_at=${next.verifiedAt??null},updated_at=now() where id=${id}`;
    await tx`insert into opsvista_action_audit(id,action_id,at,actor_id,actor_name,event,before_value,after_value,reason) values(${auditId()},${id},${new Date().toISOString()},${actor.id},${actor.name},'Action updated',${before},${after},${reason||'Action updated'})`;
  });
  return getAction(id);
}
