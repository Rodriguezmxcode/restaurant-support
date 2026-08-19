type Json=Record<string,unknown>;

export type SevenShiftsTaskAccountability={
  key:string;
  date:string;
  locationId:number;
  locationName:string;
  taskId?:number;
  taskName:string;
  userId?:number;
  userName?:string;
  completed:boolean;
  completedAt?:string;
  late?:boolean;
};

export type SevenShiftsTaskDay={
  date:string;
  locationId:number;
  locationName:string;
  total:number;
  completed:number;
  incomplete:number;
  completionPct:number|null;
  accountability:SevenShiftsTaskAccountability[];
  detailAvailable:boolean;
  raw:unknown;
};

export type SevenShiftsLocationWeek={
  locationId:number;
  locationName:string;
  total:number;
  completed:number;
  incomplete:number;
  completionPct:number|null;
  accountability:SevenShiftsTaskAccountability[];
  detailAvailable:boolean;
  days:SevenShiftsTaskDay[];
};

const API='https://api.7shifts.com/v2';
const VERSION='2026-01-01';

function env(name:string){return (process.env[name]||'').trim();}
function accessToken(){return env('SEVENSHIFTS_ACCESS_TOKEN')||env('SEVEN_SHIFTS_ACCESS_TOKEN');}
function companyId(){const v=env('SEVENSHIFTS_COMPANY_ID')||env('SEVEN_SHIFTS_COMPANY_ID');return v?Number(v):0;}
function companyGuid(){return env('SEVENSHIFTS_COMPANY_GUID')||env('SEVEN_SHIFTS_COMPANY_GUID');}
function oauthClientId(){return env('SEVENSHIFTS_CLIENT_ID')||env('SEVEN_SHIFTS_CLIENT_ID');}
function oauthClientSecret(){return env('SEVENSHIFTS_CLIENT_SECRET')||env('SEVEN_SHIFTS_CLIENT_SECRET');}

