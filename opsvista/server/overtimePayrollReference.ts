import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
export type PayrollReference={start:string;end:string;providedAt:string;source:'user_provided_toast_payroll';locations:{location:string;hours:number;cost:number}[]};
const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
const validDate=(s:unknown):s is string=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export function parsePayrollReference(value:unknown):PayrollReference{
  if(!value||typeof value!=='object')throw new Error('Upload a payroll reference JSON file');
  const input=value as Record<string,unknown>;
  if(!validDate(input.start)||!validDate(input.end)||!validDate(input.providedAt))throw new Error('Use valid YYYY-MM-DD payroll dates');
  if(Date.parse(input.end)-Date.parse(input.start)!==6*86400000||new Date(input.start).getUTCDay()!==3)throw new Error('Payroll reference must cover Wednesday through Tuesday');
  if(!Array.isArray(input.locations)||!input.locations.length||input.locations.length>100)throw new Error('Include 1 to 100 locations');
  const seen=new Set<string>();
  const locations=input.locations.map((value:unknown)=>{
    if(!value||typeof value!=='object')throw new Error('Invalid payroll location');
    const row=value as Record<string,unknown>,location=typeof row.location==='string'?row.location.trim():'';
    if(!location||location.length>100||seen.has(location.toLowerCase()))throw new Error('Location names must be unique');
    seen.add(location.toLowerCase());
    if(typeof row.hours!=='number'||!Number.isFinite(row.hours)||row.hours<0||row.hours>100000||typeof row.cost!=='number'||!Number.isFinite(row.cost)||row.cost<0||row.cost>10000000)throw new Error('Hours and costs must be valid nonnegative numbers');
    return {location,hours:row.hours,cost:round(row.cost)};
  });
  return {start:input.start,end:input.end,providedAt:input.providedAt,source:'user_provided_toast_payroll',locations};
}
export function selectPayrollReference(reference:PayrollReference,start:string,end:string,workedThrough:string,locations:string[]){
  if(start!==reference.start||end!==reference.end||workedThrough!==end)return null;
  const rows=reference.locations.filter(row=>locations.some(location=>location.toLowerCase()===row.location.toLowerCase()));
  if(!rows.length)return null;
  return {...reference,locations:rows,hours:round(rows.reduce((sum,row)=>sum+row.hours,0)),cost:round(rows.reduce((sum,row)=>sum+row.cost,0))};
}
let client:ReturnType<typeof postgres>|undefined;
function db(){const url=process.env.OPSVISTA_DATABASE_URL||process.env.OPSVISTA_DATABASE_DATABASE_URL;if(!url)throw new Error('OpsVista database is not configured');return client??=postgres(url,{max:2,idle_timeout:20,connect_timeout:10});}
let ready:Promise<void>|undefined;
function schema(){return ready??=(async()=>{await db()`create table if not exists opsvista_overtime_payroll_references (id text primary key, organization_id text not null, period_start text not null, period_end text not null, payload jsonb not null, imported_by text not null, imported_at timestamptz not null default now())`;await db()`create index if not exists opsvista_overtime_payroll_period_idx on opsvista_overtime_payroll_references (organization_id,period_start,period_end,imported_at desc)`;})().catch(error=>{ready=undefined;throw error;});}
export async function savePayrollReference(organizationId:string,reference:PayrollReference,actorId:string){
  await schema();const sql=db();
  // Append-only imports retain prior versions for audit. The latest complete
  // period reference is used; an import never modifies Toast or payroll.
  await sql`insert into opsvista_overtime_payroll_references (id,organization_id,period_start,period_end,payload,imported_by) values (${randomUUID()},${organizationId},${reference.start},${reference.end},${sql.json(reference)},${actorId})`;
}
export async function getOvertimePayrollReference(organizationId:string,start:string,end:string,workedThrough:string,locations:string[]){
  if(workedThrough!==end)return null;
  if(!process.env.OPSVISTA_DATABASE_URL&&!process.env.OPSVISTA_DATABASE_DATABASE_URL)return null;
  await schema();const sql=db();
  const rows=await sql`select payload from opsvista_overtime_payroll_references where organization_id=${organizationId} and period_start=${start} and period_end=${end} order by imported_at desc,id desc limit 1`;
  if(!rows.length)return null;
  return selectPayrollReference(parsePayrollReference(rows[0].payload),start,end,workedThrough,locations);
}
