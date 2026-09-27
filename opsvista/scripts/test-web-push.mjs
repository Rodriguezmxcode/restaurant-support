import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createECDH, randomBytes } from 'node:crypto';
import ts from 'typescript';
import webpush from 'web-push';

const temp = await mkdtemp(join(process.cwd(), 'node_modules/.opsvista-push-test-'));
const originalSend = webpush.sendNotification;
const originalSecret = process.env.OPSVISTA_SESSION_SECRET;
const originalDb = process.env.OPSVISTA_DATABASE_URL;
let db;
try {
  process.env.OPSVISTA_SESSION_SECRET = 'test-only-signing-secret-never-for-production';
  process.env.OPSVISTA_DATABASE_URL = 'postgres://test-only';
  await writeFile(join(temp,'package.json'), '{"type":"module"}');
  for (const name of ['webPushDelivery','webPushStore','webPushEndpoint']) {
    let source = await readFile(new URL(`../server/${name}.ts`,import.meta.url),'utf8');
    if (name === 'webPushStore') source = source.replace("from 'postgres'", "from './testDb.js'");
    await writeFile(join(temp,`${name}.js`),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
  }
  await writeFile(join(temp,'testDb.js'), `
    import { PGlite } from '@electric-sql/pglite';
    export const db = new PGlite();
    function query(strings,...values) {
      if (!strings.raw) return { values: strings };
      const params=[];let text=strings[0];
      values.forEach((value,i)=>{
        if(value && value.values) text+='('+value.values.map(v=>{params.push(v);return '$'+params.length}).join(',')+')';
        else {params.push(value);text+='$'+params.length}
        text+=strings[i+1];
      });
      return db.query(text,params).then(result=>result.rows);
    }
    export default function postgres(){return query}
  `);
  await writeFile(join(temp,'pushMfaStore.js'), 'export async function pushMfaDevice(){return null}');
  await writeFile(join(temp,'managementStore.js'), `import {db} from './testDb.js'; export async function getManagedUser(id){return (await db.query('select * from opsvista_management_users where id=$1',[id])).rows[0]}`);
  await writeFile(join(temp,'organizationStore.js'), `import {db} from './testDb.js'; export async function getOrganizationMembership(id){const row=(await db.query('select organization_id from test_memberships where user_id=$1',[id])).rows[0];return row?{organizationId:row.organization_id}:null}`);
  await writeFile(join(temp,'actionNotificationStore.js'), `import {db} from './testDb.js'; export async function getNotificationPreferences(user){const row=(await db.query('select * from opsvista_notification_preferences where user_id=$1 and organization_id=$2',[user.id,user.organizationId])).rows[0];return {emailEnabled:true,pushEnabled:row?.push_enabled??true,smsEnabled:false}};export async function updateNotificationPreferences(value,user){await db.query('update opsvista_notification_preferences set push_enabled=$1 where user_id=$2 and organization_id=$3',[value.pushEnabled,user.id,user.organizationId]);return value}`);
  db = (await import(join(temp,'testDb.js'))).db;
  await db.exec(`create table opsvista_management_users(id text primary key,organization_id text,active boolean,role text not null default 'Location Manager');
    create table test_memberships(user_id text primary key,organization_id text);
    create table opsvista_notification_preferences(user_id text,organization_id text,push_enabled boolean);
    insert into opsvista_management_users(id,organization_id,active) values ('alice','org-a',true),('bob','org-a',true),('carol','org-b',true),('disabled','org-a',false);
    insert into test_memberships select id,organization_id from opsvista_management_users;
    insert into opsvista_management_users values ('founder','org-puerto-vallarta',true,'Founder'),('inactive-founder','org-puerto-vallarta',false,'Founder'),('no-membership','org-a',true,'Location Manager');
    insert into opsvista_notification_preferences values ('alice','org-a',true),('bob','org-a',false),('carol','org-b',true),('disabled','org-a',true);`);
  const delivery = await import(join(temp,'webPushDelivery.js'));
  const preview = delivery.pushPayload({title:'Orange · Voids',body:'Voids 0.80% (>0.50%). Revisar anulaciones.',priority:'high'},'es');
  assert.equal(preview.title, 'OpsVista · Alta prioridad · Orange · Voids');
  assert.ok(preview.body.includes('0.80%')); assert.equal(preview.urgency,'high');
  assert.ok(delivery.pushPayload({body:'x'.repeat(1000)}).body.length <= 280);
  assert.equal(delivery.pushPayload({body:'a\nb'}).body,'a b');
  console.log('PASS descriptive alert preview, priority and bounded plain text');
  const store = await import(join(temp,'webPushStore.js'));
  const {webPushEndpoint} = await import(join(temp,'webPushEndpoint.js'));
  const ecdh=createECDH('prime256v1');ecdh.generateKeys();
  const keys={p256dh:ecdh.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')};
  const subscription=id=>({endpoint:`https://fcm.googleapis.com/fcm/send/test-${id}`,keys});
  const user=id=>({id,role:'Location Manager',organizationId:id==='carol'?'org-b':'org-a'});
  for(const endpoint of ['http://fcm.googleapis.com/x','https://127.0.0.1/x','https://fcm.googleapis.com.evil.test/x','https://u:p@fcm.googleapis.com/x','https://fcm.googleapis.com:8443/x','https://evil.test/x','https://fcm.googleapis.com/x#fragment']) assert.throws(()=>delivery.validateWebSubscription({...subscription('a'),endpoint}));
  assert.throws(()=>delivery.validateWebSubscription({...subscription('a'),keys:{...keys,p256dh:'x'.repeat(87)}}));
  for(const host of ['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com']) assert.equal(delivery.validateWebSubscription({...subscription('a'),endpoint:`https://${host}/test`}).endpoint,`https://${host}/test`);
  const headers={host:'restaurant-support.vercel.app',origin:'https://restaurant-support.vercel.app','content-type':'application/json'};
  assert.equal(delivery.isSameOriginPushRequest(headers),true);
  assert.equal(delivery.isSameOriginPushRequest({...headers,origin:'https://evil.test'}),false);
  assert.equal(delivery.isSameOriginPushRequest({...headers,'content-type':'text/plain'}),false);
  assert.equal(delivery.isSameOriginPushRequest({...headers,origin:undefined}),false);
  console.log('PASS endpoint allowlist, key validation and cross-origin rejection');
  const [publicKey1,publicKey2]=await Promise.all([store.webPushPublicKey(),store.webPushPublicKey()]);assert.equal(publicKey1,publicKey2);
  const keyRow=(await db.query('select * from opsvista_web_push_keys')).rows;
  assert.equal(keyRow.length,1);assert.equal(keyRow[0].private_key_encrypted.split('.').length,3);
  console.log('PASS stable signing key initialization and encrypted storage');
  for(const id of ['alice','bob','carol','disabled']) await store.registerWebPush(subscription(id),'es',user(id));
  const sent=[];
  webpush.sendNotification=async(sub,payload)=>{sent.push({sub,payload:JSON.parse(payload)});return {statusCode:201}};
  const result=await store.sendWebPushToUsers(['alice','bob','carol','disabled'],user('alice'),{actionId:'action-123'});
  assert.equal(result.accepted,1);assert.equal(sent.length,1);assert.equal(sent[0].sub.endpoint,subscription('alice').endpoint);
  assert.equal(sent[0].payload.url,'/?action=action-123');assert.equal(sent[0].payload.title,'OpsVista');assert.ok(!JSON.stringify(sent[0].payload).includes('alice'));
  assert.equal(await store.webPushRegistered(subscription('alice').endpoint,user('bob')),false);
  await store.removeWebPush(subscription('alice').endpoint,user('bob'));
  assert.equal(await store.webPushRegistered(subscription('alice').endpoint,user('alice')),true);
  console.log('PASS tenant isolation, disabled accounts, opt-out, ownership and private lock-screen content');
  assert.equal((await store.testWebPush(subscription('alice').endpoint,user('alice'))).accepted,true);
  assert.equal((await store.testWebPush(subscription('alice').endpoint,user('alice'))).reason,'rate_limited');
  assert.equal((await store.testWebPush(subscription('alice').endpoint,user('carol'))).reason,'not_registered');
  const request=async(body,requestHeaders=headers,actor=user('alice'),method='POST')=>{let status,bodyOut;const res={status(code){status=code;return this},json(value){bodyOut=value},setHeader(){}};await webPushEndpoint({method,headers:requestHeaders,body},res,actor);return {status,body:bodyOut}};
  assert.equal((await request({action:'subscribe',subscription:subscription('new')},{...headers,origin:'https://evil.test'})).status,403);
  assert.equal((await request({action:'subscribe',subscription:subscription('new')},headers,{...user('alice'),organizationId:'org-b'})).status,403);
  assert.equal((await request({action:'subscribe',subscription:subscription('new')},headers,user('disabled'))).status,403);
  assert.equal((await request({action:'subscribe',subscription:{endpoint:'https://127.0.0.1',keys}})).status,400);
  assert.equal((await request({},headers,user('alice'),'DELETE')).status,405);
  assert.equal((await request({action:'status',endpoint:subscription('carol').endpoint})).body.registered,false);
  const status=await request(undefined,headers,user('alice'),'GET');assert.equal(status.status,200);assert.equal(status.body.publicKey,publicKey1);assert.equal('privateKey' in status.body,false);
  const founder={id:'founder',role:'Founder'};
  assert.equal((await request(undefined,headers,founder,'GET')).status,200);
  assert.equal((await request({action:'subscribe',subscription:subscription('founder')},headers,founder)).status,200);
  assert.equal((await request({action:'status',endpoint:subscription('founder').endpoint},headers,founder)).body.registered,true);
  assert.equal((await request({action:'test',endpoint:subscription('founder').endpoint},headers,founder)).body.accepted,true);
  assert.equal((await request(undefined,headers,{...founder,organizationId:'org-b'},'GET')).status,403);
  assert.equal((await request(undefined,headers,{...founder,id:'inactive-founder'},'GET')).status,403);
  assert.equal((await request(undefined,headers,{...user('alice'),role:'Founder'},'GET')).status,403);
  assert.equal((await request(undefined,headers,user('no-membership'),'GET')).status,403);
  assert.equal((await request({action:'status',endpoint:subscription('carol').endpoint},headers,founder)).body.registered,false);
  console.log('PASS Founder without membership: setup, subscribe and test; reject inactive/stale roles and other tenants');
  console.log('PASS test rate limit and authenticated endpoint ownership checks');
  webpush.sendNotification=async()=>{throw {statusCode:410}};
  assert.equal((await store.sendWebPushToUsers(['alice'],user('alice'),{})).accepted,0);
  assert.equal(await store.webPushRegistered(subscription('alice').endpoint,user('alice')),false);
  console.log('PASS expired subscriptions are removed and never reported as delivered');
} finally {
  webpush.sendNotification=originalSend;
  if(originalSecret===undefined)delete process.env.OPSVISTA_SESSION_SECRET;else process.env.OPSVISTA_SESSION_SECRET=originalSecret;
  if(originalDb===undefined)delete process.env.OPSVISTA_DATABASE_URL;else process.env.OPSVISTA_DATABASE_URL=originalDb;
  await db?.close();await rm(temp,{recursive:true,force:true});
}
