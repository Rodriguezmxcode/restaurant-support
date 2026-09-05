import { clearSessionCookie, readSession } from '../server/authSession.js';
import { createPayment, decidePayment, getPayment, issuePayment, listPayments, paymentAudit } from '../server/paymentStore.js';
import { listSevenShiftsLogbook, listSevenShiftsManagersOnDuty, weeklyTaskCompliance } from '../server/sevenShiftsClient.js';
import { getWeeklyGoogleReviews } from '../server/googleBusinessReviews.js';
import { getSevenShiftsTaskCompliance } from '../server/sevenShiftsTasks.js';
import { authorize } from '../server/authorization.js';
import { createAction, getAction, listActionAudit, listActions, updateActionRecord, type ActionSeverity, type ActionStatus, type ActionVerificationStatus } from '../server/actionStore.js';
import { dispatchActionPush, dispatchOperationalPush, escalateUnacceptedActions, getActionNotification, getNotificationPreferences, recordActionReceipt, registerMobileDevice, updateNotificationPreferences, type ActionReceiptStatus } from '../server/actionNotificationStore.js';
import { notifyActionObservers } from '../server/operationalNotificationRouting.js';
import { scanOperationalAlerts } from '../server/operationalAlertScan.js';
import { createProject, getProject, listProjectAudit, listProjects, updateProjectRecord, type ProjectMilestone, type ProjectPriority, type ProjectStatus } from '../server/projectStore.js';
import { getGoogleReviewSummaries, googleBusinessProfileConfigured } from '../server/googleBusinessProfile.js';
import { getImportedReviewSummaries, importVistaSocialReviewAggregates, reviewImportConfigured, type ReviewDailyAggregate } from '../server/reviewImportStore.js';
import { authorizationUrl, createOAuthState, exchangeAuthorizationCode, googleBusinessRedirectUri, publicOrigin, verifyOAuthState } from '../server/googleBusinessOAuth.js';
import { disconnectGoogleBusiness, getGoogleBusinessCredentials, saveGoogleBusinessAuthorization, saveGoogleBusinessClient } from '../server/integrationStore.js';
import { getManagedUser, listManagedUsers, listManagementAudit, type ManagedDirectoryUser } from '../server/managementStore.js';
import { canCreateProjectsForIdentity } from '../shared/projectAccess.js';

export const config={maxDuration:120};

type ApiRequest={method?:string;headers?:Record<string,string|string[]|undefined>&{cookie?:string};query?:Record<string,string|string[]>;body?:Record<string,unknown>};
type ApiResponse={status:(code:number)=>ApiResponse;json:(body:unknown)=>void;setHeader?:(name:string,value:string)=>void;end?:()=>void};
const locations=['Stamford','Orange','Fairfield','Danbury','Avon','Southington'];
const WORKFLOW_VERSION='mobile-operational-push-v2';
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
const globalAssigneeRoles=['Founder','Corporate','HR','Administration','Maintenance'];
const actionReceiptStatuses:ActionReceiptStatus[]=['Delivered','Seen','Accepted','In progress','Evidence submitted','Verified'];

