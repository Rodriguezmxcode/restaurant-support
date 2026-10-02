import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import webpush from 'web-push';
import { defaultNotificationPreferences, digestDueAt, effectivePushScope, notificationCategory, pushDecision } from '../shared/notificationPreferences.js';
import { tenantWorkflowAllowed } from '../shared/tenantAccess.js';

const pg = new PGlite();
const sql: any = (parts: any, ...values: any[]) => {
  if (!parts.raw) return { __list: parts };
  const params: any[] = []; let query = parts[0];
  values.forEach((value, i) => {
    if (value?.__list) query += '(' + value.__list.map((v: any) => { params.push(v); return '$' + params.length; }).join(',') + ')';
    else { params.push(value?.__json !== undefined ? JSON.stringify(value.__json) : value); query += '$' + params.length; }
    query += parts[i + 1];
  });
  return pg.query(query, params).then(result => result.rows);
};
sql.json = (value: unknown) => ({ __json: value });
let transactions = Promise.resolve();
sql.begin = (fn: any) => {
  const run = transactions.then(async () => { await pg.exec('BEGIN'); try { const result = await fn(sql); await pg.exec('COMMIT'); return result; } catch (error) { await pg.exec('ROLLBACK'); throw error; } });
  transactions = run.catch(() => {}); return run;
};
mock.module('postgres', { defaultExport: () => sql });
mock.module('./managementStore.js', { namedExports: { getManagedUser: async (id: string) => (await pg.query('select * from opsvista_management_users where id=$1', [id])).rows[0] } });
mock.module('./organizationStore.js', { namedExports: { getOrganizationMembership: async (id: string) => {
  const row: any = (await pg.query('select m.organization_id from opsvista_organization_memberships m join opsvista_organizations o on o.id=m.organization_id where m.user_id=$1 and o.status=\'active\'', [id])).rows[0];
  return row ? { organizationId: row.organization_id } : null;
} } });
process.env.OPSVISTA_DATABASE_URL = 'postgres://synthetic-only';
process.env.OPSVISTA_SESSION_SECRET = 'synthetic-test-key-not-a-production-secret';
delete process.env.RESEND_API_KEY;
const store = await import('./notificationPreferencesStore.js');
const { notificationPreferencesEndpoint } = await import('./notificationPreferencesEndpoint.js');
const push = await import('./webPushStore.js');
const { dispatchOperationalPush, dispatchActionPush } = await import('./actionNotificationStore.js');
const { flushPushDigests } = await import('./pushDigestDelivery.js');
const actor: any = { id: 'owner', name: 'Test owner', role: 'Corporate', organizationId: 'org-a', locations: [] };
const manager: any = { ...actor, id: 'manager', role: 'Location Manager' };
const other: any = { ...actor, id: 'other', organizationId: 'org-b' };
const headers = { origin: 'https://opsvista.test', host: 'opsvista.test', 'content-type': 'application/json' };
const request = async (method = 'GET', body?: any, user = actor, requestHeaders = headers) => {
  const res: any = { status(code: number) { this.code = code; return this; }, json(value: unknown) { this.body = value; }, setHeader() {} };
  await notificationPreferencesEndpoint({ method, body, headers: requestHeaders }, res, user); return res;
};
const update = (patch: any, user = actor) => store.updateNotificationPreferences(patch, user, ['Orange', 'Avon']);
let webSends: any[] = [], nativeSends: any[] = [], providerFails = false;
const originalWeb = webpush.sendNotification, originalFetch = globalThis.fetch;
webpush.sendNotification = async (subscription: any, payload: any) => {
  if (providerFails) throw { statusCode: 503 };
  webSends.push({ subscription, payload: JSON.parse(payload) }); return { statusCode: 201 } as any;
};
globalThis.fetch = (async (url: any, options: any) => {
  assert.equal(String(url), 'https://exp.host/--/api/v2/push/send');
  const messages = JSON.parse(options.body); nativeSends.push(...messages);
  return new Response(JSON.stringify({ data: messages.map(() => ({ status: 'ok' })) }), { status: 200 });
}) as typeof fetch;
const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
const subscription = (id: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } });

