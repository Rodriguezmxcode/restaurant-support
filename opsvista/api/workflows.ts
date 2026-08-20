import { readSession } from '../server/authSession.js';
import { createPayment, decidePayment, getPayment, issuePayment, listPayments, paymentAudit } from '../server/paymentStore.js';
import { listSevenShiftsLogbook, weeklyTaskCompliance } from '../server/sevenShiftsClient.js';
import { getSevenShiftsTaskCompliance } from '../server/sevenShiftsTasks.js';

type ApiRequest={method?:string;headers?:{cookie?:string};query?:Record<string,string|string[]>;body?:Record<string,unknown>};
type ApiResponse={status:(code:number)=>ApiResponse;json:(body:unknown)=>void;setHeader?:(name:string,value:string)=>void};
const locations=['Stamford','Orange','Fairfield','Danbury','Avon','Southington'];
const WORKFLOW_VERSION='7shifts-workflow-v4';
const text=(v:unknown)=>typeof v==='string'?v.trim():'';
const q=(req:ApiRequest,key:string)=>typeof req.query?.[key]==='string'?(req.query?.[key] as string).trim():'';
const isApprover=(role:string)=>role==='Founder'||role==='Corporate';
const isIssuer=(role:string)=>role==='Administration';
const canUseLocation=(u:NonNullable<ReturnType<typeof readSession>>,location:string)=>isApprover(u.role)||u.role==='Administration'||u.locations.includes(location);
const validDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v);

function operationalWeek(){const now=new Date();const day=now.getUTCDay();const since=(day-3+7)%7;const start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-since));const end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));return{start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)}}

const diagnostic=(error:unknown)=>error instanceof Error?error.message:String(error||'Unknown 7shifts error');
const normalizedLocation=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/puerto\s+vallarta|mexican\s+restaurant|restaurant/g,'').replace(/[^a-z0-9]/g,'');
const sameLocation=(left:string,right:string)=>{const a=normalizedLocation(left),b=normalizedLocation(right);return Boolean(a&&b&&(a===b||a.includes(b)||b.includes(a)))};

async function taskComplianceWithFallback(start:string,end:string,scope?:string[]){
 let primary:Awaited<ReturnType<typeof weeklyTaskCompliance>>|undefined;
 let primaryError='';
 try{primary=await weeklyTaskCompliance(start,end,scope);if(primary.locations.length>0)return{...primary,adapterVersion:WORKFLOW_VERSION,taskSource:'daily-summary',availableLocationCount:primary.locations.length};}catch(error){primaryError=diagnostic(error);}
 let fallbackError='';
 try{
  const fallback=await getSevenShiftsTaskCompliance(start,end);
  const requested=scope?.length?fallback.locations.filter(row=>scope.some(name=>sameLocation(name,row.location))):fallback.locations;
  if(scope?.length&&fallback.locations.length>0&&!requested.length)throw new Error(`7shifts location mapping failed. Requested: ${scope.join(', ')}. Available in 7shifts: ${fallback.locations.map(row=>row.location).join(', ')}`);
  if(requested.length>0){const total=requested.reduce((sum,row)=>sum+row.total,0),completed=requested.reduce((sum,row)=>sum+row.completed,0);return{companyId:Number(process.env.SEVENSHIFTS_COMPANY_ID)||primary?.companyId||0,start,end,total,completed,incomplete:Math.max(0,total-completed),completionPct:total>0?completed/total*100:null,detailAvailable:false,accountability:[],people:[],locations:requested.map((row,index)=>({locationId:index+1,locationName:row.location,total:row.total,completed:row.completed,incomplete:Math.max(0,row.total-row.completed),completionPct:row.total>0?row.completed/row.total*100:null,accountability:[],detailAvailable:false,days:[]})),adapterVersion:WORKFLOW_VERSION,taskSource:'active-task-lists',availableLocationCount:requested.length};}
  fallbackError='7shifts returned zero locations';
 }catch(error){fallbackError=diagnostic(error);}
 throw new Error(`7shifts Tasks unavailable for ${start} through ${end}. Daily summary: ${primaryError||'no location rows'}. Task Lists fallback: ${fallbackError||'no location rows'}.`);
}