function managedLocations(user:ManagedDirectoryUser){const now=Date.now();const grants=user.locationGrants?.length?user.locationGrants:user.locations.map((location,index)=>({location,type:index===0?'Primary' as const:'Additional' as const}));return Array.from(new Set(grants.filter(grant=>!grant.expiresAt||new Date(grant.expiresAt).getTime()>now).map(grant=>grant.location)));}
function canOwnLocation(user:ManagedDirectoryUser,location:string){return globalAssigneeRoles.includes(user.role)||managedLocations(user).includes(location);}
async function actionAssignees(user:NonNullable<ReturnType<typeof readSession>>){const directory=await listManagedUsers();const globalRequester=globalAssigneeRoles.includes(user.role);return directory.filter(candidate=>candidate.active&&(globalRequester||candidate.id===user.id||managedLocations(candidate).some(location=>user.locations.includes(location)))).map(candidate=>({id:candidate.id,name:candidate.name,title:candidate.title,role:candidate.role,locations:managedLocations(candidate)}));}
async function resolveActionAssignee(id:string,location:string){if(!id)return null;const assignee=await getManagedUser(id);return assignee&&assignee.active&&canOwnLocation(assignee,location)?assignee:null;}
function safeActionSourceUrl(value:string){if(!value)return undefined;try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='app.ramp.com'?url.toString():undefined;}catch{return undefined;}}

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
  const id=q(req,'id');if(!id)return res.status(200).json({actions:await listActions(user),assignees:await actionAssignees(user)});
  const action=await getAction(id);if(!action||action.organizationId!==userOrganization(user))return res.status(404).json({error:'Action not found'});
  const scoped=authorize(user,'actions:read',action.location);if(!scoped.ok)return res.status(scoped.status).json({error:scoped.error});
  return res.status(200).json({action,audit:await listActionAudit(id),notification:await getActionNotification(id,user)});
 }
 if(req.method==='POST'){
  const location=text(req.body?.location),category=text(req.body?.category),title=text(req.body?.title),severity=text(req.body?.severity) as ActionSeverity;
  const write=authorize(user,'actions:write',location);if(!write.ok)return res.status(write.status).json({error:write.error});
  const signal=text(req.body?.signal),cause=text(req.body?.cause),recommendation=text(req.body?.recommendation),impact=text(req.body?.impact);
  if(!locations.includes(location)||!category||!title||!actionSeverities.includes(severity)||!signal||!cause||!recommendation)return res.status(400).json({error:'Location, category, title, severity, signal, cause and recommendation are required'});
  const dueAt=text(req.body?.dueAt);if(dueAt&&!validDate(dueAt))return res.status(400).json({error:'Due date must use YYYY-MM-DD'});
  const priorityScore=Math.max(0,Math.min(100,Number(req.body?.priorityScore)||0));const requestedOwnerId=text(req.body?.ownerId);const assignee=requestedOwnerId?await resolveActionAssignee(requestedOwnerId,location):null;
  if(requestedOwnerId&&!assignee)return res.status(400).json({error:'The selected responsible user is inactive or outside this location'});
  const sourceUrl=safeActionSourceUrl(text(req.body?.sourceUrl));
  const action=await createAction({location,category,title,severity,signal,cause,recommendation,impact:impact||'Operational impact pending measurement',ownerId:assignee?.id,ownerName:assignee?.name,accountableName:text(req.body?.accountableName)||undefined,accountableRole:text(req.body?.accountableRole)||undefined,dueAt:dueAt||undefined,automationKey:text(req.body?.automationKey)||undefined,automated:Boolean(req.body?.automated),priorityScore,sources:stringList(req.body?.sources),sourceIds:stringList(req.body?.sourceIds),sourceUrl,detectedAt:text(req.body?.detectedAt)||undefined},user);
  const notification=action&&assignee?await dispatchActionPush(action,user,Math.max(5,Number(req.body?.acceptWithinMinutes)||30)):undefined;
  if(action&&assignee)await notifyActionObservers(action,user,'assigned');
  return res.status(201).json({action,notification});
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
  const requestedOwnerId=has(req.body,'ownerId')?text(req.body?.ownerId):existing.ownerId||'';const assignee=requestedOwnerId?await resolveActionAssignee(requestedOwnerId,existing.location):null;
  if(requestedOwnerId&&!assignee)return res.status(400).json({error:'The selected responsible user is inactive or outside this location'});
  const action=await updateActionRecord(id,{...(status?{status}:{}),...(has(req.body,'ownerId')?{ownerId:assignee?.id,ownerName:assignee?.name}:{}),...(has(req.body,'dueAt')?{dueAt:text(req.body?.dueAt)||undefined}:{}),...(has(req.body,'sourceUrl')?{sourceUrl:safeActionSourceUrl(text(req.body?.sourceUrl))}:{}),...(verificationStatus?{verificationStatus}:{}),...(has(req.body,'verificationNote')?{verificationNote:text(req.body?.verificationNote)||undefined}:{}),...(has(req.body,'verifiedAt')?{verifiedAt:text(req.body?.verifiedAt)||undefined}:{})},text(req.body?.reason)||'Action updated',user);
  const ownerChanged=has(req.body,'ownerId')&&Boolean(action?.ownerId)&&(action?.ownerId!==existing.ownerId||Boolean(req.body?.resendNotification));
  const notification=action&&ownerChanged?await dispatchActionPush(action,user,Math.max(5,Number(req.body?.acceptWithinMinutes)||30)):undefined;
  if(action&&ownerChanged)await notifyActionObservers(action,user,'assigned');
  return res.status(200).json({action,notification});
 }
 res.setHeader?.('Allow','GET, POST, PUT');return res.status(405).json({error:'Method not allowed'});
}

