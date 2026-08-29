import { readSession } from '../server/authSession.js';
import { createPayment, decidePayment, getPayment, issuePayment, listPayments, paymentAudit } from '../server/paymentStore.js';
import { listSevenShiftsLogbook, weeklyTaskCompliance } from '../server/sevenShiftsClient.js';
import { getWeeklyGoogleReviews } from '../server/googleBusinessReviews.js';
import { getSevenShiftsTaskCompliance } from '../server/sevenShiftsTasks.js';
import { getLocalIntelligence, localIntelligenceHorizons, localIntelligenceLocationNames, type LocalIntelligenceHorizonKey } from '../server/localIntelligence.js';
import { authorize } from '../server/authorization.js';
import { createAction, getAction, listActionAudit, listActions, updateActionRecord, type ActionSeverity, type ActionStatus, type ActionVerificationStatus } from '../server/actionStore.js';
import { createProject, getProject, listProjectAudit, listProjects, updateProjectRecord, type ProjectMilestone, type ProjectPriority, type ProjectStatus } from '../server/projectStore.js';
import { getGoogleReviewSummaries, googleBusinessProfileConfigured } from '../server/googleBusinessProfile.js';
import { getImportedReviewSummaries, importVistaSocialReviewAggregates, reviewImportConfigured, type ReviewDailyAggregate } from '../server/reviewImportStore.js';

type ApiRequest={method?:string;headers?:{cookie?:string};query?:Record<string,string|string[]>;body?:Record<string,unknown>};
type ApiResponse={status:(code:number)=>ApiResponse;json:(body:unknown)=>void;setHeader?:(name:string,value:string)=>void};
const locations=['Stamford','Orange','Fairfield','Danbury','Avon','Southington'];
const WORKFLOW_VERSION='7shifts-workflow-v5';
const text=(v:unknown)=>typeof v==='string'?v.trim():'';
const q=(req:ApiRequest,key:string)=>typeof req.query?.[key]==='string'?(req.query?.[key] as string).trim():'';
const isApprover=(role:string)=>role==='Founder'||role==='Corporate';
const isIssuer=(role:string)=>role==='Administration';
const canUseLocation=(u:NonNullable<ReturnType<typeof readSession>>,location:string)=>isApprover(u.role)||u.role==='Administration'||u.locations.includes(location);
const userOrganization=(u:NonNullable<ReturnType<typeof readSession>>)=>u.organizationId||'org-puerto-vallarta';
const validDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v);
const stringList=(value:unknown)=>Array.isArray(value)?value.filter(item=>typeof item==='string').map(item=>item.trim()).filter(Boolean):[];
const has=(value:Record<string,unknown>|undefined,key:string)=>Boolean(value&&Object.prototype.hasOwnProperty.call(value,key));
const actionSeverities:ActionSeverity[]=['High','Medium','Low'];
const actionStatuses:ActionStatus[]=['Open','Assigned','Investigating','Completed','Dismissed'];
const verificationStatuses:ActionVerificationStatus[]=['Pending','Worked','Did not work','Not enough evidence yet'];
const projectStatuses:ProjectStatus[]=['Planning','In Progress','Blocked','Completed','Cancelled'];
const projectPriorities:ProjectPriority[]=['High','Medium','Low'];

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

