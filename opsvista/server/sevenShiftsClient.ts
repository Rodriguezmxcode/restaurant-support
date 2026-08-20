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
let resolvedCompanyIdCache:number|undefined;
async function oauthToken(){
  if(oauthCache&&oauthCache.expiresAt>Date.now()+60_000)return oauthCache.token;
  const id=oauthClientId(),secret=oauthClientSecret();
  if(!id||!secret)throw new Error('7shifts credentials are not configured');
  const body=new URLSearchParams({grant_type:'client_credentials',client_id:id,client_secret:secret,scope:'v1_access companies:read locations:read users:read roles:read shifts:read time_punches:read'});
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
  const text=await res.text();let json:unknown={};try{json=text?JSON.parse(text):{};}catch{json={message:text};}
  if(!res.ok){const detail=json&&typeof json==='object'?String((json as Json).detail||(json as Json).message||(json as Json).title||'').trim():'';throw new Error(`7shifts request failed (${res.status})${detail?`: ${detail.slice(0,300)}`:''}`);}
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

function nextCursor(value:unknown){
  if(!value||typeof value!=='object')return '';
  const meta=(value as Json).meta;
  if(!meta||typeof meta!=='object')return '';
  const cursor=(meta as Json).cursor;
  if(!cursor||typeof cursor!=='object')return '';
  const next=(cursor as Json).next;
  return typeof next==='string'?next:'';
}

async function requestAll(path:string,maxPages=20){
  const rows:Json[]=[];let cursor='';const seen=new Set<string>();
  for(let page=0;page<maxPages;page++){
    const separator=path.includes('?')?'&':'?';
    const raw=await request(`${path}${cursor?`${separator}cursor=${encodeURIComponent(cursor)}`:''}`);
    rows.push(...arrayFrom(raw));
    const next=nextCursor(raw);
    if(!next||seen.has(next))break;
    seen.add(next);cursor=next;
  }
  return rows;
}

export async function resolveCompanyId(){
  if(resolvedCompanyIdCache)return resolvedCompanyIdCache;
  const configured=companyId();if(configured)return configured;
  const companies=arrayFrom(await request('/companies'));
  const id=Number(companies[0]?.id);if(!Number.isFinite(id)||id<=0)throw new Error('Unable to resolve 7shifts company id');
  return id;
}

export async function listSevenShiftsLocations(){
  const candidates:number[]=[];const configured=companyId();if(configured)candidates.push(configured);
  try{for(const company of arrayFrom(await request('/companies'))){const id=Number(company.id);if(Number.isFinite(id)&&id>0&&!candidates.includes(id))candidates.push(id);}}catch(error){if(!candidates.length)throw error;}
  let lastError:unknown;
  for(const cid of candidates){try{const rows=arrayFrom(await request(`/company/${cid}/locations?limit=100`));const locations=rows.map(r=>({id:Number(r.id),name:String(r.name||`Location ${r.id}`)})).filter(r=>Number.isFinite(r.id)&&r.id>0);if(locations.length){resolvedCompanyIdCache=cid;return locations;}}catch(error){lastError=error;}}
  if(lastError)throw lastError;
  throw new Error('7shifts authenticated successfully but returned 0 locations. Verify that the access token belongs to the Puerto Vallarta company account and that its technical contact is an active company admin.');
}

export type SevenShiftsScheduleShift={
  id:number;
  start:string;
  end:string;
  location:string;
  role:string;
};

export type SevenShiftsEmployeeScheduleRisk={
  userId:number;
  employeeName:string;
  primaryLocation:string;
  locations:string[];
  role:string;
  workedHours:number;
  scheduledHours:number;
  remainingScheduledHours:number;
  projectedHours:number;
  overtimeHours:number;
  hourlyWage:number;
  estimatedOvertimeCost:number;
  nextShift?:SevenShiftsScheduleShift;
  status:'Overtime'|'Risk'|'Safe';
};

export type SevenShiftsLocationScheduleRisk={
  location:string;
  monitoredEmployees:number;
  riskEmployees:number;
  projectedOvertimeHours:number;
  estimatedOvertimeCost:number;
};

export type SevenShiftsScheduleRisk={
  start:string;
  end:string;
  generatedAt:string;
  thresholdHours:number;
  scheduledHours:number;
  riskEmployees:number;
  projectedOvertimeHours:number;
  estimatedOvertimeCost:number;
  employees:SevenShiftsEmployeeScheduleRisk[];
  locations:SevenShiftsLocationScheduleRisk[];
};

type ScheduleAccumulator={
  userId:number;
  employeeName:string;
  locations:Map<string,number>;
  roles:Map<string,number>;
  workedHours:number;
  scheduledHours:number;
  remainingScheduledHours:number;
  wageCentsWeighted:number;
  wageHours:number;
  userWageCents:number;
  nextShift?:SevenShiftsScheduleShift;
};

function roundHours(value:number){return Math.round((value+Number.EPSILON)*10)/10;}
function roundMoney(value:number){return Math.round((value+Number.EPSILON)*100)/100;}
function dateMs(value:unknown){const ms=typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(ms)?ms:NaN;}
function hoursBetween(start:unknown,end:unknown){const a=dateMs(start),b=dateMs(end);return Number.isFinite(a)&&Number.isFinite(b)&&b>a?(b-a)/3_600_000:0;}
function breakHours(value:unknown){
  if(!Array.isArray(value))return 0;
  return value.reduce((sum,item)=>{
    if(!item||typeof item!=='object')return sum;
    const row=item as Json;
    const explicit=numberField(row,['duration_minutes','minutes','break_minutes']);
    if(explicit!==undefined)return sum+Math.max(0,explicit/60);
    return sum+hoursBetween(stringField(row,['start','clocked_in','break_start']),stringField(row,['end','clocked_out','break_end']));
  },0);
}
function displayName(user:Json,userId:number){return [user.preferred_first_name||user.first_name,user.preferred_last_name||user.last_name].filter(Boolean).join(' ').trim()||String(user.email||`Employee ${userId}`);}
function addWeighted(map:Map<string,number>,key:string,hours:number){if(key)map.set(key,(map.get(key)||0)+Math.max(0,hours));}
function highestWeighted(map:Map<string,number>,fallback:string){return Array.from(map.entries()).sort((a,b)=>b[1]-a[1])[0]?.[0]||fallback;}

export async function getSevenShiftsScheduleRisk(start:string,end:string,locationNames?:string[]):Promise<SevenShiftsScheduleRisk>{
  const cid=await resolveCompanyId();
  const allLocations=await listSevenShiftsLocations();
  const wanted=locationNames?.length?allLocations.filter(location=>locationNames.some(name=>name.toLowerCase()===location.name.toLowerCase()||location.name.toLowerCase().includes(name.toLowerCase())||name.toLowerCase().includes(location.name.toLowerCase()))):allLocations;
  if(!wanted.length)throw new Error('7shifts returned no authorized locations for the schedule monitor');
  const wantedIds=new Set(wanted.map(location=>location.id));
  const locationMap=new Map(wanted.map(location=>[location.id,location.name]));
  const endExclusive=new Date(`${end}T00:00:00.000Z`);endExclusive.setUTCDate(endExclusive.getUTCDate()+1);
  const rangeStart=`${start}T00:00:00.000Z`,rangeEnd=endExclusive.toISOString();
  const shiftQuery=new URLSearchParams({limit:'500','start[gte]':rangeStart,'start[lte]':rangeEnd,include_draft:'false',deleted:'false',consider_tz_in_ranges:'true'});
  const punchQuery=new URLSearchParams({limit:'500',business_date_start:start,business_date_end:end,deleted:'false',localize_search_time:'true'});
  const [users,roles,shifts,punches]=await Promise.all([
    requestAll(`/company/${cid}/users?status=active&limit=500`),
    requestAll(`/company/${cid}/roles?limit=500`),
    requestAll(`/company/${cid}/shifts?${shiftQuery.toString()}`),
    requestAll(`/company/${cid}/time_punches?${punchQuery.toString()}`),
  ]);
  const userMap=new Map(users.map(user=>[Number(user.id),user]));
  const roleMap=new Map(roles.map(role=>[Number(role.id),String(role.name||`Role ${role.id}`)]));
  const accumulators=new Map<number,ScheduleAccumulator>();
  const ensure=(userId:number)=>{
    const user=userMap.get(userId)||{};
    let row=accumulators.get(userId);
    if(!row){row={userId,employeeName:displayName(user,userId),locations:new Map(),roles:new Map(),workedHours:0,scheduledHours:0,remainingScheduledHours:0,wageCentsWeighted:0,wageHours:0,userWageCents:Number(user.hourly_wage)||0};accumulators.set(userId,row);}
    return row;
  };
  const now=Math.min(Date.now(),dateMs(rangeEnd));
  for(const shift of shifts){
    const locationId=Number(shift.location_id),userId=Number(shift.user_id);
    if(!wantedIds.has(locationId)||!Number.isFinite(userId)||userId<=0||shift.deleted===true||shift.draft===true||shift.open===true||shift.unassigned===true)continue;
    const startMs=dateMs(shift.start),endMs=dateMs(shift.end);
    if(!Number.isFinite(startMs)||!Number.isFinite(endMs)||endMs<=startMs)continue;
    const duration=Math.max(0,(endMs-startMs)/3_600_000-breakHours(shift.breaks));
    const location=locationMap.get(locationId)||`Location ${locationId}`;
    const role=roleMap.get(Number(shift.role_id))||String(shift.station_name||'Unassigned role');
    const row=ensure(userId);row.scheduledHours+=duration;addWeighted(row.locations,location,duration);addWeighted(row.roles,role,duration);
    if(endMs>now){
      const remaining=startMs>=now?duration:duration*Math.max(0,Math.min(1,(endMs-now)/(endMs-startMs)));
      row.remainingScheduledHours+=remaining;
      const candidate={id:Number(shift.id)||0,start:String(shift.start),end:String(shift.end),location,role};
      if(!row.nextShift||dateMs(candidate.start)<dateMs(row.nextShift.start))row.nextShift=candidate;
    }
    const wage=Number(shift.hourly_wage)||0;if(wage>0&&duration>0){row.wageCentsWeighted+=wage*duration;row.wageHours+=duration;}
  }
  for(const punch of punches){
    const locationId=Number(punch.location_id),userId=Number(punch.user_id);
    if(!wantedIds.has(locationId)||!Number.isFinite(userId)||userId<=0||punch.deleted===true)continue;
    const clockedIn=String(punch.clocked_in||''),clockedOut=String(punch.clocked_out||new Date(now).toISOString());
    const duration=Math.max(0,hoursBetween(clockedIn,clockedOut)-breakHours(punch.breaks));if(!duration)continue;
    const location=locationMap.get(locationId)||`Location ${locationId}`;
    const role=roleMap.get(Number(punch.role_id))||'Unassigned role';
    const row=ensure(userId);row.workedHours+=duration;addWeighted(row.locations,location,duration);addWeighted(row.roles,role,duration);
    const wage=Number(punch.hourly_wage)||0;if(wage>0){row.wageCentsWeighted+=wage*duration;row.wageHours+=duration;}
  }
  const thresholdHours=40;
  const employees=Array.from(accumulators.values()).map<SevenShiftsEmployeeScheduleRisk>(row=>{
    const projectedHours=row.workedHours+row.remainingScheduledHours;
    const overtimeHours=Math.max(0,projectedHours-thresholdHours);
    const wageCents=row.userWageCents>0?row.userWageCents:(row.wageHours?row.wageCentsWeighted/row.wageHours:0);
    const primaryLocation=row.nextShift?.location||highestWeighted(row.locations,'Unknown location');
    return {userId:row.userId,employeeName:row.employeeName,primaryLocation,locations:Array.from(row.locations.keys()).sort(),role:row.nextShift?.role||highestWeighted(row.roles,'Unassigned role'),workedHours:roundHours(row.workedHours),scheduledHours:roundHours(row.scheduledHours),remainingScheduledHours:roundHours(row.remainingScheduledHours),projectedHours:roundHours(projectedHours),overtimeHours:roundHours(overtimeHours),hourlyWage:roundMoney(wageCents/100),estimatedOvertimeCost:roundMoney(overtimeHours*wageCents/100*1.5),nextShift:row.nextShift,status:overtimeHours>0?'Overtime':projectedHours>=38?'Risk':'Safe'};
  }).sort((a,b)=>b.overtimeHours-a.overtimeHours||b.projectedHours-a.projectedHours||a.employeeName.localeCompare(b.employeeName));
  const locations=Array.from(locationMap.values()).map<SevenShiftsLocationScheduleRisk>(location=>{
    const rows=employees.filter(employee=>employee.primaryLocation===location);
    return {location,monitoredEmployees:rows.length,riskEmployees:rows.filter(employee=>employee.overtimeHours>0).length,projectedOvertimeHours:roundHours(rows.reduce((sum,employee)=>sum+employee.overtimeHours,0)),estimatedOvertimeCost:roundMoney(rows.reduce((sum,employee)=>sum+employee.estimatedOvertimeCost,0))};
  }).sort((a,b)=>b.projectedOvertimeHours-a.projectedOvertimeHours||a.location.localeCompare(b.location));
  return {start,end,generatedAt:new Date().toISOString(),thresholdHours,scheduledHours:roundHours(employees.reduce((sum,employee)=>sum+employee.scheduledHours,0)),riskEmployees:employees.filter(employee=>employee.overtimeHours>0).length,projectedOvertimeHours:roundHours(employees.reduce((sum,employee)=>sum+employee.overtimeHours,0)),estimatedOvertimeCost:roundMoney(employees.reduce((sum,employee)=>sum+employee.estimatedOvertimeCost,0)),employees,locations};
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
    const c=numberField(o,['completed','completed_tasks','completed_count','tasks_completed','total_tasks_completed']);
    if(t!==undefined||c!==undefined){total=Math.max(total,t??0);completed=Math.max(completed,c??0);found=true;}
    const taskLists=o.task_lists||o.taskLists||o.lists;
    if(Array.isArray(taskLists))for(const item of taskLists){if(!item||typeof item!=='object')continue;const q=item as Json;const qt=numberField(q,['total','total_tasks','task_count','tasks_count','total_count']);const qc=numberField(q,['completed','completed_tasks','completed_count','tasks_completed','total_tasks_completed']);if(qt!==undefined||qc!==undefined){total+=(qt??0);completed+=(qc??0);found=true;}}
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
      const completed=explicitCompleted??(status==='completed'||status==='complete'||!!completedAt);
      const key=`${date}:${locationId}:${taskId??path}:${taskName}`;
      if(!seen.has(key)){seen.add(key);let late: boolean|undefined; if(completedAt&&dueAt){const c=Date.parse(completedAt),d=Date.parse(dueAt);if(Number.isFinite(c)&&Number.isFinite(d))late=c>d;}
        out.push({key,date,locationId,locationName,taskId,taskName,userId,userName,completed,completedAt,late});}
    }
    for(const [k,v] of Object.entries(o)){if(['raw','meta'].includes(k))continue;if(v&&typeof v==='object')walk(v,`${path}.${k}`);}
  };
  walk(raw,'root');return out;
}