async function mobileDevices(req:ApiRequest,res:ApiResponse,user:NonNullable<ReturnType<typeof readSession>>){
 if(req.method!=='POST'){res.setHeader?.('Allow','POST');return res.status(405).json({error:'Method not allowed'});}
 const token=text(req.body?.token),platform=text(req.body?.platform);
 if(!/^ExponentPushToken\[[^\]]+\]$/.test(token)&&!/^ExpoPushToken\[[^\]]+\]$/.test(token))return res.status(400).json({error:'Valid Expo push token required'});
 if(platform!=='ios'&&platform!=='android')return res.status(400).json({error:'Platform must be ios or android'});
 return res.status(200).json(await registerMobileDevice({token,platform,deviceName:text(req.body?.deviceName)||undefined,appVersion:text(req.body?.appVersion)||undefined},user));
}

async function notificationPreferences(req:ApiRequest,res:ApiResponse,user:NonNullable<ReturnType<typeof readSession>>){
 if(!req.method||req.method==='GET')return res.status(200).json(await getNotificationPreferences(user));
 if(req.method==='PUT'){
  const current=await getNotificationPreferences(user);
  return res.status(200).json(await updateNotificationPreferences({
   emailEnabled:has(req.body,'emailEnabled')?Boolean(req.body?.emailEnabled):current.emailEnabled,
   pushEnabled:has(req.body,'pushEnabled')?Boolean(req.body?.pushEnabled):current.pushEnabled,
   smsEnabled:has(req.body,'smsEnabled')?Boolean(req.body?.smsEnabled):current.smsEnabled,
   phone:has(req.body,'phone')?text(req.body?.phone)||undefined:current.phone,
  },user));
 }
 res.setHeader?.('Allow','GET, PUT');return res.status(405).json({error:'Method not allowed'});
}

async function notificationTest(req:ApiRequest,res:ApiResponse,user:NonNullable<ReturnType<typeof readSession>>){
 if(req.method!=='POST'){res.setHeader?.('Allow','POST');return res.status(405).json({error:'Method not allowed'});}
 return res.status(200).json(await dispatchOperationalPush({
  eventKey:`test:${user.id}:${Date.now()}`,category:'action',title:'OpsVista · Notificación de prueba',
  body:'El canal funciona correctamente. Las alertas de ventas, labor y responsabilidades llegarán con este formato.',
  recipientIds:[user.id],
 },user));
}

async function actionNotifications(req:ApiRequest,res:ApiResponse,user:NonNullable<ReturnType<typeof readSession>>){
 const actionId=req.method==='GET'?q(req,'actionId'):text(req.body?.actionId);
 if(!actionId)return res.status(400).json({error:'Action id required'});
 const action=await getAction(actionId);if(!action||action.organizationId!==userOrganization(user))return res.status(404).json({error:'Action not found'});
 const scoped=authorize(user,'actions:read',action.location);if(!scoped.ok)return res.status(scoped.status).json({error:scoped.error});
 if(!req.method||req.method==='GET')return res.status(200).json(await getActionNotification(actionId,user));
 if(req.method==='POST'){
  const status=text(req.body?.status) as ActionReceiptStatus;if(!actionReceiptStatuses.includes(status))return res.status(400).json({error:'Unknown receipt status'});
  const receipt=await recordActionReceipt(action,status,user,text(req.body?.note)||undefined);
  if(status==='Accepted'){const updated=await updateActionRecord(action.id,{status:'Assigned'},'Responsible user accepted the assignment',user);if(updated)await notifyActionObservers(updated,user,'accepted');}
  if(status==='In progress'){const updated=await updateActionRecord(action.id,{status:'Investigating'},'Responsible user started the assigned action',user);if(updated)await notifyActionObservers(updated,user,'in_progress');}
  if(status==='Evidence submitted')await notifyActionObservers(action,user,'evidence');
  if(status==='Verified'){const updated=await updateActionRecord(action.id,{status:'Completed'},'Assigned action verified and closed',user);if(updated)await notifyActionObservers(updated,user,'verified');}
  return res.status(200).json(receipt);
 }
 res.setHeader?.('Allow','GET, POST');return res.status(405).json({error:'Method not allowed'});
}