async function actions(req:ApiRequest,res:ApiResponse,user:NonNullable<ReturnType<typeof readSession>>){
 const access=authorize(user,'actions:read');if(!access.ok)return res.status(access.status).json({error:access.error});
 if(!req.method||req.method==='GET'){
  const id=q(req,'id');if(!id)return res.status(200).json({actions:await listActions(user)});
  const action=await getAction(id);if(!action||action.organizationId!==userOrganization(user))return res.status(404).json({error:'Action not found'});
  const scoped=authorize(user,'actions:read',action.location);if(!scoped.ok)return res.status(scoped.status).json({error:scoped.error});
  return res.status(200).json({action,audit:await listActionAudit(id)});
 }
 if(req.method==='POST'){
  const location=text(req.body?.location),category=text(req.body?.category),title=text(req.body?.title),severity=text(req.body?.severity) as ActionSeverity;
  const write=authorize(user,'actions:write',location);if(!write.ok)return res.status(write.status).json({error:write.error});
  const signal=text(req.body?.signal),cause=text(req.body?.cause),recommendation=text(req.body?.recommendation),impact=text(req.body?.impact);
  if(!locations.includes(location)||!category||!title||!actionSeverities.includes(severity)||!signal||!cause||!recommendation)return res.status(400).json({error:'Location, category, title, severity, signal, cause and recommendation are required'});
  const dueAt=text(req.body?.dueAt);if(dueAt&&!validDate(dueAt))return res.status(400).json({error:'Due date must use YYYY-MM-DD'});
  const priorityScore=Math.max(0,Math.min(100,Number(req.body?.priorityScore)||0));
  const action=await createAction({location,category,title,severity,signal,cause,recommendation,impact:impact||'Operational impact pending measurement',ownerId:text(req.body?.ownerId)||undefined,ownerName:text(req.body?.ownerName)||undefined,dueAt:dueAt||undefined,automationKey:text(req.body?.automationKey)||undefined,automated:Boolean(req.body?.automated),priorityScore,sources:stringList(req.body?.sources),sourceIds:stringList(req.body?.sourceIds),detectedAt:text(req.body?.detectedAt)||undefined},user);
  return res.status(201).json({action});
 }
 if(req.method==='PUT'){
  const id=text(req.body?.id);if(!id)return res.status(400).json({error:'Action id required'});const existing=await getAction(id);if(!existing||existing.organizationId!==userOrganization(user))return res.status(404).json({error:'Action not found'});
  const write=authorize(user,'actions:write',existing.location);if(!write.ok)return res.status(write.status).json({error:write.error});
  const status=text(req.body?.status) as ActionStatus;const verificationStatus=text(req.body?.verificationStatus) as ActionVerificationStatus;
  if(status&&!actionStatuses.includes(status))return res.status(400).json({error:'Unknown action status'});
  if(verificationStatus&&!verificationStatuses.includes(verificationStatus))return res.status(400).json({error:'Unknown verification status'});
  if(has(req.body,'dueAt')&&text(req.body?.dueAt)&&!validDate(text(req.body?.dueAt)))return res.status(400).json({error:'Due date must use YYYY-MM-DD'});
  if(verificationStatus&&verificationStatus!=='Pending'){
   const verify=authorize(user,'actions:verify',existing.location);if(!verify.ok)return res.status(verify.status).json({error:verify.error});
   if(!text(req.body?.verificationNote))return res.status(400).json({error:'A verification note describing the evidence is required'});
  }
  const action=await updateActionRecord(id,{...(status?{status}:{}),...(has(req.body,'ownerId')?{ownerId:text(req.body?.ownerId)||undefined}:{}),...(has(req.body,'ownerName')?{ownerName:text(req.body?.ownerName)||undefined}:{}),...(has(req.body,'dueAt')?{dueAt:text(req.body?.dueAt)||undefined}:{}),...(verificationStatus?{verificationStatus}:{}),...(has(req.body,'verificationNote')?{verificationNote:text(req.body?.verificationNote)||undefined}:{}),...(has(req.body,'verifiedAt')?{verifiedAt:text(req.body?.verifiedAt)||undefined}:{})},text(req.body?.reason)||'Action updated',user);
  return res.status(200).json({action});
 }
 res.setHeader?.('Allow','GET, POST, PUT');return res.status(405).json({error:'Method not allowed'});
}

