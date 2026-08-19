import { readSession } from '../server/authSession.js';
import { createPayment, decidePayment, getPayment, issuePayment, listPayments, paymentAudit } from '../server/paymentStore.js';
import { weeklyTaskCompliance } from '../server/sevenShiftsClient.js';

type ApiRequest={method?:string;headers?:{cookie?:string};query?:Record<string,string|string[]>;body?:Record<string,unknown>};
type ApiResponse={status:(code:number)=>ApiResponse;json:(body:unknown)=>void;setHeader?:(name:string,value:string)=>void};
const locations=['Stamford','Orange','Fairfield','Danbury','Avon','Southington'];
const text=(v:unknown)=>typeof v==='string'?v.trim():'';
const q=(req:ApiRequest,key:string)=>typeof req.query?.[key]==='string'?(req.query?.[key] as string).trim():'';
const isApprover=(role:string)=>role==='Founder'||role==='Corporate';
const isIssuer=(role:string)=>role==='Administration';
const canUseLocation=(u:NonNullable<ReturnType<typeof readSession>>,location:string)=>isApprover(u.role)||u.role==='Administration'||u.locations.includes(location);
const validDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v);

function operationalWeek(){const now=new Date();const day=now.getUTCDay();const since=(day-3+7)%7;const start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-since));const end=new Date(start);end.setUTCDate(start.getUTCDate()+6);return{start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)}}

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
 const span=(new Date(`${end}T00:00:00Z`).getTime()-new Date(`${start}T00:00:00Z`).getTime())/86400000+1;if(span>14)return res.status(400).json({error:'Task compliance requests are limited to 14 days'});
 const requested=q(req,'location');const allowed=user.role==='Founder'||user.role==='Corporate'||user.role==='Administration'||user.role==='Kitchen'?undefined:user.locations;
 if(requested&&allowed&&!allowed.includes(requested))return res.status(403).json({error:'Location outside your access scope'});
 const data=await weeklyTaskCompliance(start,end,requested?[requested]:allowed);return res.status(200).json({source:'7shifts',operationalWeek:'Wednesday-Tuesday',...data});
}

export default async function handler(req:ApiRequest,res:ApiResponse){
 const user=readSession(req.headers?.cookie);if(!user)return res.status(401).json({error:'Authentication required'});res.setHeader?.('Cache-Control','private, no-store');
 const resource=q(req,'resource');
 try{if(resource==='payments')return await payments(req,res,user);if(resource==='tasks')return await tasks(req,res,user);return res.status(400).json({error:'Unknown workflow resource'});}catch(error){const message=error instanceof Error?error.message:'Workflow unavailable';const source=resource==='tasks'?'7shifts':'payments';const missing=resource==='tasks'&&/not configured|credentials/i.test(message);return res.status(resource==='tasks'?(missing?503:502):503).json({error:message,source,...(resource==='tasks'?{configured:!missing}:{})});}
}