async function actionSuggestions(req:ApiRequest,res:ApiResponse,user:NonNullable<ReturnType<typeof readSession>>){
 if(req.method&&req.method!=='GET'){res.setHeader?.('Allow','GET');return res.status(405).json({error:'Method not allowed'});}
 const location=q(req,'location'),category=q(req,'category');
 const access=authorize(user,'actions:read',location);if(!access.ok)return res.status(access.status).json({error:access.error});
 if(!locations.includes(location))return res.status(400).json({error:'Valid location required'});
 const directory=(await listManagedUsers()).filter(candidate=>candidate.active&&canOwnLocation(candidate,location));
 const key=category.toLowerCase();
 if(/maintenance|mantenimiento|facilities|repair/.test(key)){
  const miguel=directory.find(candidate=>candidate.id==='usr-miguel');
  return res.status(200).json({strategy:'maintenance',onDutyVerified:false,suggestions:miguel?[{id:miguel.id,name:miguel.name,title:miguel.title,reason:'Head of Maintenance · all locations'}]:[]});
 }
 if(/sales|venta|upsell|revenue/.test(key)){
  const commercial=directory.filter(candidate=>['usr-roberto-ops','usr-jacob'].includes(candidate.id));
  return res.status(200).json({strategy:'commercial',onDutyVerified:false,suggestions:commercial.map(candidate=>({id:candidate.id,name:candidate.name,title:candidate.title,reason:'Authorized to send sales coaching'}))});
 }
 const managers=directory.filter(candidate=>candidate.role==='Location Manager'&&managedLocations(candidate).includes(location));
 let onDuty:Awaited<ReturnType<typeof listSevenShiftsManagersOnDuty>>=[];
 try{onDuty=await listSevenShiftsManagersOnDuty(location);}catch{/* Directory fallback remains available when 7shifts is unavailable. */}
 const matched=managers.filter(manager=>onDuty.some(shift=>{const a=normalizedLocation(manager.name),b=normalizedLocation(shift.name);return a===b||a.includes(b)||b.includes(a);}));
 const selected=matched.length?matched:managers;
 return res.status(200).json({strategy:'manager_on_duty',onDutyVerified:matched.length>0,suggestions:selected.map(candidate=>({id:candidate.id,name:candidate.name,title:candidate.title,reason:matched.length?'Currently scheduled in 7shifts':'Location manager fallback'}))});
}

async function actionEscalations(req:ApiRequest,res:ApiResponse,user:NonNullable<ReturnType<typeof readSession>>){
 if(req.method!=='POST'){res.setHeader?.('Allow','POST');return res.status(405).json({error:'Method not allowed'});}
 if(!['Founder','Corporate'].includes(user.role))return res.status(403).json({error:'Corporate access required'});
 return res.status(200).json(await escalateUnacceptedActions(user));
}

