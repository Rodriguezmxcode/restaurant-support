import { initialManagedDirectory } from './managementStore.js';

type Json=Record<string,unknown>;

export type SevenShiftsTaskAccountability={
  key:string;
  date:string;
  locationId:number;
  locationName:string;
  taskListId?:number;
  taskListName?:string;
  position?:string;
  frequency?:string;
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
  const body=new URLSearchParams({grant_type:'client_credentials',client_id:id,client_secret:secret,scope:'v1_access companies:read locations:read users:read roles:read shifts:read'});
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

async function requestAll(path:string,maxPages=20,requireComplete=false){
  const rows:Json[]=[];let cursor='';const seen=new Set<string>();
  for(let page=0;page<maxPages;page++){
    const separator=path.includes('?')?'&':'?';
    const raw=await request(`${path}${cursor?`${separator}cursor=${encodeURIComponent(cursor)}`:''}`);
    rows.push(...arrayFrom(raw));
    const next=nextCursor(raw);
    if(!next||seen.has(next))return rows;
    if(page===maxPages-1&&requireComplete)throw new Error(`7shifts pagination exceeded ${maxPages} pages for ${path.split('?')[0]}`);
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

export type SevenShiftsOnDutyManager={userId:number;name:string;role:string;shiftStart:string;shiftEnd:string;location:string};

export async function listSevenShiftsManagersOnDuty(locationName:string,at=new Date()):Promise<SevenShiftsOnDutyManager[]>{
  const cid=await resolveCompanyId();
  const locations=await listSevenShiftsLocations();
  const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/puerto\s+vallarta|mexican\s+restaurant|restaurant/g,'').replace(/[^a-z0-9]/g,'');
  const wanted=locations.find(row=>{const left=normalize(row.name),right=normalize(locationName);return left===right||left.includes(right)||right.includes(left);});
  if(!wanted)return [];
  const start=new Date(at.getTime()-12*60*60*1000).toISOString();
  const end=new Date(at.getTime()+12*60*60*1000).toISOString();
  const query=new URLSearchParams({limit:'500','start[gte]':start,'start[lte]':end,include_draft:'false',deleted:'false',consider_tz_in_ranges:'true'});
  const [users,roles,shifts]=await Promise.all([
    requestAll(`/company/${cid}/users?limit=500`),
    requestAll(`/company/${cid}/roles?limit=500`),
    requestAll(`/company/${cid}/shifts?${query.toString()}`),
  ]);
  const userMap=new Map(users.map(row=>[Number(row.id),row]));
  const roleMap=new Map(roles.map(row=>[Number(row.id),String(row.name||row.title||'')]));
  const instant=at.getTime();
  return shifts.flatMap(shift=>{
    if(Number(shift.location_id)!==wanted.id||shift.deleted===true||shift.draft===true||shift.open===true||shift.unassigned===true)return [];
    const shiftStart=new Date(String(shift.start)).getTime(),shiftEnd=new Date(String(shift.end)).getTime();
    if(!Number.isFinite(shiftStart)||!Number.isFinite(shiftEnd)||instant<shiftStart||instant>shiftEnd)return [];
    const role=roleMap.get(Number(shift.role_id))||String(shift.station_name||'');
    if(!/(manager|management|gerente|\bmgr\b|general manager|gm)/i.test(role))return [];
    const user=userMap.get(Number(shift.user_id));if(!user)return [];
    return [{userId:Number(shift.user_id),name:displayName(user,Number(shift.user_id)),role,shiftStart:String(shift.start),shiftEnd:String(shift.end),location:wanted.name}];
  });
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
  externalEmployeeId?:string;
  primaryLocation:string;
  locations:string[];
  role:string;
  workedHours:number;
  scheduledHours:number;
  remainingScheduledHours:number;
  projectedHours:number;
  overtimeHours:number;
  actualOvertimeHours:number;
  hourlyWage:number|null;
  estimatedOvertimeCost:number|null;
  wageSource:'shift_or_punch'|'user_hourly'|'manual_override'|'unavailable';
  toastMatchStatus:'matched_external_id'|'matched_name'|'ambiguous'|'unmatched';
  employmentType:'hourly'|'salary';
  nextShift?:SevenShiftsScheduleShift;
  status:'Overtime'|'Risk'|'Safe'|'Salary';
};

export type SevenShiftsLocationScheduleRisk={
  location:string;
  monitoredEmployees:number;
  riskEmployees:number;
  actualOvertimeHours:number;
  additionalProjectedOvertimeHours:number;
  projectedOvertimeHours:number;
  salaryOver40Hours:number;
  unclassifiedToastOvertimeHours:number;
  unclassifiedToastEmployees:number;
  estimatedOvertimeCost:number;
  employeesMissingHourlyWage:number;
};

export type SevenShiftsScheduleRisk={
  start:string;
  end:string;
  generatedAt:string;
  thresholdHours:number;
  scheduledHours:number;
  riskEmployees:number;
  actualOvertimeHours:number;
  additionalProjectedOvertimeHours:number;
  projectedOvertimeHours:number;
  salaryOver40Hours:number;
  unclassifiedToastOvertimeHours:number;
  unclassifiedToastEmployees:number;
  estimatedOvertimeCost:number;
  employeesMissingHourlyWage:number;
  unmatchedToastEmployees:number;
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
  externalEmployeeId:string;
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
function salariedPosition(role:string){return /(^|[^a-z])(chef|manager|management|mgr|gm|gerente)(s|es)?([^a-z]|$)/i.test(role.normalize('NFD').replace(/[\u0300-\u036f]/g,''));}
type ScheduleEmployeeOverride={employeeName:string;location?:string;role?:string;employmentType?:'hourly'|'salary';hourlyWage?:number};
function configuredEmployeeOverrides():ScheduleEmployeeOverride[]{
  const confirmed:ScheduleEmployeeOverride[]=[
    {employeeName:'Edgar E. Huales Ramirez',location:'Orange',role:'Chef',employmentType:'salary'},
  ];
  const raw=process.env.OPSVISTA_SCHEDULE_EMPLOYEE_OVERRIDES_JSON;if(!raw)return confirmed;
  try{
    const parsed=JSON.parse(raw) as unknown;
    const rows=Array.isArray(parsed)?parsed:parsed&&typeof parsed==='object'?Object.entries(parsed as Record<string,unknown>).map(([employeeName,value])=>({...((value&&typeof value==='object'?value:{}) as Record<string,unknown>),employeeName})):[];
    return [...confirmed,...rows.flatMap(value=>{if(!value||typeof value!=='object')return[];const row=value as Record<string,unknown>,employeeName=String(row.employeeName||'').trim();if(!employeeName)return[];const hourlyWage=Number(row.hourlyWage);return[{employeeName,location:String(row.location||'').trim()||undefined,role:String(row.role||'').trim()||undefined,employmentType:row.employmentType==='salary'?'salary':row.employmentType==='hourly'?'hourly':undefined,hourlyWage:Number.isFinite(hourlyWage)&&hourlyWage>0&&hourlyWage<=250?hourlyWage:undefined}];})];
  }catch{return confirmed;}
}
function employeeIdentityMatches(configuredName:string,actualName:string){
  const configured=normalizedIdentity(configuredName),actual=normalizedIdentity(actualName);
  if(!configured||!actual)return false;
  if(configured===actual)return true;
  // 7shifts sometimes truncates the final character of a last name. Accept only
  // that narrow variation so a confirmed salary override is not silently lost.
  const [shorter,longer]=configured.length<actual.length?[configured,actual]:[actual,configured];
  return shorter.length>=8&&longer.length-shorter.length===1&&longer.startsWith(shorter);
}
function employeeOverride(employeeName:string,locations:string[]){
  const matches=configuredEmployeeOverrides().filter(row=>employeeIdentityMatches(row.employeeName,employeeName));
  if(!matches.length)return undefined;
  const locationMatch=matches.find(row=>!row.location||locations.some(location=>normalizedIdentity(location)===normalizedIdentity(row.location||'')));
  // A unique named override is authoritative for its configured location. This
  // also repairs records whose source system currently assigns the wrong site.
  return locationMatch||(matches.length===1?matches[0]:undefined);
}
function directoryManager(employeeName:string,locations:string[]){return initialManagedDirectory.some(user=>user.active&&user.role==='Location Manager'&&normalizedIdentity(user.name)===normalizedIdentity(employeeName)&&(!user.locations.length||user.locations.some(location=>locations.some(actual=>normalizedIdentity(actual)===normalizedIdentity(location)))));}

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
  const [users,roles,shifts]=await Promise.all([
    requestAll(`/company/${cid}/users?status=active&limit=500`),
    requestAll(`/company/${cid}/roles?limit=500`),
    requestAll(`/company/${cid}/shifts?${shiftQuery.toString()}`),
  ]);
  const userMap=new Map(users.map(user=>[Number(user.id),user]));
  const roleMap=new Map(roles.map(role=>[Number(role.id),String(role.name||`Role ${role.id}`)]));
  const accumulators=new Map<number,ScheduleAccumulator>();
  const ensure=(userId:number)=>{
    const user=userMap.get(userId)||{};
    let row=accumulators.get(userId);
    if(!row){row={userId,employeeName:displayName(user,userId),externalEmployeeId:String(user.employee_id||''),locations:new Map(),roles:new Map(),workedHours:0,scheduledHours:0,remainingScheduledHours:0};accumulators.set(userId,row);}
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
  }
  const thresholdHours=40;
  const employees=Array.from(accumulators.values()).map<SevenShiftsEmployeeScheduleRisk>(row=>{
    const projectedHours=row.workedHours+row.remainingScheduledHours;
    const scheduledLocations=Array.from(row.locations.keys()).sort(),detectedLocation=row.nextShift?.location||highestWeighted(row.locations,'Unknown location');
    const override=employeeOverride(row.employeeName,[detectedLocation,...scheduledLocations]),isDirectoryManager=directoryManager(row.employeeName,[detectedLocation,...scheduledLocations]);
    const primaryLocation=override?.location||detectedLocation;
    const role=override?.role||(isDirectoryManager?'Manager':row.nextShift?.role||highestWeighted(row.roles,'Unassigned role')),employmentType=override?.employmentType||(isDirectoryManager||salariedPosition(role)?'salary':'hourly');
    const overtimeHours=employmentType==='salary'?0:Math.max(0,projectedHours-thresholdHours);
    const hourlyWage=employmentType==='hourly'&&override?.hourlyWage?roundMoney(override.hourlyWage):null;
    return {userId:row.userId,employeeName:row.employeeName,externalEmployeeId:row.externalEmployeeId||undefined,primaryLocation,locations:scheduledLocations,role,workedHours:0,scheduledHours:roundHours(row.scheduledHours),remainingScheduledHours:roundHours(row.remainingScheduledHours),projectedHours:roundHours(projectedHours),overtimeHours:roundHours(overtimeHours),actualOvertimeHours:0,hourlyWage,estimatedOvertimeCost:hourlyWage===null?null:roundMoney(overtimeHours*hourlyWage*1.5),wageSource:hourlyWage===null?'unavailable':'manual_override',toastMatchStatus:'unmatched',employmentType,nextShift:row.nextShift?{...row.nextShift,role}:undefined,status:employmentType==='salary'?'Salary':overtimeHours>0?'Overtime':projectedHours>=38?'Risk':'Safe'};
  }).sort((a,b)=>b.overtimeHours-a.overtimeHours||b.projectedHours-a.projectedHours||a.employeeName.localeCompare(b.employeeName));
  const locations=Array.from(locationMap.values()).map<SevenShiftsLocationScheduleRisk>(location=>{
    const rows=employees.filter(employee=>employee.primaryLocation===location);
    const projectedOvertimeHours=roundHours(rows.reduce((sum,employee)=>sum+employee.overtimeHours,0));
    return {location,monitoredEmployees:rows.length,riskEmployees:rows.filter(employee=>employee.overtimeHours>0).length,actualOvertimeHours:0,additionalProjectedOvertimeHours:projectedOvertimeHours,projectedOvertimeHours,salaryOver40Hours:0,unclassifiedToastOvertimeHours:0,unclassifiedToastEmployees:0,estimatedOvertimeCost:roundMoney(rows.reduce((sum,employee)=>sum+(employee.estimatedOvertimeCost??0),0)),employeesMissingHourlyWage:rows.filter(employee=>employee.overtimeHours>0&&employee.estimatedOvertimeCost===null).length};
  }).sort((a,b)=>b.projectedOvertimeHours-a.projectedOvertimeHours||a.location.localeCompare(b.location));
  const projectedOvertimeHours=roundHours(employees.reduce((sum,employee)=>sum+employee.overtimeHours,0));
  return {start,end,generatedAt:new Date().toISOString(),thresholdHours,scheduledHours:roundHours(employees.reduce((sum,employee)=>sum+employee.scheduledHours,0)),riskEmployees:employees.filter(employee=>employee.overtimeHours>0).length,actualOvertimeHours:0,additionalProjectedOvertimeHours:projectedOvertimeHours,projectedOvertimeHours,salaryOver40Hours:0,unclassifiedToastOvertimeHours:0,unclassifiedToastEmployees:0,estimatedOvertimeCost:roundMoney(employees.reduce((sum,employee)=>sum+(employee.estimatedOvertimeCost??0),0)),employeesMissingHourlyWage:employees.filter(employee=>employee.overtimeHours>0&&employee.estimatedOvertimeCost===null).length,unmatchedToastEmployees:employees.length,employees,locations};
}

export type ToastEmployeeLaborForSchedule={employeeGuid:string;externalEmployeeId:string;employeeName:string;location:string;regularHours:number;overtimeHours:number;totalHours:number;hourlyWage:number|null;wageSource:'time_entry'|'employee_override'|'unavailable'};

function normalizedIdentity(value:string){return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function aggregateToastLabor(rows:ToastEmployeeLaborForSchedule[],thresholdHours=40){
  const totalHours=rows.reduce((sum,row)=>sum+row.totalHours,0);
  // Toast can report overtime per restaurant/time-entry record. An employee
  // working across locations may therefore have 0 reported OT in every row
  // even though their consolidated weekly hours exceed the company threshold.
  // Keep a larger source-reported value (when applicable), but never allow the
  // consolidated weekly calculation to understate overtime.
  const reportedOvertimeHours=rows.reduce((sum,row)=>sum+row.overtimeHours,0);
  const consolidatedOvertimeHours=Math.max(0,totalHours-thresholdHours);
  const actualOvertimeHours=Math.max(reportedOvertimeHours,consolidatedOvertimeHours);
  const known=rows.filter(row=>row.hourlyWage!==null);
  const weightedHours=known.reduce((sum,row)=>sum+Math.max(row.totalHours,0),0);
  const hourlyWage=known.length?(weightedHours?known.reduce((sum,row)=>sum+(row.hourlyWage??0)*Math.max(row.totalHours,0),0)/weightedHours:known.length===1?known[0].hourlyWage:null):null;
  return {workedHours:roundHours(totalHours),actualOvertimeHours:roundHours(actualOvertimeHours),hourlyWage:hourlyWage===null?null:roundMoney(hourlyWage)};
}

export function applyToastLaborToScheduleRisk(risk:SevenShiftsScheduleRisk,toastRows:ToastEmployeeLaborForSchedule[]):SevenShiftsScheduleRisk{
  const byExternal=new Map<string,ToastEmployeeLaborForSchedule[]>(),byName=new Map<string,ToastEmployeeLaborForSchedule[]>();
  const classifiedToastRows=new Set<ToastEmployeeLaborForSchedule>();
  for(const row of toastRows){
    const external=normalizedIdentity(row.externalEmployeeId||'');if(external)byExternal.set(external,[...(byExternal.get(external)||[]),row]);
    const name=normalizedIdentity(row.employeeName);if(name)byName.set(name,[...(byName.get(name)||[]),row]);
  }
  const employees=risk.employees.map(employee=>{
    const override=employeeOverride(employee.employeeName,[employee.primaryLocation,...employee.locations]);
    const employmentType=override?.employmentType??(employee.employmentType==='salary'||salariedPosition(override?.role||employee.role)?'salary':'hourly');
    const role=override?.role||employee.role,primaryLocation=override?.location||employee.primaryLocation,configuredWage=employmentType==='hourly'&&override?.hourlyWage?roundMoney(override.hourlyWage):null;
    const external=normalizedIdentity(employee.externalEmployeeId||'');let candidates=external?(byExternal.get(external)||[]):[];let toastMatchStatus:SevenShiftsEmployeeScheduleRisk['toastMatchStatus']='unmatched';
    if(candidates.length)toastMatchStatus='matched_external_id';
    else{
      const nameCandidates=byName.get(normalizedIdentity(employee.employeeName))||[];
      candidates=nameCandidates.filter(row=>employee.locations.some(location=>normalizedIdentity(location)===normalizedIdentity(row.location)));
      const identities=new Set(candidates.map(row=>normalizedIdentity(row.externalEmployeeId)||row.employeeGuid));
      if(candidates.length&&identities.size===1)toastMatchStatus='matched_name';else if(candidates.length>1){toastMatchStatus='ambiguous';candidates=[];}else if(candidates.length===1)toastMatchStatus='matched_name';
    }
    if(!candidates.length){const projectedHours=roundHours(employee.remainingScheduledHours),overtimeHours=employmentType==='salary'?0:roundHours(Math.max(0,projectedHours-risk.thresholdHours));return {...employee,role,primaryLocation,employmentType,workedHours:0,projectedHours,overtimeHours,actualOvertimeHours:0,hourlyWage:configuredWage,estimatedOvertimeCost:configuredWage===null?null:roundMoney(overtimeHours*configuredWage*1.5),wageSource:configuredWage===null?'unavailable' as const:'manual_override' as const,toastMatchStatus,status:employmentType==='salary'?'Salary' as const:projectedHours>risk.thresholdHours?'Overtime' as const:projectedHours>=38?'Risk' as const:'Safe' as const};}
    candidates.forEach(row=>classifiedToastRows.add(row));
    const actual=aggregateToastLabor(candidates,risk.thresholdHours),projectedHours=actual.workedHours+employee.remainingScheduledHours,overtimeHours=Math.max(0,projectedHours-risk.thresholdHours);
    if(employmentType==='salary')return {...employee,role,primaryLocation,employmentType,workedHours:actual.workedHours,projectedHours:roundHours(projectedHours),overtimeHours:0,actualOvertimeHours:actual.actualOvertimeHours,hourlyWage:null,estimatedOvertimeCost:null,wageSource:'unavailable' as const,toastMatchStatus,status:'Salary' as const};
    const hourlyWage=configuredWage??actual.hourlyWage;
    return {...employee,role,primaryLocation,employmentType,workedHours:actual.workedHours,projectedHours:roundHours(projectedHours),overtimeHours:roundHours(overtimeHours),actualOvertimeHours:actual.actualOvertimeHours,hourlyWage,estimatedOvertimeCost:hourlyWage===null?null:roundMoney(overtimeHours*hourlyWage*1.5),wageSource:configuredWage!==null?'manual_override' as const:actual.hourlyWage===null?'unavailable' as const:'shift_or_punch' as const,toastMatchStatus,status:overtimeHours>0?'Overtime' as const:projectedHours>=38?'Risk' as const:'Safe' as const};
  }).sort((a,b)=>b.overtimeHours-a.overtimeHours||b.projectedHours-a.projectedHours||a.employeeName.localeCompare(b.employeeName));
  const locations=risk.locations.map(location=>{
    const rows=employees.filter(employee=>employee.primaryLocation===location.location);
    const hourlyRows=rows.filter(employee=>employee.employmentType==='hourly');
    const salaryRows=rows.filter(employee=>employee.employmentType==='salary');
    const unclassifiedRows=toastRows.filter(row=>!classifiedToastRows.has(row)&&normalizedIdentity(row.location)===normalizedIdentity(location.location)&&row.overtimeHours>0);
    const actualOvertimeHours=roundHours(hourlyRows.reduce((sum,employee)=>sum+employee.actualOvertimeHours,0));
    const employeeProjectedOvertime=roundHours(hourlyRows.reduce((sum,employee)=>sum+employee.overtimeHours,0));
    const projectedOvertimeHours=roundHours(Math.max(actualOvertimeHours,employeeProjectedOvertime));
    const additionalProjectedOvertimeHours=roundHours(Math.max(0,projectedOvertimeHours-actualOvertimeHours));
    const salaryOver40Hours=roundHours(salaryRows.reduce((sum,employee)=>sum+Math.max(employee.actualOvertimeHours,employee.workedHours-risk.thresholdHours,0),0));
    const unclassifiedToastOvertimeHours=roundHours(unclassifiedRows.reduce((sum,row)=>sum+Math.max(0,row.overtimeHours),0));
    return {...location,monitoredEmployees:rows.length,riskEmployees:hourlyRows.filter(employee=>employee.overtimeHours>0).length,actualOvertimeHours,additionalProjectedOvertimeHours,projectedOvertimeHours,salaryOver40Hours,unclassifiedToastOvertimeHours,unclassifiedToastEmployees:unclassifiedRows.length,estimatedOvertimeCost:roundMoney(hourlyRows.reduce((sum,employee)=>sum+(employee.estimatedOvertimeCost??0),0)),employeesMissingHourlyWage:hourlyRows.filter(employee=>employee.overtimeHours>0&&employee.estimatedOvertimeCost===null).length};
  }).sort((a,b)=>b.projectedOvertimeHours-a.projectedOvertimeHours||a.location.localeCompare(b.location));
  const actualOvertimeHours=roundHours(locations.reduce((sum,location)=>sum+location.actualOvertimeHours,0));
  const projectedOvertimeHours=roundHours(locations.reduce((sum,location)=>sum+location.projectedOvertimeHours,0));
  return {...risk,employees,locations,riskEmployees:employees.filter(employee=>employee.employmentType==='hourly'&&employee.overtimeHours>0).length,actualOvertimeHours,additionalProjectedOvertimeHours:roundHours(Math.max(0,projectedOvertimeHours-actualOvertimeHours)),projectedOvertimeHours,salaryOver40Hours:roundHours(locations.reduce((sum,location)=>sum+location.salaryOver40Hours,0)),unclassifiedToastOvertimeHours:roundHours(locations.reduce((sum,location)=>sum+location.unclassifiedToastOvertimeHours,0)),unclassifiedToastEmployees:locations.reduce((sum,location)=>sum+location.unclassifiedToastEmployees,0),estimatedOvertimeCost:roundMoney(locations.reduce((sum,location)=>sum+location.estimatedOvertimeCost,0)),employeesMissingHourlyWage:locations.reduce((sum,location)=>sum+location.employeesMissingHourlyWage,0),unmatchedToastEmployees:employees.filter(employee=>employee.employmentType==='hourly'&&!employee.toastMatchStatus.startsWith('matched')).length};
}

function numberField(o:Json,names:string[]){for(const name of names){const v=Number(o[name]);if(Number.isFinite(v))return v;}return undefined;}
function stringField(o:Json,names:string[]){for(const name of names){const v=o[name];if(typeof v==='string'&&v.trim())return v.trim();}return undefined;}
function boolField(o:Json,names:string[]){for(const name of names){const v=o[name];if(typeof v==='boolean')return v;if(v===1||v==='1'||v==='true')return true;if(v===0||v==='0'||v==='false')return false;}return undefined;}

function taskPosition(value:string){
  const normalized=value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const roles:Array<[RegExp,string]>=[
    [/(^|\b)(sub\s*chef|sous\s*chef)(\b|$)/,'Subchef'],
    [/(^|\b)(key\s*holder|keyholder)(\b|$)/,'Keyholder'],
    [/(^|\b)(food\s*runner|runner)(\b|$)/,'Food Runner'],
    [/(^|\b)(line\s*leader)(\b|$)/,'Line Leader'],
    [/(^|\b)(dishwasher|lavaplatos)(\b|$)/,'Dishwasher'],
    [/(^|\b)(bartender|cantinero)(\b|$)/,'Bartender'],
    [/(^|\b)(barback)(\b|$)/,'Barback'],
    [/(^|\b)(manager|management|gerente|mgr)(\b|$)/,'Manager'],
    [/(^|\b)(chef)(\b|$)/,'Chef'],
    [/(^|\b)(busser|busboy)(\b|$)/,'Busser'],
    [/(^|\b)(server|mesero|mesera)(\b|$)/,'Server'],
    [/(^|\b)(host|hostess|anfitrion|anfitriona)(\b|$)/,'Host'],
    [/(^|\b)(cook|cocinero|cocinera)(\b|$)/,'Cook'],
  ];
  return roles.find(([pattern])=>pattern.test(normalized))?.[1];
}

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
  type TaskContext={taskListId?:number;taskListName?:string;position?:string;frequency?:string};
  const walk=(value:unknown,path:string,parent:TaskContext={})=>{
    if(Array.isArray(value)){value.forEach((x,i)=>walk(x,`${path}.${i}`,parent));return;}
    if(!value||typeof value!=='object')return;
    const o=value as Json;
    const taskArray=Array.isArray(o.tasks)||Array.isArray(o.task_items)||Array.isArray(o.items);
    const explicitListName=stringField(o,['task_list_name','taskListName','checklist_name','checklistName','template_name','templateName']);
    const objectName=taskArray?stringField(o,['name','title']):undefined;
    const taskListName=explicitListName||objectName||parent.taskListName;
    const taskListId=numberField(o,['task_list_id','taskListId','checklist_id','template_id'])??(taskArray?numberField(o,['id']):undefined)??parent.taskListId;
    const frequency=stringField(o,['frequency','frequency_name','recurrence','repeat'])||parent.frequency;
    const position=stringField(o,['position_name','position','role_name','role'])||taskPosition(taskListName||'')||parent.position;
    const context={taskListId,taskListName,position,frequency};
    const taskId=numberField(o,['task_id','taskId','id']);
    const taskName=stringField(o,['task_name','taskName','title','name','task']);
    const explicitCompleted=boolField(o,['completed','is_completed','isComplete','complete']);
    const status=stringField(o,['status','state'])?.toLowerCase();
    const completedAt=stringField(o,['completed_at','completedAt','completion_time','completed_on','completedOn']);
    const userId=numberField(o,['completed_by_user_id','completedByUserId','completed_by','user_id','userId','assignee_user_id','assigned_user_id']);
    const userName=stringField(o,['completed_by_name','completedByName','user_name','userName','assignee_name','employee_name']);
    const dueAt=stringField(o,['due_at','dueAt','due_time','dueTime','deadline']);
    const hasCompletionSignal=explicitCompleted!==undefined||status==='completed'||status==='complete'||!!completedAt||userId!==undefined;
    if(taskName&&hasCompletionSignal&&!taskArray){
      const completed=explicitCompleted??(status==='completed'||status==='complete'||!!completedAt);
      const key=`${date}:${locationId}:${taskId??path}:${taskName}`;
      if(!seen.has(key)){seen.add(key);let late: boolean|undefined; if(completedAt&&dueAt){const c=Date.parse(completedAt),d=Date.parse(dueAt);if(Number.isFinite(c)&&Number.isFinite(d))late=c>d;}
        out.push({key,date,locationId,locationName,taskListId,taskListName,position:position||taskPosition(taskName),frequency,taskId,taskName,userId,userName,completed,completedAt,late});}
    }
    for(const [k,v] of Object.entries(o)){if(['raw','meta'].includes(k))continue;if(v&&typeof v==='object')walk(v,`${path}.${k}`,context);}
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
  const [posts,categoriesRows,usersRows]=await Promise.all([
    requestAll(`/company/${cid}/log_book_posts?posted_date_gte=${encodeURIComponent(start)}&posted_date_lte=${encodeURIComponent(end)}&order_field=date&order_dir=desc&limit=100`,100,true),
    requestAll(`/company/${cid}/log_book_categories`,20,true),
    requestAll(`/company/${cid}/users?limit=100`,20,true),
  ]);
  const categories=new Map(categoriesRows.map(row=>[Number(row.id),String(row.name||'Logbook')]));
  const users=new Map(usersRows.map(row=>[Number(row.id),[row.preferred_first_name||row.first_name,row.preferred_last_name||row.last_name].filter(Boolean).join(' ').trim()||String(row.email||`User ${row.id}`)]));
  const seenEntryIds=new Set<number>();
  return posts.flatMap(row=>{
    const locationId=Number(row.location_id);if(!locationMap.has(locationId))return [];
    const id=Number(row.id);
    if(Number.isFinite(id)&&id>0){if(seenEntryIds.has(id))return[];seenEntryIds.add(id);}
    const date=stringField(row,['date','posted_date','created'])?.slice(0,10)||start;
    if(date<start||date>end)return [];
    const userId=numberField(row,['user_id','created_by_user_id','author_user_id']);
    const categoryId=numberField(row,['log_book_category_id','category_id']);
    const attachments=Array.isArray(row.attachments)?row.attachments.length:0;
    return [{id:Number.isFinite(id)?id:0,date,locationId,locationName:locationMap.get(locationId)||`Location ${locationId}`,userId,author:userId!==undefined?(users.get(userId)||`User ${userId}`):'Unknown author',categoryId,category:categoryId!==undefined?(categories.get(categoryId)||'Logbook'):'Logbook',message:stringField(row,['message','content','text'])||'',attachments}];
  });
}