export async function taskDailySummary(locationId:number,locationName:string,date:string,includeDetail=true):Promise<SevenShiftsTaskDay>{
  const cid=await resolveCompanyId();
  const raw=await request(`/company/${cid}/task_list_daily_summary?location_id=${encodeURIComponent(String(locationId))}&date=${encodeURIComponent(date)}`);
  let counts=summaryCounts(raw);
  let accountability=accountabilityFromRaw(raw,date,locationId,locationName);
  let detailRaw:unknown=raw;
  if(includeDetail&&!accountability.length){
   try{
    const activeRaw=await request(`/company/${cid}/task_lists?location_id=${encodeURIComponent(String(locationId))}&active_on_date=${encodeURIComponent(date)}`);
    const active=arrayFrom(activeRaw);
    const details:unknown[]=[];
    for(const list of active.slice(0,50)){
      const id=numberField(list,['id','task_list_id']);
      if(id!==undefined)details.push(await request(`/company/${cid}/task_lists/${id}`));
      else details.push(list);
    }
    if(details.length){
      detailRaw={data:details};
      accountability=accountabilityFromRaw(detailRaw,date,locationId,locationName);
      const detailCounts=summaryCounts(detailRaw);
      if(!counts.total&&detailCounts.total)counts=detailCounts;
    }
   }catch{ /* Summary remains usable when task-list detail is unavailable on the current 7shifts plan. */ }
  }
  return {date,locationId,locationName,...counts,accountability,detailAvailable:accountability.length>0,raw:detailRaw};
}

