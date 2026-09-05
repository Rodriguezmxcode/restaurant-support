import Constants from 'expo-constants';
import type {ActionNotificationDetail,ActionRecord,Assignee,OpsVistaUser,PerformanceResponse,SuggestedAssignee} from './types';

const configured=String(Constants.expoConfig?.extra?.apiBaseUrl||'').replace(/\/$/,'');
export const API_BASE_URL=configured||'https://restaurant-support.vercel.app';

async function request<T>(path:string,init?:RequestInit):Promise<T>{
  const response=await fetch(`${API_BASE_URL}${path}`,{...init,credentials:'include',headers:{Accept:'application/json',...(init?.body?{'Content-Type':'application/json'}:{}),...(init?.headers||{})}});
  const body=await response.json().catch(()=>({})) as T&{error?:string};
  if(!response.ok)throw new Error(body.error||`OpsVista request failed (${response.status})`);
  return body;
}

export const authApi={
  login:(email:string,password:string)=>request<{user:OpsVistaUser}>('/api/auth/login',{method:'POST',body:JSON.stringify({email,password})}),
  session:()=>request<{authenticated:boolean;user:OpsVistaUser}>('/api/auth/session'),
  logout:()=>request<{ok:boolean}>('/api/auth/logout',{method:'POST'}),
};

export function easternToday(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
export const performanceApi={today:()=>{const day=easternToday();return request<PerformanceResponse>(`/api/operations/performance?start=${day}&end=${day}&include_tasks=false`);}};
export const actionApi={
  list:()=>request<{actions:ActionRecord[];assignees:Assignee[]}>('/api/workflows?resource=actions'),
  detail:(id:string)=>request<{action:ActionRecord;notification:ActionNotificationDetail}>(`/api/workflows?resource=actions&id=${encodeURIComponent(id)}`),
  suggestions:(action:ActionRecord)=>request<{strategy:string;onDutyVerified:boolean;suggestions:SuggestedAssignee[]}>(`/api/workflows?resource=action_suggestions&location=${encodeURIComponent(action.location)}&category=${encodeURIComponent(action.category)}`),
  assign:(actionId:string,ownerId:string,acceptWithinMinutes:number)=>request<{action:ActionRecord}>('/api/workflows?resource=actions',{method:'PUT',body:JSON.stringify({id:actionId,status:'Assigned',ownerId,resendNotification:true,acceptWithinMinutes,reason:'Smart assignment sent from OpsVista Mobile'})}),
  receipt:(actionId:string,status:'Delivered'|'Seen'|'Accepted'|'In progress'|'Evidence submitted')=>request<ActionNotificationDetail>('/api/workflows?resource=action_notifications',{method:'POST',body:JSON.stringify({actionId,status})}),
  registerDevice:(token:string,platform:'ios'|'android',deviceName?:string)=>request<{registered:boolean}>('/api/workflows?resource=mobile_devices',{method:'POST',body:JSON.stringify({token,platform,deviceName,appVersion:Constants.expoConfig?.version||'unknown'})}),
};
