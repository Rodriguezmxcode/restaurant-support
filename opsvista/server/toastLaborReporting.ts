import { analyticsToastConfigured, analyticsToastResponse } from './toastClient.js';
import type { LaborReportStatus } from '../shared/laborCostSource.js';
import type { ToastEmployeeLabor } from './toastPerformance.js';

type ReportRow={restaurantGuid:string;employeeGuid:string;businessDate:string|number;regularHours:number;overtimeHours:number;regularCost:number;overtimeCost:number;totalCost:number;totalHours:number};
export type LaborReport={status:LaborReportStatus;rows:ReportRow[];retrievedAt?:string};
type CacheEntry={expiresAt:number;guid?:string;result?:LaborReport;inFlight?:Promise<LaborReport>};
const cache=new Map<string,CacheEntry>();
const ymd=(value:string)=>Number(value.replaceAll('-',''));
const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
const close=(a:number,b:number)=>Math.abs(a-b)<=0.011;

export function parseLaborReport(payload:unknown,start:string,end:string,restaurantIds:string[]):ReportRow[]{
  const rows=Array.isArray(payload)?payload:payload&&typeof payload==='object'&&'restaurantGuid' in payload?[payload]:null;
  if(!rows)throw new Error('Invalid Toast labor report');
  const allowed=new Set(restaurantIds),seen=new Set<string>();
  return rows.map(value=>{
    if(!value||typeof value!=='object')throw new Error('Invalid Toast labor report row');
    const row=value as ReportRow;
    const date=Number(row.businessDate);
    if(!allowed.has(row.restaurantGuid)||typeof row.employeeGuid!=='string'||!row.employeeGuid||!Number.isInteger(date)||date<ymd(start)||date>ymd(end))throw new Error('Toast labor report scope mismatch');
    for(const key of ['regularHours','overtimeHours','regularCost','overtimeCost','totalCost','totalHours'] as const){if(typeof row[key]!=='number'||!Number.isFinite(row[key])||row[key]<0)throw new Error('Incomplete Toast labor report');}
    if(!close(row.totalHours,row.regularHours+row.overtimeHours)||!close(row.totalCost,row.regularCost+row.overtimeCost))throw new Error('Inconsistent Toast labor report');
    const identity=`${row.restaurantGuid}:${row.employeeGuid}:${date}`;
    if(seen.has(identity))throw new Error('Duplicate Toast labor report row');seen.add(identity);
    return row;
  });
}

// Analytics is optional. It must never prevent fresh time entries from loading.
// Reuse report GUIDs while Toast prepares them; never treat HTTP 202 as zero cost.
export async function getToastLaborReport(start:string,end:string,restaurantIds:string[]):Promise<LaborReport>{
  if(!analyticsToastConfigured())return {status:'not_configured',rows:[]};
  if(!restaurantIds.length)return {status:'unavailable',rows:[]};
  const key=JSON.stringify([process.env.TOAST_ANALYTICS_API_HOST,process.env.TOAST_ANALYTICS_CLIENT_ID,start,end,[...restaurantIds].sort()]);
  const now=Date.now();
  for(const [key,entry] of cache)if(entry.expiresAt<now&&!entry.inFlight)cache.delete(key);
  let entry=cache.get(key);
  if(entry?.inFlight)return entry.inFlight;
  if(entry?.result)return entry.result;
  if(!entry){entry={expiresAt:now+600_000};cache.set(key,entry);}
  const current=entry;
  current.inFlight=(async()=>{
    const signal=AbortSignal.timeout(12_000);
    try{
      if(!current.guid){
        const days=(Date.parse(end)-Date.parse(start))/86400000+1;
        const request=await analyticsToastResponse(`/era/v1/labor/${days===1?'day':days<=7?'week':'month'}`,{method:'POST',signal,body:JSON.stringify({startBusinessDate:ymd(start),endBusinessDate:ymd(end),restaurantIds,excludedRestaurantIds:[],groupBy:['EMPLOYEE']})});
        const guid=typeof request.data==='string'?request.data:(request.data as {reportRequestGuid?:unknown})?.reportRequestGuid;
        if(typeof guid!=='string'||!guid.trim())throw new Error('Missing Toast report ID');
        current.guid=guid;
      }
      for(let attempt=0;attempt<3;attempt++){
        const response=await analyticsToastResponse(`/era/v1/labor/${encodeURIComponent(current.guid)}`,{signal});
        if(response.status===200){
          const result:LaborReport={status:'ready',rows:parseLaborReport(response.data,start,end,restaurantIds),retrievedAt:new Date().toISOString()};
          current.result=result;current.expiresAt=Date.now()+600_000;return result;
        }
        if(response.status!==202)throw new Error('Unexpected Toast report response');
        if(attempt<2)await new Promise(resolve=>setTimeout(resolve,1000));
      }
      return {status:'pending',rows:[]} as LaborReport;
    }catch{
      current.guid=undefined;current.result={status:'unavailable',rows:[]};current.expiresAt=Date.now()+60_000;
      return current.result;
    }finally{current.inFlight=undefined;}
  })();
  // Keep a small bounded in-memory cache; it never stores credentials.
  if(cache.size>100){const oldest=[...cache.keys()].find(k=>k!==key&&!cache.get(k)?.inFlight);if(oldest)cache.delete(oldest);}
  return current.inFlight;
}

export function applyToastReportedCosts(rows:ToastEmployeeLabor[],report:LaborReport,restaurantGuid:string){
  if(report.status!=='ready')return {rows,status:report.status,source:'time_entry_estimate' as const};
  const totals=new Map<string,{regularHours:number;overtimeHours:number;regularCost:number;overtimeCost:number}>();
  for(const row of report.rows.filter(row=>row.restaurantGuid===restaurantGuid)){
    const total=totals.get(row.employeeGuid)||{regularHours:0,overtimeHours:0,regularCost:0,overtimeCost:0};
    for(const key of ['regularHours','overtimeHours','regularCost','overtimeCost'] as const)total[key]+=row[key];
    totals.set(row.employeeGuid,total);
  }
  const hourly=rows.filter(row=>row.employmentType==='hourly'&&row.totalHours>0);
  // A missing employee, stale hours, or mixed pay classification invalidates the
  // entire location overlay. Never combine a partial report with a complete total.
  const mismatch=hourly.some(row=>{const match=totals.get(row.employeeGuid);return !match||!close(match.regularHours,row.regularHours)||!close(match.overtimeHours,row.overtimeHours);})||[...totals].some(([guid,total])=>!hourly.some(row=>row.employeeGuid===guid)&&(total.regularHours+total.overtimeHours>0||total.regularCost+total.overtimeCost>0));
  if(mismatch)return {rows,status:'mismatch' as const,source:'time_entry_estimate' as const};
  // No returned rows is not evidence of a completed zero-pay report.
  if(!totals.size)return {rows,status:'mismatch' as const,source:'time_entry_estimate' as const};
  return {rows:rows.map(row=>{const cost=totals.get(row.employeeGuid);return row.employmentType==='hourly'&&cost?{...row,regularLaborCost:round(cost.regularCost),overtimeLaborCost:round(cost.overtimeCost),totalLaborCost:round(cost.regularCost+cost.overtimeCost),overtimeCostComplete:true,overtimeCostSource:'toast_reported' as const}:row;}),status:'ready' as const,source:'toast_reported' as const};
}