async function projects(req:ApiRequest,res:ApiResponse,user:NonNullable<ReturnType<typeof readSession>>){
 const access=authorize(user,'projects:read');if(!access.ok)return res.status(access.status).json({error:access.error});
 if(!req.method||req.method==='GET'){
  const id=q(req,'id');if(!id)return res.status(200).json({projects:await listProjects(user)});
  const project=await getProject(id);if(!project||project.organizationId!==userOrganization(user))return res.status(404).json({error:'Project not found'});
  if(!project.locations.every(location=>authorize(user,'projects:read',location).ok))return res.status(403).json({error:'Project outside your access scope'});
  return res.status(200).json({project,audit:await listProjectAudit(id)});
 }
 if(req.method==='POST'){
  const name=text(req.body?.name),description=text(req.body?.description),objective=text(req.body?.objective),ownerName=text(req.body?.ownerName);
  const selectedLocations=stringList(req.body?.locations);const status=text(req.body?.status) as ProjectStatus;const priority=text(req.body?.priority) as ProjectPriority;
  const startDate=text(req.body?.startDate),dueDate=text(req.body?.dueDate),budget=Math.max(0,Number(req.body?.budget)||0);
  if(!name||!description||!objective||!ownerName||!selectedLocations.length||!selectedLocations.every(location=>locations.includes(location))||!projectStatuses.includes(status)||!projectPriorities.includes(priority)||!validDate(startDate)||!validDate(dueDate)||startDate>dueDate)return res.status(400).json({error:'Name, objective, owner, valid locations, status, priority and dates are required'});
  for(const location of selectedLocations){const write=authorize(user,'projects:write',location);if(!write.ok)return res.status(write.status).json({error:write.error});}
  const project=await createProject({name,description,objective,locations:selectedLocations,ownerName,ownerId:text(req.body?.ownerId)||undefined,collaborators:stringList(req.body?.collaborators),status,priority,startDate,dueDate,budget,actualSpend:Math.max(0,Number(req.body?.actualSpend)||0),progress:Math.max(0,Math.min(100,Number(req.body?.progress)||0)),milestones:Array.isArray(req.body?.milestones)?req.body?.milestones as ProjectMilestone[]:[]},user);
  return res.status(201).json({project});
 }
 if(req.method==='PUT'){
  const id=text(req.body?.id);if(!id)return res.status(400).json({error:'Project id required'});const existing=await getProject(id);if(!existing||existing.organizationId!==userOrganization(user))return res.status(404).json({error:'Project not found'});
  for(const location of existing.locations){const write=authorize(user,'projects:write',location);if(!write.ok)return res.status(write.status).json({error:write.error});}
  const status=text(req.body?.status) as ProjectStatus;const priority=text(req.body?.priority) as ProjectPriority;
  if(status&&!projectStatuses.includes(status))return res.status(400).json({error:'Unknown project status'});if(priority&&!projectPriorities.includes(priority))return res.status(400).json({error:'Unknown project priority'});
  const project=await updateProjectRecord(id,{...(status?{status}:{}),...(priority?{priority}:{}),...(has(req.body,'ownerName')?{ownerName:text(req.body?.ownerName)||undefined}:{}),...(has(req.body,'progress')?{progress:Math.max(0,Math.min(100,Number(req.body?.progress)||0))}:{}),...(has(req.body,'actualSpend')?{actualSpend:Math.max(0,Number(req.body?.actualSpend)||0)}:{}),...(Array.isArray(req.body?.milestones)?{milestones:req.body.milestones as ProjectMilestone[]}:{})},text(req.body?.reason)||'Project updated',user);
  return res.status(200).json({project});
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

async function reviews(req:ApiRequest,res:ApiResponse,user:NonNullable<ReturnType<typeof readSession>>){
 if(req.method&&req.method!=='GET'){res.setHeader?.('Allow','GET');return res.status(405).json({error:'Method not allowed'});}
 const defaults=operationalWeek(),start=q(req,'start')||defaults.start,end=q(req,'end')||defaults.end;
 if(!validDate(start)||!validDate(end)||new Date(start)>new Date(end))return res.status(400).json({error:'Valid start and end dates are required'});
 const span=(new Date(`${end}T00:00:00Z`).getTime()-new Date(`${start}T00:00:00Z`).getTime())/86400000+1;
 if(span>31)return res.status(400).json({error:'Google Reviews requests are limited to 31 days'});
 const requested=q(req,'location');const unrestricted=['Founder','Corporate','HR','Administration','Maintenance'].includes(user.role);
 if(requested&&!unrestricted&&!user.locations.includes(requested))return res.status(403).json({error:'Location outside your access scope'});
 const scope=requested?[requested]:unrestricted?undefined:user.locations;
 return res.status(200).json(await getWeeklyGoogleReviews(start,end,scope));
}

async function googleReviews(req:ApiRequest,res:ApiResponse,user:NonNullable<ReturnType<typeof readSession>>){
 if(req.method==='POST'){
  if(!['Founder','Corporate'].includes(user.role))return res.status(403).json({error:'Only Founder or Corporate can import review reports'});
  if(!reviewImportConfigured())return res.status(503).json({error:'OpsVista database is required for review imports'});
  const aggregates=req.body?.aggregates;if(!Array.isArray(aggregates))return res.status(400).json({error:'Review aggregates are required'});
  return res.status(200).json({import:await importVistaSocialReviewAggregates(aggregates as ReviewDailyAggregate[],user)});
 }
 if(req.method&&req.method!=='GET'){res.setHeader?.('Allow','GET, POST');return res.status(405).json({error:'Method not allowed'});}
 const defaults=operationalWeek(),start=q(req,'start')||defaults.start,end=q(req,'end')||defaults.end;
 if(!validDate(start)||!validDate(end)||new Date(start)>new Date(end))return res.status(400).json({error:'Valid start and end dates are required'});
 const span=(new Date(`${end}T00:00:00Z`).getTime()-new Date(`${start}T00:00:00Z`).getTime())/86400000+1;
 if(span>31)return res.status(400).json({error:'Google review requests are limited to 31 days'});
 const requested=q(req,'location');
 const unrestricted=['Founder','Corporate','Administration'].includes(user.role);
 if(requested&&!unrestricted&&!user.locations.includes(requested))return res.status(403).json({error:'Location outside your access scope'});
 const scope=requested?[requested]:unrestricted?undefined:user.locations;
 const organizationId=userOrganization(user);
 if(await googleBusinessProfileConfigured(organizationId))return res.status(200).json(await getGoogleReviewSummaries(start,end,scope,organizationId));
 if(reviewImportConfigured()){const imported=await getImportedReviewSummaries(start,end,scope);if(imported.hasData)return res.status(200).json(imported);}
 return res.status(503).json({error:'Google Business Profile is not connected. A Founder can connect all managed locations from Configuración.',configured:false,setupModule:'Configuración'});
}

async function localIntelligence(req:ApiRequest,res:ApiResponse,user:NonNullable<ReturnType<typeof readSession>>){
 if(req.method&&req.method!=='GET'){res.setHeader?.('Allow','GET');return res.status(405).json({error:'Method not allowed'});}
 const requested=q(req,'location');
 const horizonKey=(q(req,'horizon')||'next_14') as LocalIntelligenceHorizonKey;
 if(!(horizonKey in localIntelligenceHorizons))return res.status(400).json({error:'Unknown Local Intelligence period'});
 const unrestricted=['Founder','Corporate','HR','Administration','Maintenance'].includes(user.role);
 const selected=requested&&requested!=='All locations'?[requested]:unrestricted?undefined:user.locations;
 if(selected?.some(location=>!localIntelligenceLocationNames.includes(location)))return res.status(400).json({error:'Unknown location'});
 if(!unrestricted&&selected?.some(location=>!user.locations.includes(location)))return res.status(403).json({error:'Location outside your access scope'});
 const payload=await getLocalIntelligence(selected,localIntelligenceHorizons[horizonKey]);
 res.setHeader?.('Cache-Control','private, max-age=60, stale-while-revalidate=120');
 return res.status(200).json(payload);
}

export default async function handler(req:ApiRequest,res:ApiResponse){
 res.setHeader?.('X-OpsVista-Workflow-Version',WORKFLOW_VERSION);
 const user=readSession(req.headers?.cookie);if(!user)return res.status(401).json({error:'Authentication required'});res.setHeader?.('Cache-Control','private, no-store');
 const resource=q(req,'resource');
 try{if(resource==='payments')return await payments(req,res,user);if(resource==='actions')return await actions(req,res,user);if(resource==='projects')return await projects(req,res,user);if(resource==='tasks')return await tasks(req,res,user);if(resource==='reviews')return await reviews(req,res,user);if(resource==='google_reviews')return await googleReviews(req,res,user);if(resource==='local_intelligence')return await localIntelligence(req,res,user);return res.status(400).json({error:'Unknown workflow resource'});}catch(error){const message=error instanceof Error?error.message:'Workflow unavailable';const reviewResource=resource==='reviews'||resource==='google_reviews';const source=resource==='tasks'?'7shifts':reviewResource?'google-business-profile':resource==='local_intelligence'?'local-intelligence':resource||'workflows';const missing=(resource==='tasks'||reviewResource)&&/not configured|credentials|not available|authorization/i.test(message);return res.status(resource==='tasks'||reviewResource?(missing?503:502):resource==='local_intelligence'?502:503).json({error:message,source,...(resource==='tasks'||reviewResource?{configured:!missing}:{})});}
}