function datesInclusive(start:string,end:string){const out:string[]=[];const d=new Date(`${start}T00:00:00Z`),last=new Date(`${end}T00:00:00Z`);for(;d<=last;d.setUTCDate(d.getUTCDate()+1))out.push(d.toISOString().slice(0,10));return out;}

export async function weeklyTaskCompliance(start:string,end:string,locationNames?:string[]){
  const all=await listSevenShiftsLocations();
  const wanted=locationNames?.length?all.filter(l=>locationNames.some(n=>n.localeCompare(l.name,undefined,{sensitivity:'base'})===0)):all;
  const dates=datesInclusive(start,end);
  const locations:SevenShiftsLocationWeek[]=[];
  const includeDetail=wanted.length===1;
  for(const loc of wanted){
    const days:SevenShiftsTaskDay[]=await Promise.all(dates.map(date=>taskDailySummary(loc.id,loc.name,date,includeDetail)));
    const total=days.reduce((s,d)=>s+d.total,0),completed=days.reduce((s,d)=>s+d.completed,0);const accountability=days.flatMap(d=>d.accountability);
    locations.push({locationId:loc.id,locationName:loc.name,total,completed,incomplete:Math.max(0,total-completed),completionPct:total>0?completed/total*100:null,accountability,detailAvailable:accountability.length>0,days});
  }
  const total=locations.reduce((s,l)=>s+l.total,0),completed=locations.reduce((s,l)=>s+l.completed,0);const accountability=locations.flatMap(l=>l.accountability);
  const byUser=new Map<string,{userId?:number;userName:string;completed:number;incomplete:number;late:number;tasks:number}>();
  for(const a of accountability){const key=String(a.userId??a.userName??'Unassigned');const row=byUser.get(key)??{userId:a.userId,userName:a.userName||'Unassigned / unknown',completed:0,incomplete:0,late:0,tasks:0};row.tasks++;if(a.completed)row.completed++;else row.incomplete++;if(a.late)row.late++;byUser.set(key,row);}
  return {companyId:await resolveCompanyId(),start,end,total,completed,incomplete:Math.max(0,total-completed),completionPct:total>0?completed/total*100:null,detailAvailable:accountability.length>0,accountability,people:Array.from(byUser.values()).sort((a,b)=>b.incomplete-a.incomplete||b.late-a.late||b.tasks-a.tasks),locations};
}