async function payments(req:ApiRequest,res:ApiResponse,user:NonNullable<ReturnType<typeof readSession>>){
 if(!req.method||req.method==='GET'){
  const id=q(req,'id');
  if(id){const payment=await getPayment(id);if(!payment)return res.status(404).json({error:'Payment request not found'});if(!canUseLocation(user,payment.location)&&payment.requestedById!==user.id)return res.status(403).json({error:'Payment request outside your scope'});return res.status(200).json({payment,audit:await paymentAudit(id)});}
  return res.status(200).json({payments:await listPayments(user)});
 }
 if(req.method==='POST'){
  const location=text(req.body?.location),requestDate=text(req.body?.requestDate),title=text(req.body?.title),payee=text(req.body?.payee),reason=text(req.body?.reason),amount=Number(req.body?.amount);
  if(!locations.includes(location)||!canUseLocation(user,location))return res.status(403).json({error:'You cannot request payment for this location'});
  if(!requestDate||!title||!payee||!reason||!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:'Date, title, payee, amount and reason are required'});
  return res.status(201).json({payment:await createPayment({location,requestDate,title,payee,amount,reason},user)});
 }
 if(req.method==='PUT'){
  const id=text(req.body?.id),action=text(req.body?.action);if(!id)return res.status(400).json({error:'Payment id required'});
  if(action==='approve'||action==='reject'){if(!isApprover(user.role))return res.status(403).json({error:'Only Corporate or Founder can approve or reject payments'});return res.status(200).json({payment:await decidePayment(id,action==='approve'?'Approved':'Rejected',text(req.body?.note),user)});}
  if(action==='issue'){if(!isIssuer(user.role))return res.status(403).json({error:'Only Administration can issue approved payments'});const checkNumber=text(req.body?.checkNumber),checkDate=text(req.body?.checkDate),note=text(req.body?.note);if(!checkNumber||!checkDate)return res.status(400).json({error:'Check number and check date are required'});return res.status(200).json({payment:await issuePayment(id,{checkNumber,checkDate,note:note||undefined},user)});}
  return res.status(400).json({error:'Unsupported payment action'});
 }
 res.setHeader?.('Allow','GET, POST, PUT');return res.status(405).json({error:'Method not allowed'});
}

async function tasks(req:ApiRequest,res:ApiResponse,user:NonNullable<ReturnType<typeof readSession>>){
 if(req.method&&req.method!=='GET'){res.setHeader?.('Allow','GET');return res.status(405).json({error:'Method not allowed'});}
 const defaults=operationalWeek(),start=q(req,'start')||defaults.start,end=q(req,'end')||defaults.end;
 if(!validDate(start)||!validDate(end)||new Date(start)>new Date(end))return res.status(400).json({error:'Valid start and end dates are required'});
 const span=(new Date(`${end}T00:00:00Z`).getTime()-new Date(`${start}T00:00:00Z`).getTime())/86400000+1;if(span>31)return res.status(400).json({error:'Task compliance requests are limited to 31 days'});
 const requested=q(req,'location');const allowed=user.role==='Founder'||user.role==='Corporate'||user.role==='Administration'||user.role==='Kitchen'?undefined:user.locations;
 if(requested&&allowed&&!allowed.includes(requested))return res.status(403).json({error:'Location outside your access scope'});
 const scope=requested?[requested]:allowed;
 const [tasksResult,logbookResult]=await Promise.allSettled([taskComplianceWithFallback(start,end,scope),listSevenShiftsLogbook(start,end,scope)]);
 if(tasksResult.status==='rejected')throw tasksResult.reason;
 const logbook=logbookResult.status==='fulfilled'?logbookResult.value:[];
 const logbookError=logbookResult.status==='rejected'?(logbookResult.reason instanceof Error?logbookResult.reason.message:'7shifts Logbook unavailable'):undefined;
 return res.status(200).json({source:'7shifts',operationalWeek:'Wednesday-Tuesday',...tasksResult.value,logbook,...(logbookError?{logbookError}:{})});
}

export default async function handler(req:ApiRequest,res:ApiResponse){
 res.setHeader?.('X-OpsVista-Workflow-Version',WORKFLOW_VERSION);
 const user=readSession(req.headers?.cookie);if(!user)return res.status(401).json({error:'Authentication required'});res.setHeader?.('Cache-Control','private, no-store');
 const resource=q(req,'resource');
 try{if(resource==='payments')return await payments(req,res,user);if(resource==='tasks')return await tasks(req,res,user);return res.status(400).json({error:'Unknown workflow resource'});}catch(error){const message=error instanceof Error?error.message:'Workflow unavailable';const source=resource==='tasks'?'7shifts':'payments';const missing=resource==='tasks'&&/not configured|credentials/i.test(message);return res.status(resource==='tasks'?(missing?503:502):503).json({error:message,source,...(resource==='tasks'?{configured:!missing}:{})});}
}