async function operationalAlertScan(req:ApiRequest,res:ApiResponse,user:NonNullable<ReturnType<typeof readSession>>){
 if(req.method!=='POST'){res.setHeader?.('Allow','POST');return res.status(405).json({error:'Method not allowed'});}
 const access=authorize(user,'actions:write');if(!access.ok)return res.status(access.status).json({error:access.error});
 return res.status(200).json(await scanOperationalAlerts(user));
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
  if(!canCreateProjectsForIdentity(user))return res.status(403).json({error:'Only Roberto Rodríguez or Jacob Rodríguez can create projects'});
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
 return res.status(200).json({source:'7shifts',operationalWeek:'Wednesday-Tuesday',...tasksResult.value,logbook,logbookComplete:logbookResult.status==='fulfilled',...(logbookError?{logbookError}:{})});
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
 let liveError:unknown;
 if(await googleBusinessProfileConfigured(organizationId)){
  try{return res.status(200).json({...await getGoogleReviewSummaries(start,end,scope,organizationId),sourceStatus:'live'});}
  catch(error){liveError=error;}
 }
 if(reviewImportConfigured()){
  const imported=await getImportedReviewSummaries(start,end,scope);
  if(imported.hasData){
   const liveMessage=liveError instanceof Error?liveError.message:'Google Business Profile is temporarily unavailable';
   return res.status(200).json({...imported,sourceStatus:'fallback',liveSource:'Google Business Profile',sourceWarning:'Google Business Profile no pudo actualizarse. OpsVista está usando el reporte verificado de Vista Social para mantener activo el módulo y el Bono semanal.',liveSourceError:liveMessage});
  }
 }
 if(liveError){
  const message=liveError instanceof Error?liveError.message:'Google Business Profile is temporarily unavailable';
  const accessPending=/\b429\b|quota|resource_exhausted/i.test(message);
  return res.status(503).json({
   error:accessPending?'Google está conectado correctamente, pero el proyecto todavía tiene cuota 0. La aprobación de acceso básico de Google Business Profile sigue pendiente; no cambies el Client ID ni el Client Secret.':message,
   errorCode:accessPending?'GOOGLE_API_ACCESS_PENDING':'GOOGLE_API_UNAVAILABLE',
   source:'google-business-profile',configured:true,connected:true,
  });
 }
 return res.status(503).json({error:'Google Business Profile is not connected. A Founder can connect all managed locations from Configuración.',configured:false,setupModule:'Configuración'});
}

async function googleBusinessIntegration(req:ApiRequest,res:ApiResponse,user:NonNullable<ReturnType<typeof readSession>>){
 const permission=authorize(user,'integrations:manage');if(!permission.ok)return res.status(permission.status).json({error:permission.error});
 const organizationId=userOrganization(user);
 if(!req.method||req.method==='GET'){
  const saved=await getGoogleBusinessCredentials(organizationId);const redirectUri=googleBusinessRedirectUri(req.headers||{});
  if(q(req,'action')==='authorize'){
   if(!saved?.clientId||!saved.clientSecret)return res.status(400).json({error:'Save the Google OAuth client before connecting'});
   if(!res.setHeader||!res.end)return res.status(500).json({error:'Google redirect is unavailable'});
   res.setHeader('Location',authorizationUrl(saved,redirectUri,createOAuthState(organizationId,user.id)));res.status(302).end();return;
  }
  return res.status(200).json({provider:'google-business-profile',configured:Boolean(saved?.clientId&&saved.clientSecret),connected:Boolean(saved?.refreshToken),clientId:saved?.clientId||'',connectedEmail:saved?.connectedEmail,connectedAt:saved?.connectedAt,redirectUri});
 }
 if(req.method==='POST'){
  const action=text(req.body?.action);
  if(action==='save'){
   const clientId=text(req.body?.clientId),clientSecret=text(req.body?.clientSecret);
   if(!clientId.endsWith('.apps.googleusercontent.com')||!clientSecret.startsWith('GOCSPX-'))return res.status(400).json({error:'A valid Google OAuth Client ID and Client Secret are required'});
   await saveGoogleBusinessClient(organizationId,clientId,clientSecret);return res.status(200).json({saved:true});
  }
  if(action==='disconnect'){await disconnectGoogleBusiness(organizationId);return res.status(200).json({disconnected:true});}
  return res.status(400).json({error:'Unknown integration action'});
 }
 res.setHeader?.('Allow','GET, POST');return res.status(405).json({error:'Method not allowed'});
}

