import { readSession } from '../../server/authSession.js';
import { weeklyTaskCompliance } from '../../server/sevenShiftsClient.js';

type ApiRequest={method?:string;headers?:{cookie?:string};query?:Record<string,string|string[]>};
type ApiResponse={status:(code:number)=>ApiResponse;json:(body:unknown)=>void;setHeader?:(name:string,value:string)=>void};

function q(req:ApiRequest,key:string){const v=req.query?.[key];return typeof v==='string'?v.trim():'';}
function validDate(v:string){return /^\d{4}-\d{2}-\d{2}$/.test(v);}
function operationalWeek(){
  const now=new Date();const day=now.getUTCDay();const daysSinceWed=(day-3+7)%7;
  const start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-daysSinceWed));
  const end=new Date(start);end.setUTCDate(start.getUTCDate()+6);
  return {start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)};
}

export default async function handler(req:ApiRequest,res:ApiResponse){
  const user=readSession(req.headers?.cookie);if(!user)return res.status(401).json({error:'Authentication required'});
  if(req.method&&req.method!=='GET'){res.setHeader?.('Allow','GET');return res.status(405).json({error:'Method not allowed'});}
  res.setHeader?.('Cache-Control','private, no-store');
  const defaults=operationalWeek();const start=q(req,'start')||defaults.start,end=q(req,'end')||defaults.end;
  if(!validDate(start)||!validDate(end)||new Date(start)>new Date(end))return res.status(400).json({error:'Valid start and end dates are required'});
  const span=(new Date(`${end}T00:00:00Z`).getTime()-new Date(`${start}T00:00:00Z`).getTime())/86400000+1;
  if(span>14)return res.status(400).json({error:'Task compliance requests are limited to 14 days'});
  try{
    const requested=q(req,'location');
    const allowed=user.role==='Founder'||user.role==='Corporate'||user.role==='Administration'||user.role==='Kitchen'?undefined:user.locations;
    if(requested&&allowed&&!allowed.includes(requested))return res.status(403).json({error:'Location outside your access scope'});
    const names=requested?[requested]:allowed;
    const data=await weeklyTaskCompliance(start,end,names);
    return res.status(200).json({source:'7shifts',operationalWeek:'Wednesday-Tuesday',...data});
  }catch(error){
    const message=error instanceof Error?error.message:'7shifts Tasks unavailable';
    const missing=/not configured|credentials/i.test(message);
    return res.status(missing?503:502).json({error:message,source:'7shifts',configured:!missing});
  }
}
