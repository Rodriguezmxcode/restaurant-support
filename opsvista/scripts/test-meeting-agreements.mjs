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
let session=null,notifications=0;
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
 'server/actionNotificationStore.ts':{dispatchActionPush:async()=>{notifications++;return{sent:true};},getActionNotification:async()=>({state:null,events:[]})},
 'server/operationalNotificationRouting.ts':{notifyActionObservers:async()=>{notifications++;}},
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
 assert.equal(helpers.parseMeetingAgreement({...meeting,nextReview:' '}).nextReview,'');
 assert.throws(()=>helpers.parseMeetingAgreement({...meeting,startAt:'2026-02-30'}));
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
 assert.equal(notifications,2,'Only successful assignment calls notification mocks');
 const detail=await request('GET',{}, {id});
 assert.deepEqual(detail.body.action.meeting,meeting);
 assert.equal(detail.body.action.dueAt,base.dueAt);
 assert.equal(JSON.parse(detail.body.audit[0].after_value).meeting.weekStart,meeting.weekStart);
 const updatedMeeting={...meeting,dataQuality:'confirmed',nextReview:'Se validó la cifra; revisar de nuevo el martes.'};
 const updated=await request('PUT',{id,meeting:updatedMeeting});
 assert.equal(updated.code,200,JSON.stringify(updated.body));
 assert.deepEqual(updated.body.action.meeting,updatedMeeting);
 assert.equal(notifications,2,'Editing follow-up does not resend assignment');
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
 const closed=await request('PUT',{id,status:'Completed',verificationStatus:'Worked',verificationNote:'Evidencia de prueba',verifiedAt:new Date().toISOString()});
 assert.equal(closed.code,200);
 assert.equal(helpers.matchesMeetingWeek(closed.body.action,'2026-11-11',true),false);
 assert.equal(helpers.matchesMeetingWeek(closed.body.action,'2026-11-04',true),true);
 const list=await request('GET');assert.equal(list.body.actions.filter(a=>a.id===id).length,1,'Same agreement has one record');
 const ordinary=await request('POST',{...base,meeting:undefined,ownerId:''});
 assert.equal(ordinary.code,400,'Explicit undefined context is invalid');
 const {meeting:_,...regular}=base;
 const legacy=await request('POST',{...regular,ownerId:'',dueAt:''});
 assert.equal(legacy.code,201);assert.equal(legacy.body.action.meeting,undefined);
 const simpleMeeting={...meeting,startAt:'2026-11-08',nextReview:''};
 const simple=await request('POST',{...base,meeting:simpleMeeting,signal:'',cause:'',recommendation:''});
 assert.equal(simple.code,201,JSON.stringify(simple.body));
 assert.equal(simple.body.action.recommendation,base.title,'Owner notification uses the task when optional instructions are empty');
 const simpleId=simple.body.action.id;
 const simpleDetail=await request('GET',{}, {id:simpleId});
 assert.deepEqual(simpleDetail.body.action.meeting,simpleMeeting,'Start date and optional review survive storage');
 assert.equal((await request('POST',{...base,meeting:{...simpleMeeting,startAt:'2026-11-11'}})).code,400);
 assert.equal((await request('PUT',{id:simpleId,dueAt:'2026-11-07'})).code,400);
 assert.equal((await request('PUT',{id:simpleId,meeting:{...simpleMeeting,startAt:'2026-11-11'}})).code,400);
 const changedDates=await request('PUT',{id:simpleId,meeting:{...simpleMeeting,startAt:'2026-11-09'},dueAt:'2026-11-12'});
 assert.equal(changedDates.code,200);assert.equal(changedDates.body.action.meeting.startAt,'2026-11-09');
 const dismissed=await request('PUT',{id:simpleId,status:'Dismissed',reason:'Duplicate alert — test fixture'});
 assert.equal(dismissed.code,200);
 const simpleAudit=await store.listActionAudit(simpleId);
 assert.ok(simpleAudit.some(row=>row.reason==='Duplicate alert — test fixture'),'Dismissal keeps the entered reason');
 assert.equal((await request('GET',{}, {id:simpleId})).body.action.status,'Dismissed');
 session=other;assert.equal((await request('GET',{}, {id})).code,403);assert.equal((await request('PUT',{id,meeting})).code,403);
 assert.equal((await request('GET')).body.actions.length,0);
 session={...manager,organizationId:'org-other'};assert.equal((await request('GET')).code,403);
 session={...manager,role:'Online Reputation Manager'};assert.equal((await request('GET')).code,403);
 session={...manager,role:'HR'};assert.equal((await request('PUT',{id,verificationStatus:'Worked',verificationNote:'test'})).code,403);
 assert.equal(notifications,4);
 console.log('Meeting agreements passed: API → PostgreSQL persistence, audit before/after, immutable week, owner/date validation, prior-week follow-up, verification evidence, existing actions, roles, locations and tenants. No live writes or messages.');
}finally{
 globalThis.fetch=originalFetch;
 if(oldDatabaseUrl===undefined)delete process.env.OPSVISTA_DATABASE_URL;else process.env.OPSVISTA_DATABASE_URL=oldDatabaseUrl;
 await database.close();
}