async function googleBusinessCallback(req:ApiRequest,res:ApiResponse,user:NonNullable<ReturnType<typeof readSession>>){
 const origin=publicOrigin(req.headers||{});const redirect=(status:'connected'|'error',message?:string)=>{if(!res.setHeader||!res.end)throw new Error('Google callback redirect is unavailable');const suffix=message?`&message=${encodeURIComponent(message)}`:'';res.setHeader('Location',`${origin}/?integration=google-business&status=${status}${suffix}`);res.status(302).end();};
 try{
  if(user.role!=='Founder')throw new Error('Founder session is required to connect Google Business');
  const providerError=q(req,'error');if(providerError)throw new Error(q(req,'error_description')||providerError);
  const state=verifyOAuthState(q(req,'state'));if(state.userId!==user.id)throw new Error('Google authorization belongs to a different OpsVista session');
  const credential=await getGoogleBusinessCredentials(state.organizationId);if(!credential)throw new Error('Google OAuth client is not saved in OpsVista');
  const result=await exchangeAuthorizationCode(credential,q(req,'code'),googleBusinessRedirectUri(req.headers||{}));
  await saveGoogleBusinessAuthorization(state.organizationId,result.refreshToken,result.email);redirect('connected');return;
 }catch(error){redirect('error',error instanceof Error?error.message:'Google authorization failed');return;}
}

async function authLogout(req:ApiRequest,res:ApiResponse){
 if(req.method!=='POST'){res.setHeader?.('Allow','POST');return res.status(405).json({error:'Method not allowed'});}
 res.setHeader?.('Set-Cookie',clearSessionCookie());res.setHeader?.('Cache-Control','no-store');return res.status(200).json({ok:true});
}

async function managementAudit(req:ApiRequest,res:ApiResponse,user:NonNullable<ReturnType<typeof readSession>>){
 const permission=authorize(user,'users:manage');if(!permission.ok)return res.status(permission.status).json({error:permission.error});
 if(req.method&&req.method!=='GET'){res.setHeader?.('Allow','GET');return res.status(405).json({error:'Method not allowed'});}
 const requestedLimit=Number(q(req,'limit')||'500');const limit=Number.isFinite(requestedLimit)?requestedLimit:500;
 res.setHeader?.('Cache-Control','private, no-store');return res.status(200).json({events:await listManagementAudit(limit)});
}

export default async function handler(req:ApiRequest,res:ApiResponse){
 res.setHeader?.('X-OpsVista-Workflow-Version',WORKFLOW_VERSION);
 const resource=q(req,'resource');
 try{if(resource==='auth_logout')return await authLogout(req,res);const user=readSession(req.headers?.cookie);if(!user)return res.status(401).json({error:'Authentication required'});res.setHeader?.('Cache-Control','private, no-store');if(resource==='payments')return await payments(req,res,user);if(resource==='actions')return await actions(req,res,user);if(resource==='action_notifications')return await actionNotifications(req,res,user);if(resource==='action_suggestions')return await actionSuggestions(req,res,user);if(resource==='action_escalations')return await actionEscalations(req,res,user);if(resource==='operational_alert_scan')return await operationalAlertScan(req,res,user);if(resource==='mobile_devices')return await mobileDevices(req,res,user);if(resource==='notification_preferences')return await notificationPreferences(req,res,user);if(resource==='notification_test')return await notificationTest(req,res,user);if(resource==='projects')return await projects(req,res,user);if(resource==='tasks')return await tasks(req,res,user);if(resource==='reviews')return await reviews(req,res,user);if(resource==='google_reviews')return await googleReviews(req,res,user);if(resource==='google_business_integration')return await googleBusinessIntegration(req,res,user);if(resource==='google_business_callback')return await googleBusinessCallback(req,res,user);if(resource==='management_audit')return await managementAudit(req,res,user);return res.status(400).json({error:'Unknown workflow resource'});}catch(error){const message=error instanceof Error?error.message:'Workflow unavailable';const reviewResource=resource==='reviews'||resource==='google_reviews';const source=resource==='tasks'?'7shifts':reviewResource?'google-business-profile':resource||'workflows';const missing=(resource==='tasks'||reviewResource)&&/not configured|credentials|not available|authorization/i.test(message);return res.status(resource==='tasks'||reviewResource?(missing?503:502):503).json({error:message,source,...(resource==='tasks'||reviewResource?{configured:!missing}:{})});}
}