let oauthCache:{token:string;expiresAt:number}|undefined;
async function oauthToken(){
  if(oauthCache&&oauthCache.expiresAt>Date.now()+60_000)return oauthCache.token;
  const id=oauthClientId(),secret=oauthClientSecret();
  if(!id||!secret)throw new Error('7shifts credentials are not configured');
  const body=new URLSearchParams({grant_type:'client_credentials',client_id:id,client_secret:secret,scope:'companies:read locations:read users:read'});
  const res=await fetch('https://app.7shifts.com/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
  const json=await res.json().catch(()=>({})) as Json;
  if(!res.ok||typeof json.access_token!=='string')throw new Error(`7shifts OAuth failed (${res.status})`);
  const expires=Number(json.expires_in)||3600;oauthCache={token:json.access_token,expiresAt:Date.now()+expires*1000};return oauthCache.token;
}

async function token(){const direct=accessToken();return direct||oauthToken();}
async function request(path:string){
  const t=await token();
  const headers:Record<string,string>={Authorization:`Bearer ${t}`,'x-api-version':VERSION,Accept:'application/json'};
  if(!accessToken()&&companyGuid())headers['x-company-guid']=companyGuid();
  const res=await fetch(`${API}${path}`,{headers,cache:'no-store'});
  const json=await res.json().catch(()=>({})) as unknown;
  if(!res.ok)throw new Error(`7shifts request failed (${res.status})`);
  return json;
}

function arrayFrom(value:unknown):Json[]{
  if(Array.isArray(value))return value.filter(x=>x&&typeof x==='object') as Json[];
  if(value&&typeof value==='object'){
    const o=value as Json;
    if(Array.isArray(o.data))return o.data.filter(x=>x&&typeof x==='object') as Json[];
    if(o.data&&typeof o.data==='object'&&!Array.isArray(o.data))return [o.data as Json];
  }
  return [];
}

export async function resolveCompanyId(){
  const configured=companyId();if(configured)return configured;
  const companies=arrayFrom(await request('/companies'));
  const id=Number(companies[0]?.id);if(!Number.isFinite(id)||id<=0)throw new Error('Unable to resolve 7shifts company id');
  return id;
}

export async function listSevenShiftsLocations(){
  const cid=await resolveCompanyId();
  const rows=arrayFrom(await request(`/company/${cid}/locations`));
  return rows.map(r=>({id:Number(r.id),name:String(r.name||`Location ${r.id}`)})).filter(r=>Number.isFinite(r.id)&&r.id>0);
}

function numberField(o:Json,names:string[]){for(const name of names){const v=Number(o[name]);if(Number.isFinite(v))return v;}return undefined;}
function stringField(o:Json,names:string[]){for(const name of names){const v=o[name];if(typeof v==='string'&&v.trim())return v.trim();}return undefined;}
function boolField(o:Json,names:string[]){for(const name of names){const v=o[name];if(typeof v==='boolean')return v;if(v===1||v==='1'||v==='true')return true;if(v===0||v==='0'||v==='false')return false;}return undefined;}

function summaryCounts(raw:unknown){
  const candidates:Json[]=[];
  if(raw&&typeof raw==='object'){
    const r=raw as Json;candidates.push(r);
    if(r.data&&typeof r.data==='object'&&!Array.isArray(r.data))candidates.push(r.data as Json);
    if(Array.isArray(r.data))for(const x of r.data)if(x&&typeof x==='object')candidates.push(x as Json);
  }
  let total=0,completed=0,found=false;
  for(const o of candidates){
    const t=numberField(o,['total','total_tasks','task_count','tasks_count','total_count']);
    const c=numberField(o,['completed','completed_tasks','completed_count','tasks_completed']);
    if(t!==undefined||c!==undefined){total=Math.max(total,t??0);completed=Math.max(completed,c??0);found=true;}
    const taskLists=o.task_lists||o.taskLists||o.lists;
    if(Array.isArray(taskLists))for(const item of taskLists){if(!item||typeof item!=='object')continue;const q=item as Json;const qt=numberField(q,['total','total_tasks','task_count','tasks_count','total_count']);const qc=numberField(q,['completed','completed_tasks','completed_count','tasks_completed']);if(qt!==undefined||qc!==undefined){total+=(qt??0);completed+=(qc??0);found=true;}}
  }
  if(!found&&raw&&typeof raw==='object'&&Array.isArray((raw as Json).data)){
    const rows=(raw as Json).data as unknown[];
    let taskTotal=0,taskCompleted=0;
    for(const row of rows){if(!row||typeof row!=='object')continue;const o=row as Json;const tasks=o.tasks;if(Array.isArray(tasks)){for(const task of tasks){if(!task||typeof task!=='object')continue;taskTotal++;const t=task as Json;const done=t.completed===true||t.is_completed===true||String(t.status||'').toLowerCase()==='completed';if(done)taskCompleted++;}}}
    if(taskTotal){total=taskTotal;completed=taskCompleted;found=true;}
  }
  completed=Math.min(completed,total||completed);if(!total&&completed)total=completed;
  return {total,completed,incomplete:Math.max(0,total-completed),completionPct:total>0?completed/total*100:null};
}

function accountabilityFromRaw(raw:unknown,date:string,locationId:number,locationName:string){
  const out:SevenShiftsTaskAccountability[]=[];const seen=new Set<string>();
  const walk=(value:unknown,path:string)=>{
    if(Array.isArray(value)){value.forEach((x,i)=>walk(x,`${path}.${i}`));return;}
    if(!value||typeof value!=='object')return;
    const o=value as Json;
    const taskId=numberField(o,['task_id','taskId','id']);
    const taskName=stringField(o,['task_name','taskName','title','name','task']);
    const explicitCompleted=boolField(o,['completed','is_completed','isComplete','complete']);
    const status=stringField(o,['status','state'])?.toLowerCase();
    const completedAt=stringField(o,['completed_at','completedAt','completion_time','completed_on','completedOn']);
    const userId=numberField(o,['completed_by_user_id','completedByUserId','completed_by','user_id','userId','assignee_user_id','assigned_user_id']);
    const userName=stringField(o,['completed_by_name','completedByName','user_name','userName','assignee_name','employee_name']);
    const dueAt=stringField(o,['due_at','dueAt','due_time','dueTime','deadline']);
    const hasCompletionSignal=explicitCompleted!==undefined||status==='completed'||status==='complete'||!!completedAt||userId!==undefined;
    if(taskName&&hasCompletionSignal){
      const completed=explicitCompleted??status==='completed'||status==='complete'||!!completedAt;
      const key=`${date}:${locationId}:${taskId??path}:${taskName}`;
      if(!seen.has(key)){seen.add(key);let late: boolean|undefined; if(completedAt&&dueAt){const c=Date.parse(completedAt),d=Date.parse(dueAt);if(Number.isFinite(c)&&Number.isFinite(d))late=c>d;}
        out.push({key,date,locationId,locationName,taskId,taskName,userId,userName,completed,completedAt,late});}
    }
    for(const [k,v] of Object.entries(o)){if(['raw','meta'].includes(k))continue;if(v&&typeof v==='object')walk(v,`${path}.${k}`);}
  };
  walk(raw,'root');return out;
}

export async function taskDailySummary(locationId:number,locationName:string,date:string):Promise<SevenShiftsTaskDay>{
  const cid=await resolveCompanyId();
  const iso=`${date}T00:00:00.000Z`;
  const raw=await request(`/company/${cid}/task_list_daily_summary?location_id=${encodeURIComponent(String(locationId))}&date=${encodeURIComponent(iso)}`);
  const counts=summaryCounts(raw);const accountability=accountabilityFromRaw(raw,date,locationId,locationName);
  return {date,locationId,locationName,...counts,accountability,detailAvailable:accountability.length>0,raw};
}

function datesInclusive(start:string,end:string){const out:string[]=[];const d=new Date(`${start}T00:00:00Z`),last=new Date(`${end}T00:00:00Z`);for(;d<=last;d.setUTCDate(d.getUTCDate()+1))out.push(d.toISOString().slice(0,10));return out;}

export async function weeklyTaskCompliance(start:string,end:string,locationNames?:string[]){
  const all=await listSevenShiftsLocations();
  const wanted=locationNames?.length?all.filter(l=>locationNames.some(n=>n.localeCompare(l.name,undefined,{sensitivity:'base'})===0)):all;
  const dates=datesInclusive(start,end);
  const locations:SevenShiftsLocationWeek[]=[];
  for(const loc of wanted){
    const days:SevenShiftsTaskDay[]=[];
    for(const date of dates)days.push(await taskDailySummary(loc.id,loc.name,date));
    const total=days.reduce((s,d)=>s+d.total,0),completed=days.reduce((s,d)=>s+d.completed,0);const accountability=days.flatMap(d=>d.accountability);
    locations.push({locationId:loc.id,locationName:loc.name,total,completed,incomplete:Math.max(0,total-completed),completionPct:total>0?completed/total*100:null,accountability,detailAvailable:accountability.length>0,days});
  }
  const total=locations.reduce((s,l)=>s+l.total,0),completed=locations.reduce((s,l)=>s+l.completed,0);const accountability=locations.flatMap(l=>l.accountability);
  const byUser=new Map<string,{userId?:number;userName:string;completed:number;incomplete:number;late:number;tasks:number}>();
  for(const a of accountability){const key=String(a.userId??a.userName??'Unassigned');const row=byUser.get(key)??{userId:a.userId,userName:a.userName||'Unassigned / unknown',completed:0,incomplete:0,late:0,tasks:0};row.tasks++;if(a.completed)row.completed++;else row.incomplete++;if(a.late)row.late++;byUser.set(key,row);}
  return {companyId:await resolveCompanyId(),start,end,total,completed,incomplete:Math.max(0,total-completed),completionPct:total>0?completed/total*100:null,detailAvailable:accountability.length>0,accountability,people:Array.from(byUser.values()).sort((a,b)=>b.incomplete-a.incomplete||b.late-a.late||b.tasks-a.tasks),locations};
}