export type SevenShiftsLogbookEntry={
  id:number;
  date:string;
  locationId:number;
  locationName:string;
  userId?:number;
  author:string;
  categoryId?:number;
  category:string;
  message:string;
  attachments:number;
};

export async function listSevenShiftsLogbook(start:string,end:string,locationNames?:string[]):Promise<SevenShiftsLogbookEntry[]>{
  const cid=await resolveCompanyId();
  const locations=await listSevenShiftsLocations();
  const wanted=locationNames?.length?locations.filter(l=>locationNames.some(n=>n.toLowerCase()===l.name.toLowerCase()||l.name.toLowerCase().includes(n.toLowerCase())||n.toLowerCase().includes(l.name.toLowerCase()))):locations;
  const locationMap=new Map(wanted.map(l=>[l.id,l.name]));
  const [postsRaw,categoriesRaw,usersRaw]=await Promise.all([
    request(`/company/${cid}/log_book_posts?posted_date_gte=${encodeURIComponent(start)}&posted_date_lte=${encodeURIComponent(end)}&order_field=date&order_dir=desc&limit=100`),
    request(`/company/${cid}/log_book_categories`),
    request(`/company/${cid}/users?limit=100`),
  ]);
  const categories=new Map(arrayFrom(categoriesRaw).map(row=>[Number(row.id),String(row.name||'Logbook')]));
  const users=new Map(arrayFrom(usersRaw).map(row=>[Number(row.id),[row.preferred_first_name||row.first_name,row.preferred_last_name||row.last_name].filter(Boolean).join(' ').trim()||String(row.email||`User ${row.id}`)]));
  return arrayFrom(postsRaw).flatMap(row=>{
    const locationId=Number(row.location_id);if(!locationMap.has(locationId))return [];
    const id=Number(row.id);const userId=numberField(row,['user_id','created_by_user_id','author_user_id']);
    const categoryId=numberField(row,['log_book_category_id','category_id']);
    const attachments=Array.isArray(row.attachments)?row.attachments.length:0;
    return [{id:Number.isFinite(id)?id:0,date:stringField(row,['date','posted_date','created'])?.slice(0,10)||start,locationId,locationName:locationMap.get(locationId)||`Location ${locationId}`,userId,author:userId!==undefined?(users.get(userId)||`User ${userId}`):'Unknown author',categoryId,category:categoryId!==undefined?(categories.get(categoryId)||'Logbook'):'Logbook',message:stringField(row,['message','content','text'])||'',attachments}];
  });
}