test.before(async () => {
  await pg.exec(`create table opsvista_management_users(id text primary key,organization_id text,role text,active boolean,name text,email text,locations jsonb default '[]',location_grants jsonb default '[]');
    create table opsvista_organizations(id text primary key,status text,locations jsonb);
    create table opsvista_organization_memberships(user_id text primary key,organization_id text);
    insert into opsvista_organizations values ('org-a','active','["Orange","Avon"]'),('org-b','active','["Orange","Other"]');
    insert into opsvista_management_users(id,organization_id,role,active,name,locations,location_grants) values
      ('owner','org-a','Corporate',true,'Owner','[]','[]'),('manager','org-a','Location Manager',true,'Manager','["Orange","Avon"]','[{"location":"Orange"},{"location":"Avon","expiresAt":"2020-01-01"}]'),
      ('other','org-b','Corporate',true,'Other','[]','[]'),('inactive','org-a','Corporate',false,'Inactive','[]','[]');
    insert into opsvista_organization_memberships select id,organization_id from opsvista_management_users;`);
  for (const user of [actor, manager, other]) await push.registerWebPush(subscription(user.id), 'en', user);
});
test('fresh defaults preserve existing alerts, marketing is off, category routing and DST are explicit', () => {
  const p = defaultNotificationPreferences();
  assert.equal(p.categories.updates, 'off'); assert.equal(p.categories.tasks, 'instant');
  for (const [from, to] of [['overtime','labor'],['Labor Intelligence','labor'],['performance','sales'],['prices','purchasing'],['Ramp Compliance','tasks'],['logbook','tasks'],['bonus','reports'],['Google Reviews','reviews'],['invoice','finance'],['maintenance','tasks']]) assert.equal(notificationCategory(from), to);
  assert.equal(digestDueAt('daily','America/New_York',new Date('2026-03-07T20:00:00Z')), '2026-03-08T13:00:00.000Z');
  assert.equal(digestDueAt('daily','America/New_York',new Date('2026-10-31T20:00:00Z')), '2026-11-01T14:00:00.000Z');
  assert.equal(digestDueAt('weekly','America/New_York',new Date('2026-10-02T20:00:00Z')), '2026-10-05T13:00:00.000Z');
  assert.equal(pushDecision(p, {category:'sales'}, ['Orange'], false), 'off');
});
test('preferences are server-authorized, scope expires and another tenant cannot be selected', async () => {
  const res = await request('GET', undefined, manager); assert.equal(res.code, 200); assert.deepEqual(res.body.allowedLocations,['Orange']);
  assert.equal((await request('PUT', { locations:['Avon'], revision:0 }, manager)).code, 403);
  assert.equal((await request('PUT', { locations:['Other'], revision:0 })).code, 403);
  assert.equal((await request('GET', undefined, {...actor, organizationId:'org-b'})).code, 403);
  assert.equal((await request('GET', undefined, {...actor, role:'Founder'})).code, 403);
  assert.equal((await request('GET', undefined, {...actor, id:'inactive'})).code, 403);
  assert.equal((await request('PUT', {pushEnabled:false}, actor, {...headers,origin:'https://other.test'})).code, 403);
  assert.equal((await request('PUT', {organizationId:'org-b'})).code, 400);
  for (const body of [{pushEnabled:'false'}, {categories:{labor:'unexpected'},revision:0}, {categories:{critical:'off'},revision:0}, {categories:{sales:'weekly'},revision:0}, {timeZone:'bad/zone',revision:0}, {categories:{sales:'off'}}]) assert.equal((await request('PUT', body)).code, 400);
  assert.equal(tenantWorkflowAllowed(other,'web_push'),true); assert.equal(tenantWorkflowAllowed(other,'notification_preferences'),true); assert.equal(tenantWorkflowAllowed(other,'payments'),false);
});
test('changes persist atomically with audit, revisions prevent lost updates and legacy email patches preserve push selections', async () => {
  const result = await request('PUT', {categories:{labor:'off'},locations:['Orange'],locale:'es',revision:0}); assert.equal(result.code,200);
  assert.equal((await request()).body.categories.labor,'off');
  const audit: any = (await pg.query('select * from opsvista_notification_preference_audit')).rows[0];
  assert.equal(audit.changed_by,actor.id); assert.equal(audit.old_value.categories.labor,'instant'); assert.equal(audit.new_value.categories.labor,'off');
  assert.equal((await request('PUT',{pushEnabled:false,revision:0})).code,409);
  assert.equal((await request('PUT',{emailEnabled:false})).code,200);
  const persisted = await store.getNotificationPreferences(actor); assert.equal(persisted.categories.labor,'off'); assert.deepEqual(persisted.locations,['Orange']);
  assert.equal((await store.getNotificationPreferences(other)).categories.labor,'instant');
  const concurrent = await Promise.allSettled([update({pushEnabled:false,revision:persisted.revision}), update({pushEnabled:true,revision:persisted.revision})]);
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
  await update({pushEnabled:true,emailEnabled:true,locations:null});
});
test('real web transport obeys category, location, account and tenant filters; required login delivery remains independent', async () => {
  webSends=[];
  assert.equal((await push.sendWebPushToUsers(['owner','manager','other','inactive'],actor,{category:'labor',location:'Orange'})).accepted,1);
  assert.equal(webSends[0].subscription.endpoint.endsWith('/manager'),true);
  assert.equal((await push.sendWebPushToUsers(['manager'],actor,{category:'tasks',location:'Avon'})).accepted,0);
  await update({locations:[]});
  assert.equal((await push.sendWebPushToUsers(['owner'],actor,{category:'sales',location:'Orange'})).accepted,0);
  await update({pushEnabled:false});
  assert.equal((await push.sendWebPushToUsers(['owner'],actor,{category:'critical',location:'Orange'})).accepted,0);
  assert.equal((await push.sendLoginPush(subscription('security'),'123456','en','test-challenge')).accepted,true);
  await update({pushEnabled:true,locations:null,categories:{labor:'instant'}});
});
test('native operational alerts and Action Center assignments use the same category and location policy', async () => {
  await dispatchOperationalPush({eventKey:'init',category:'tasks',title:'Init',body:'Init',location:'Orange',recipientIds:[]},actor);
  await pg.exec("insert into opsvista_mobile_devices(token,organization_id,user_id,user_name,platform) values ('ExponentPushToken[test]','org-a','owner','Owner','ios')");
  await update({categories:{labor:'off'}}); webSends=[]; nativeSends=[];
  const input: any = {eventKey:'native-off',category:'labor',title:'Labor',body:'Too high',location:'Orange',recipientIds:['owner']};
  await dispatchOperationalPush(input,actor); assert.equal(webSends.length,0); assert.equal(nativeSends.length,0);
  const action: any = {id:'ACT-1',organizationId:'org-a',location:'Orange',category:'Labor Intelligence',ownerId:'owner',ownerName:'Owner',title:'Labor',recommendation:'Review',severity:'High'};
  await dispatchActionPush(action,actor); assert.equal(webSends.length,0); assert.equal(nativeSends.length,0);
  await update({categories:{labor:'instant'}});
  await dispatchOperationalPush({...input,eventKey:'native-on'},actor); assert.equal(webSends.length,1); assert.equal(nativeSends.length,1);
});
test('digest queue deduplicates events, sends once and rechecks current preferences and grants before delivery', async () => {
  await update({categories:{sales:'daily',reports:'weekly'}}); webSends=[]; nativeSends=[];
  const event = {category:'sales',location:'Orange',tag:'digest-sales',title:'Orange sales',body:'A sales alert'};
  const routed = await push.sendWebPushToUsers(['owner'],actor,event); assert.equal(routed.queued,1); assert.equal(webSends.length,0);
  await push.sendWebPushToUsers(['owner'],actor,event);
  assert.equal(Number((await pg.query('select count(*) from opsvista_push_digest')).rows[0].count),1);
  await pg.exec("update opsvista_push_digest set due_at=now()-interval '1 minute'");
  await flushPushDigests(); assert.equal(webSends.length,1); assert.equal(nativeSends.length,1);
  await flushPushDigests(); assert.equal(webSends.length,1);
  await push.sendWebPushToUsers(['owner'],actor,{...event,tag:'digest-off'});
  await update({categories:{sales:'off'}});
  await pg.exec("update opsvista_push_digest set due_at=now()-interval '1 minute'");
  await flushPushDigests(); assert.equal(webSends.length,1);
  const suppressed: any = (await pg.query("select status from opsvista_push_digest where event_key='digest-off'")).rows[0]; assert.equal(suppressed.status,'suppressed');
  await update({categories:{tasks:'daily'}},manager);
  await push.sendWebPushToUsers(['manager'],actor,{category:'tasks',location:'Orange',tag:'digest-scope'});
  await pg.exec(`update opsvista_management_users set location_grants='[{"location":"Orange","expiresAt":"2020-01-01"}]' where id='manager'; update opsvista_push_digest set due_at=now()-interval '1 minute'`);
  await flushPushDigests(); assert.equal(webSends.length,1);
});
test('digest leases prevent concurrent claims and provider failures retry without claiming receipt', async () => {
  await update({categories:{sales:'daily'}});
  await push.sendWebPushToUsers(['other'],other,{category:'sales',location:'Orange',tag:'other-instant'});
  await update({categories:{sales:'daily'}},other);
  await push.sendWebPushToUsers(['other'],other,{category:'sales',location:'Orange',tag:'retry'});
  await pg.exec("update opsvista_push_digest set due_at=now()-interval '1 minute'");
  const a=await store.claimPushDigests(), b=await store.claimPushDigests(); assert.equal(a.rows.length,1); assert.equal(b.rows.length,0);
  await store.finishPushDigest(a.rows[0],a.token,'retry');
  await pg.exec("update opsvista_push_digest set lease_until=null where status='pending'");
  providerFails=true; await flushPushDigests();
  const pending: any=(await pg.query("select status,accepted_at from opsvista_push_digest where event_key='retry'")).rows[0]; assert.equal(pending.status,'pending'); assert.equal(pending.accepted_at,null);
  providerFails=false; await pg.exec("update opsvista_push_digest set lease_until=null where status='pending'"); await flushPushDigests();
  assert.equal((await pg.query("select status from opsvista_push_digest where event_key='retry'")).rows[0].status,'accepted');
});
test.after(async () => { webpush.sendNotification=originalWeb;globalThis.fetch=originalFetch;await pg.close(); });
