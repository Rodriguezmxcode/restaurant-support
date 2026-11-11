import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { defaultAlertPolicy, healthState } from '../shared/connectionHealth.js';
const pg = new PGlite();
const sql: any = (parts: any, ...values: any[]) => {
  if (!parts.raw) return {__list:parts};
  const params: any[] = []; let query=parts[0];
  values.forEach((value,i)=>{
    if(value?.__list) query += '('+value.__list.map((v:any)=>{params.push(v);return '$'+params.length;}).join(',')+')';
    else {params.push(value?.__json!==undefined?JSON.stringify(value.__json):value);query+='$'+params.length;}
    query+=parts[i+1];
  });
  return pg.query(query,params).then(result=>result.rows);
};
sql.json=(value:unknown)=>({__json:value});
let transactions=Promise.resolve();
sql.begin=(fn:any)=>{const run=transactions.then(async()=>{await pg.exec('BEGIN');try{const result=await fn(sql);await pg.exec('COMMIT');return result;}catch(error){await pg.exec('ROLLBACK');throw error;}});transactions=run.catch(()=>{});return run;};
mock.module('postgres',{defaultExport:()=>sql});
process.env.OPSVISTA_DATABASE_URL='postgres://synthetic-only';
process.env.OPSVISTA_SESSION_SECRET='synthetic-test-key-not-a-production-secret';
process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID='owner-only';
process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET='owner-only';
process.env.GOOGLE_BUSINESS_PROFILE_REFRESH_TOKEN='owner-only';
process.env.GOOGLE_BUSINESS_PROFILE_ACCOUNT_ID='owner-only-account';
process.env.GOOGLE_BUSINESS_PROFILE_LOCATION_MAP_JSON='{"Downtown":"locations/owner-only"}';
process.env.RESTAURANT365_DOMAIN='owner-only';process.env.RESTAURANT365_USERNAME='owner-only';process.env.RESTAURANT365_PASSWORD='synthetic';
const orgs:any[]=['a','b','empty'].map(id=>({id:'org-'+id,name:'Company '+id,status:'active',locations:['Downtown','Uptown']}));
const users:any[]=[{id:'a',organizationId:'org-a',role:'Corporate',active:true,locations:[]},{id:'b',organizationId:'org-b',role:'Location Manager',active:true,locations:['Downtown','Uptown'],locationGrants:[{location:'Downtown'},{location:'Uptown',expiresAt:'2020-01-01'}]}];
mock.module('./managementStore.js',{namedExports:{listManagedUsers:async(org:string)=>users.filter(user=>user.organizationId===org),getManagedUser:async(id:string)=>users.find(user=>user.id===id)}});
mock.module('./organizationStore.js',{namedExports:{listOrganizations:async()=>orgs,getOrganizationMembership:async(id:string)=>{const user=users.find(user=>user.id===id);return user?{organizationId:user.organizationId,organizationLocations:['Downtown','Uptown']}:null;}}});
mock.module('./sourceSyncAuth.js',{namedExports:{authorizedSourceSync:async(value:string)=>value==='Bearer synthetic'}});
let sent:any[]=[];
mock.module('./webPushStore.js',{namedExports:{sendWebPushToUsers:async(ids:any,actor:any,payload:any)=>{sent.push({ids,actor,payload});return{devices:ids.length,accepted:ids.length};}}});
const integration=await import('./integrationStore.js');
const google=await import('./googleBusinessProfile.js');
const policy=await import('./organizationAlerts.js');
const store=await import('./operationalAlertStore.js');
const runner=await import('./scheduledOperationalAlerts.js');
const endpoint=await import('./connectionHealthEndpoint.js');
const {getPriceWatch}=await import('./priceWatch.js');
const {getRestaurant365Status}=await import('./restaurant365OData.js');
let calls:string[]=[], failGoogle=false, ambiguous=false;
const originalFetch=globalThis.fetch;
globalThis.fetch=(async(url:any,options:any)=>{
  calls.push(String(url));
  if(failGoogle) return new Response('{}',{status:503});
  if(String(url).includes('oauth2.googleapis.com')) return new Response(JSON.stringify({access_token:'token-'+new URLSearchParams(options.body).get('refresh_token'),expires_in:3600}));
  const tenant=String(new Headers(options.headers).get('authorization')).includes('refresh-a')?'a':'b';
  if(String(url).includes('accountmanagement')) return new Response(JSON.stringify({accounts:[{name:'accounts/'+tenant}]}));
  assert.ok(!String(url).includes('owner-only'));
  if(String(url).includes('businessinformation')) return new Response(JSON.stringify({locations:[{name:'locations/'+tenant,title:'Downtown'},{name:'locations/'+tenant+'-up',title:'Uptown'},...(ambiguous?[{name:'locations/duplicate',title:'Downtown'}]:[])]}));
  if(String(url).includes('/reviews')) return new Response(JSON.stringify({reviews:[{reviewId:'one',starRating:'ONE',createTime:'2026-10-03T14:00:00Z',updateTime:'2026-10-03T14:00:00Z',comment:'Synthetic review'}]}));
  throw new Error('Unexpected URL '+url);
}) as typeof fetch;
const now=new Date('2026-10-03T16:00:00Z');
const response=()=>({code:0,body:null as any,status(n:number){this.code=n;return this;},json(value:any){this.body=value;},setHeader(){}});
const request=async(method='GET',body?:any,user=users[0],headers:any={origin:'https://opsvista.test',host:'opsvista.test','content-type':'application/json'})=>{const res=response();await endpoint.connectionHealthEndpoint({method,body,headers},res,user);return res;};
test.before(async()=>{
 await pg.exec(`create table opsvista_management_users(id text primary key,organization_id text,role text,active boolean,locations jsonb,location_grants jsonb);
 create table opsvista_organizations(id text primary key,status text,locations jsonb);
 create table opsvista_organization_memberships(user_id text primary key,organization_id text);
 insert into opsvista_organizations values('org-a','active','["Downtown","Uptown"]'),('org-b','active','["Downtown","Uptown"]');
 insert into opsvista_management_users values('a','org-a','Corporate',true,'[]','[]'),('b','org-b','Location Manager',true,'["Downtown","Uptown"]','[{"location":"Downtown"},{"location":"Uptown","expiresAt":"2020-01-01"}]');
 insert into opsvista_organization_memberships values('a','org-a'),('b','org-b');`);
 for(const id of ['a','b']){await integration.saveGoogleBusinessClient('org-'+id,'client-'+id,'synthetic');await integration.saveGoogleBusinessAuthorization('org-'+id,'refresh-'+id);}
});
test('unconnected companies never fall back to owner Google or R365 credentials',async()=>{
 const before=calls.length;
 assert.equal(await google.googleBusinessProfileConfigured('org-empty'),false);
 await assert.rejects(()=>google.getGoogleReviewSummaries('2026-10-01','2026-10-03',['Downtown'],'org-empty'),/not configured/);
 await assert.rejects(()=>getPriceWatch('org-empty','2026-10-01','2026-10-03'),/no está conectado/);
 assert.equal((await getRestaurant365Status('org-empty')).configured,false);
 assert.equal(calls.length,before);
 assert.ok((await policy.connectionInventory('org-empty')).every(provider=>!provider.configured));
});
test('real review loader uses each tenant authorization, custom restaurant and account; ambiguous matching is unavailable',async()=>{
 const a=await google.getGoogleReviewSummaries('2026-10-01','2026-10-03',['Downtown'],'org-a');
 const b=await google.getGoogleReviewSummaries('2026-10-01','2026-10-03',['Downtown'],'org-b');
 assert.equal(a.account,'accounts/a');assert.equal(b.account,'accounts/b');assert.equal(a.locations[0].reviewCount,1);
 ambiguous=true;
 assert.ok((await google.getGoogleReviewSummaries('2026-10-01','2026-10-03',['Downtown'],'org-a')).locations[0].mappingError);
 ambiguous=false;
});
test('same-named locations have independent leases, event ledgers and recipients',async()=>{
 const a=await policy.alertOrganizationContext('org-a'), b=await policy.alertOrganizationContext('org-b');
 sent=[];
 const results=await Promise.all([runner.runScheduledAlertJob('reviews','Downtown',now,false,a),runner.runScheduledAlertJob('reviews','Downtown',now,false,b)]);
 assert.ok(results.every(result=>result.ok));assert.equal(sent.length,2);
 assert.deepEqual(sent.map(item=>[item.actor.organizationId,item.ids]).sort(),[['org-a',['a']],['org-b',['b']]]);
 assert.equal((await store.alertInbox(users[0],null)).alerts.length,1);
 assert.equal((await store.alertInbox({...users[0],organizationId:'org-b'},null)).alerts.length,0);
 await runner.runScheduledAlertJob('reviews','Downtown',new Date('2026-10-03T16:30:00Z'),false,a);
 assert.equal(sent.length,2);
 assert.deepEqual(runner.scheduledRecipients({kind:'reviews',location:'Downtown'} as any,users,now,'org-a'),['a']);
 assert.deepEqual(runner.scheduledRecipients({kind:'reviews',location:'Uptown'} as any,users,now,'org-b'),[]);
});
test('source errors preserve last success and cannot create a false violation; verify-only does not send',async()=>{
 const a=await policy.alertOrganizationContext('org-a'),before=sent.length;
 failGoogle=true;
 const failed=await runner.runScheduledAlertJob('reviews','Downtown',new Date('2026-10-03T17:00:00Z'),false,a);
 assert.equal(failed.ok,false);assert.equal(sent.length,before);
 const row=(await store.getAlertJobs('org-a')).find(row=>row.job==='reviews:Downtown')!;
 assert.equal(row.verifiedAt,'2026-10-03T16:30:00.000Z');assert.equal(healthState(row,new Date('2026-10-03T17:00:00Z')),'error');
 failGoogle=false;
 await runner.runScheduledAlertJob('reviews','Uptown',now,true,a);assert.equal(sent.length,before);
 assert.equal((await runner.runScheduledAlertJob('tasks','Downtown',now,false,a)).ok,false);
});
test('health endpoint enforces active role, membership, expired location grants and same-origin administrator writes',async()=>{
 const manager=await request('GET',undefined,users[1]);assert.equal(manager.code,200);assert.deepEqual(manager.body.locations,['Downtown']);assert.ok(manager.body.rules.every((row:any)=>row.location==='Downtown'));
 assert.equal((await request('PUT',{revision:0},users[1])).code,403);
 assert.equal((await request('GET',undefined,{...users[0],organizationId:'org-b'})).code,403);
 assert.equal((await request('GET',undefined,{...users[1],role:'Corporate'})).code,403);
 assert.equal((await request('PUT',{revision:0},users[0],{origin:'https://other.test',host:'opsvista.test','content-type':'application/json'})).code,403);
 assert.equal((await request('PUT',{revision:0,organizationId:'org-b'})).code,400);
});
test('company rule edits persist atomically with audit, reject stale revisions and affect later scans',async()=>{
 const saved=await request('PUT',{revision:0,reviewRating:1,reviewHours:48,priceIncreasePct:10,enabled:{reviews:false},timeZone:'America/Los_Angeles'});
 assert.equal(saved.code,200);assert.equal(saved.body.policy.revision,1);
 assert.equal((await request('PUT',{revision:0,reviewHours:24})).code,409);
 assert.equal((await policy.getAlertPolicy('org-b')).reviewHours,24);
 assert.equal((await pg.query('select * from opsvista_alert_policy_audit')).rows.length,1);
 const before=calls.length;
 assert.equal((await runner.runScheduledAlertJob('reviews','Downtown',now,false,await policy.alertOrganizationContext('org-a'))).paused,true);
 assert.equal(calls.length,before);
 for(const change of [{reviewHours:0},{reviewRating:5},{priceIncreasePct:1},{enabled:{unknown:true}},{enabled:{reviews:'true'}},{timeZone:'invalid/zone'}]) assert.equal((await request('PUT',{revision:1,...change})).code,400);
 assert.equal((await pg.query('select * from opsvista_alert_policy_audit')).rows.length,1);
});
test('local business day handles daylight saving and health detects daytime failures without overnight false alarms',()=>{
 assert.equal(runner.localDayStart(new Date('2026-03-08T20:00:00Z'),'America/New_York'),'2026-03-08T05:00:00.000Z');
 assert.equal(runner.localDayStart(new Date('2026-11-01T20:00:00Z'),'America/New_York'),'2026-11-01T04:00:00.000Z');
 const row={job:'reviews:Downtown',status:'ok',verifiedAt:'2026-10-03T15:00:00Z'};
 assert.equal(healthState(row,new Date('2026-10-03T18:00:00Z')),'stale');
 assert.equal(healthState({...row,verifiedAt:'2026-10-03T02:00:00Z'},new Date('2026-10-03T12:00:00Z')),'checked');
});
test('scheduler manifest selects active connected company rules and isolates a broken credential',async()=>{
 const res=response();
 await runner.scheduledAlertsEndpoint({method:'POST',headers:{authorization:'Bearer synthetic'},query:{job:'plan',verify:'1'}},res);
 assert.equal(res.code,200);
 assert.deepEqual(res.body.jobs,[{job:'reviews',location:'Downtown',organizationId:'org-b'},{job:'reviews',location:'Uptown',organizationId:'org-b'}]);
 await pg.query("insert into opsvista_integration_credentials(organization_id,provider,client_id,client_secret_encrypted) values('org-empty','google-business-profile','broken','invalid')");
 const broken=response();await runner.scheduledAlertsEndpoint({method:'POST',headers:{authorization:'Bearer synthetic'},query:{job:'plan',verify:'1'}},broken);
 assert.equal(broken.code,200);assert.equal(broken.body.configurationFailures,1);assert.deepEqual(broken.body.jobs,res.body.jobs);
 assert.ok((await store.getAlertJobs('org-b')).some(row=>row.job==='heartbeat'));
});
test.after(async()=>{globalThis.fetch=originalFetch;await pg.close();});
