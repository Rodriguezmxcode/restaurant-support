// Real workflow handlers and SQL, isolated in memory; no live systems or messages.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
const root=fileURLToPath(new URL('../',import.meta.url));
const nativeRequire=createRequire(new URL('../package.json',import.meta.url));
const database=new PGlite();
let session=null,notifications=0,observers=0,deliveryError=false,deliveryResult={sent:true,email:{accepted:1}};
const manager={id:'manager',name:'Test Manager',role:'Location Manager',locations:['Avon'],active:true,organizationId:'org-puerto-vallarta'};
const other={...manager,id:'other',locations:['Orange']};
const founder={...manager,id:'founder',role:'Founder'};
const directory=[manager,other,founder];
const originalFetch=globalThis.fetch;
globalThis.fetch=()=>{throw new Error('Network forbidden in meeting tests');};
const oldDatabaseUrl=process.env.OPSVISTA_DATABASE_URL;
process.env.OPSVISTA_DATABASE_URL='isolated-fixture';
function adapter(db){
 const sql=async(parts,...values)=>{
  const query=parts.reduce((s,p,i)=>s+(i?'$'+i:'')+p,'');
  const result=await db.query(query,values);
  return result.rows.map(row=>({...row,...(row.due_at instanceof Date?{due_at:row.due_at.toISOString().slice(0,10)}:{})}));
 };
 sql.json=value=>JSON.stringify(value);
 sql.begin=fn=>db.transaction(tx=>fn(adapter(tx)));
 return sql;
}
const real=new Set(['api/workflows.ts','server/actionStore.ts','server/authorization.ts','shared/tenantAccess.ts','shared/meetingAgreements.ts']);
const stubs={
 'server/authSession.ts':{readSession:()=>session},
 'server/managementStore.ts':{getManagedUser:async id=>directory.find(user=>user.id===id),listManagedUsers:async()=>directory},
 'server/organizationStore.ts':{getOrganizationMembership:async()=>({organizationId:'org-puerto-vallarta'})},
 'server/actionNotificationStore.ts':{dispatchActionPush:async()=>{notifications++;if(deliveryError)throw new Error('uncertain provider');return deliveryResult;},getActionNotification:async()=>({state:null,events:[]})},
 'server/operationalNotificationRouting.ts':{notifyActionObservers:async()=>{observers++;}},
};
const cache=new Map();
function load(file){
 if(cache.has(file))return cache.get(file).exports;
 const module={exports:{}};cache.set(file,module);
 const require=specifier=>{
  if(specifier==='postgres')return()=>adapter(database);
  if(!specifier.startsWith('.'))return nativeRequire(specifier);
  const target=resolve(dirname(file),specifier.replace(/\.js$/,'.ts'));
  const relative=target.slice(root.length);
  if(real.has(relative))return load(target);
  if(stubs[relative])return stubs[relative];
  return new Proxy({},{get:(_target,name)=>()=>{throw new Error(`Unexpected dependency: ${relative}.${String(name)}`);}});
 };
 const compiled=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',compiled)(require,module,module.exports);
 return module.exports;
}
const helpers=load(resolve(root,'shared/meetingAgreements.ts'));
const handler=load(resolve(root,'api/workflows.ts')).default;
const store=load(resolve(root,'server/actionStore.ts'));
async function request(method,body={},query={}){
 const res={code:200,body:null,status(code){this.code=code;return this;},json(body){this.body=body;},setHeader(){}};
 await handler({method,query:{resource:'actions',...query},body},res);
 return res;
}
const meeting={weekStart:'2026-11-04',kpi:'labor',dataQuality:'estimated',nextReview:'Comparar labor de cierre con el plan.'};
const base={location:'Avon',category:'Reunión semanal',title:'Ejemplo de prueba',severity:'Medium',signal:'Dato de prueba',cause:'Causa de prueba',recommendation:'Ajustar turnos',ownerId:'manager',dueAt:'2026-11-10',meeting};
try{
 assert.equal(helpers.meetingWeekFor('2026-11-03'),'2026-10-28');
 assert.equal(helpers.meetingWeekFor('2026-11-04'),'2026-11-04');
 assert.equal(helpers.currentMeetingWeek(new Date('2026-11-04T04:30:00Z')),'2026-10-28');
 assert.equal(helpers.currentMeetingWeek(new Date('2026-11-04T05:00:00Z')),'2026-11-04');
 assert.equal(helpers.validMeetingDate('2026-02-30'),false);
 assert.match(helpers.meetingWeekLabel('2026-12-30'),/2026.*2027/);
 assert.throws(()=>helpers.parseMeetingAgreement({...meeting,dataQuality:['confirmed']}));
 assert.throws(()=>helpers.parseMeetingAgreement({...meeting,weekStart:'2026-11-05'}));
 assert.throws(()=>helpers.parseMeetingAgreement({...meeting,kpi:'invalid'}));
 assert.throws(()=>helpers.parseMeetingAgreement({...meeting,nextReview:' '}));
 assert.throws(()=>helpers.parseMeetingAgreement({...meeting,dataQuality:'made-up'}));
 assert.equal((await request('POST',base)).code,401);
 session=manager;
 for(const patch of [{ownerId:''},{ownerId:'other'},{dueAt:''},{dueAt:'2026-02-30'},{meeting:{...meeting,weekStart:'2026-11-05'}}]){
  assert.equal((await request('POST',{...base,...patch})).code,400);
 }
 assert.equal((await request('POST',{...base,location:'Orange'})).code,403);
 assert.equal(notifications,0);
 const created=await request('POST',base);
 assert.equal(created.code,201,JSON.stringify(created.body));
 const id=created.body.action.id;
 assert.deepEqual(created.body.action.meeting,meeting);
 assert.equal(notifications,0,'Saving an agreement never sends automatically');
 assert.equal(created.body.notificationDelivery.status,'not_requested');
 assert.equal(observers,0);
 const detail=await request('GET',{}, {id});
 assert.deepEqual(detail.body.action.meeting,meeting);
 assert.equal(detail.body.action.dueAt,base.dueAt);
 assert.equal(JSON.parse(detail.body.audit[0].after_value).meeting.weekStart,meeting.weekStart);
 const updatedMeeting={...meeting,dataQuality:'confirmed',nextReview:'Se validó la cifra; revisar de nuevo el martes.'};
 const updated=await request('PUT',{id,meeting:updatedMeeting});
 assert.equal(updated.code,200,JSON.stringify(updated.body));
 assert.deepEqual(updated.body.action.meeting,updatedMeeting);
 assert.equal(notifications,0,'Editing follow-up does not resend assignment');
 const audit=await store.listActionAudit(id);
 const latest=audit.find(row=>row.event==='Action updated');
 assert.deepEqual(JSON.parse(latest.before_value).meeting,meeting);
 assert.deepEqual(JSON.parse(latest.after_value).meeting,updatedMeeting);
 for(const patch of [{meeting:{...meeting,weekStart:'2026-11-11'}},{meeting:null},{ownerId:''},{dueAt:''}]){
  assert.equal((await request('PUT',{id,...patch})).code,400);
 }
 assert.equal(helpers.matchesMeetingWeek(updated.body.action,'2026-11-11',true),true);
 assert.equal(helpers.matchesMeetingWeek(updated.body.action,'2026-11-11',false),false);
 assert.equal((await request('PUT',{id,status:'Completed',verificationStatus:'Worked'})).code,400);
 assert.equal((await request('PUT',{id,status:'Completed'})).code,400);
 assert.equal((await request('PUT',{id,status:'Completed',verificationNote:' '})).code,400);
 assert.equal((await request('PUT',{id,verificationNote:'x'.repeat(5001)})).code,400);
 assert.equal((await request('PUT',{id,verificationNote:[]})).code,400);
 session={...manager,role:'HR'};
 assert.equal((await request('PUT',{id,status:'Completed',verificationNote:'Trabajo documentado'})).code,403);
 session=manager;
 const closed=await request('PUT',{id,status:'Completed',verificationNote:'Evidencia de prueba'});
 assert.equal(closed.code,200);
 assert.equal(closed.body.action.verificationStatus,'Pending','Completion does not invent a successful measured improvement');
 assert.equal(closed.body.action.verifiedAt,undefined);
 assert.equal((await request('PUT',{id,status:'Completed',verificationNote:''})).code,400);
 assert.equal((await request('PUT',{id,status:'Investigating'})).code,200);
 const completedUsingSavedNote=await request('PUT',{id,status:'Completed'});
 assert.equal(completedUsingSavedNote.code,200,'Previously recorded result can support completion');
 assert.equal(completedUsingSavedNote.body.action.verificationStatus,'Pending');
 assert.equal(helpers.matchesMeetingWeek(closed.body.action,'2026-11-11',true),false);
 assert.equal(helpers.matchesMeetingWeek(closed.body.action,'2026-11-04',true),true);
 const list=await request('GET');assert.equal(list.body.actions.filter(a=>a.id===id).length,1,'Same agreement has one record');
 const ordinary=await request('POST',{...base,meeting:undefined,ownerId:''});
 assert.equal(ordinary.code,400,'Explicit undefined context is invalid');
 const {meeting:_,...regular}=base;
 const legacy=await request('POST',{...regular,ownerId:'',dueAt:''});
 assert.equal(legacy.code,201);assert.equal(legacy.body.action.meeting,undefined);
 // Content edits are bounded, audited and guarded against stale overwrites.
 const current=await store.getAction(id);
 const edited=await request('PUT',{id,title:'Título corregido',cause:'Causa corregida',recommendation:'Acción revisada',expectedUpdatedAt:current.updatedAt});
 assert.equal(edited.code,200,JSON.stringify(edited.body));
 assert.equal(edited.body.action.title,'Título corregido');assert.equal(edited.body.action.cause,'Causa corregida');
 assert.equal((await request('PUT',{id,title:'Edición obsoleta',expectedUpdatedAt:current.updatedAt})).code,409);
 const editAudit=(await store.listActionAudit(id))[0];
 assert.equal(JSON.parse(editAudit.after_value).recommendation,'Acción revisada');
 assert.equal((await request('PUT',{id,title:'Sobrescribir',expectedUpdatedAt:'2000-01-01T00:00:00.000Z'})).code,409);
 assert.equal((await request('PUT',{id,title:'x'.repeat(241)})).code,400);
 assert.equal((await request('PUT',{id,cause:[]})).code,400);
 assert.equal((await request('PUT',{id,notifyOwner:'true'})).code,400);
 assert.equal(notifications,0);
 const reassigned=await request('PUT',{id,ownerId:'founder'});assert.equal(reassigned.code,200);assert.equal(notifications,0);
 const sent=await request('PUT',{id,notifyOwner:true});assert.equal(sent.code,200);assert.equal(sent.body.notificationDelivery.status,'accepted');assert.equal(notifications,1);assert.equal(observers,0);
 const resend=await request('PUT',{id,notifyOwner:true});assert.equal(resend.code,200);assert.equal(notifications,2);
 deliveryError=true;
 const uncertain=await request('PUT',{id,title:'Guardado con aviso incierto',notifyOwner:true});
 assert.equal(uncertain.code,200);assert.equal(uncertain.body.action.title,'Guardado con aviso incierto');assert.equal(uncertain.body.notificationDelivery.status,'unconfirmed');
 deliveryError=false;
 const optIn=await request('POST',{...base,notifyOwner:true});assert.equal(optIn.code,201);assert.equal(notifications,4);assert.equal(observers,0);
 deliveryResult={sent:true,email:{accepted:0,queued:1}};
 assert.equal((await request('PUT',{id,notifyOwner:true})).body.notificationDelivery.status,'pending');
 deliveryResult={sent:true,email:{accepted:0}};
 assert.equal((await request('PUT',{id,notifyOwner:true})).body.notificationDelivery.status,'unconfirmed');
 deliveryResult={sent:true,pushQueued:1,email:{accepted:0}};
 assert.equal((await request('PUT',{id,notifyOwner:true})).body.notificationDelivery.status,'pending');
 deliveryResult={sent:true,email:{accepted:1}};
 const ordinaryAssigned=await request('POST',regular);assert.equal(ordinaryAssigned.code,201);assert.equal(notifications,8);assert.equal(observers,1);
 const notificationSource=readFileSync(resolve(root,'server/actionNotificationStore.ts'),'utf8');
 assert.ok(notificationSource.includes('auto_escalate=excluded.auto_escalate'));
 assert.ok(notificationSource.includes('${!action.meeting}'));
 assert.ok(notificationSource.includes('and auto_escalate=true'));
 session=other;assert.equal((await request('GET',{}, {id})).code,403);assert.equal((await request('PUT',{id,meeting})).code,403);
 assert.equal((await request('GET')).body.actions.length,0);
 session={...manager,organizationId:'org-other'};assert.equal((await request('GET')).code,403);
 session={...manager,role:'Online Reputation Manager'};assert.equal((await request('GET')).code,403);
 session={...manager,role:'HR'};assert.equal((await request('PUT',{id,verificationStatus:'Worked',verificationNote:'test'})).code,403);
 assert.equal(notifications,8);
 assert.equal(observers,1,'Only the ordinary action notified observers');
 console.log('Meeting agreements passed: API → PostgreSQL persistence, audit before/after, immutable week, owner/date validation, prior-week follow-up, verification evidence, existing actions, roles, locations and tenants. No live writes or messages.');
}finally{
 globalThis.fetch=originalFetch;
 if(oldDatabaseUrl===undefined)delete process.env.OPSVISTA_DATABASE_URL;else process.env.OPSVISTA_DATABASE_URL=oldDatabaseUrl;
 await database.close();
}
