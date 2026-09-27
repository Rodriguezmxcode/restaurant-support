import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { alertClock, alertJobDue, overdueExpense, performanceWarnings, operationalWeekStart, type OperationalAlert } from '../shared/operationalAlerts.js';
import { validSyncClaims } from './sourceSyncAuth.js';

const pg = new PGlite();
const sql: any = async (parts: TemplateStringsArray, ...values: any[]) => {
  const query = parts.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, '');
  return (await pg.query(query, values.map(value => value?.__json !== undefined ? JSON.stringify(value.__json) : value))).rows;
};
sql.json = (value: unknown) => ({ __json: value });
mock.module('postgres', { defaultExport: () => sql });
process.env.OPSVISTA_DATABASE_URL = 'postgres://synthetic-only';
let sends = 0, transport = 'ok';
mock.module('./webPushStore.js', { namedExports: { sendWebPushToUsers: async () => { sends++; return transport === 'ok' ? { accepted: 1, devices: 1 } : transport === 'none' ? { accepted: 0, devices: 0 } : { accepted: 0, devices: 1 }; } } });
const store = await import('./operationalAlertStore.js');
const users: any[] = [
  { id: 'usr-founder-roberto', role: 'Founder', active: true, locations: [] },
  { id: 'manager', role: 'Location Manager', active: true, locations: ['Orange'], locationGrants: [{ location: 'ORANGE' }, { location: 'Avon', expiresAt: '2020-01-01' }] },
  { id: 'disabled', role: 'Location Manager', active: false, locations: ['Orange'] },
  { id: 'reputation', role: 'Online Reputation Manager', active: true, locations: [] },
];
mock.module('./managementStore.js', { namedExports: { listManagedUsers: async () => users } });
let sourceReads = 0, taskFails = false;
mock.module('./sevenShiftsClient.js', { namedExports: {
  weeklyTaskCompliance: async () => { sourceReads++; if (taskFails) throw new Error('source down'); return { locations: [{ locationName: 'Orange', total: 10, incomplete: 3 }] }; },
  listSevenShiftsLocations: async () => [{ id: 1, name: 'ORANGE' }],
  listSevenShiftsLogbook: async () => [],
} });
const runner = await import('./scheduledOperationalAlerts.js');
const alert = (key: string): OperationalAlert => ({ key, kind: 'tasks', location: 'Orange', title: 'Pending tasks', body: 'Three pending', module: 'Evidence Audit' });
const user = (id: string, org = store.alertOrganization): any => ({ id, organizationId: org });

test('Connecticut windows respect DST and Wednesday–Tuesday boundaries', () => {
  assert.equal(alertClock(new Date('2026-07-01T12:59:00Z')).hour, 8);
  assert.equal(alertJobDue('reviews', new Date('2026-07-01T12:59:00Z')), false);
  assert.equal(alertJobDue('reviews', new Date('2026-07-01T13:00:00Z')), true);
  assert.equal(alertJobDue('reviews', new Date('2026-12-01T13:59:00Z')), false);
  assert.equal(alertJobDue('tasks', new Date('2026-07-02T01:00:00Z')), true);
  assert.equal(alertJobDue('tasks', new Date('2026-07-02T03:00:00Z')), false);
  assert.equal(operationalWeekStart('2026-09-29'), '2026-09-23');
  assert.equal(operationalWeekStart('2026-09-30'), '2026-09-30');
});
test('threshold equality, minimum sales, missing labor and unconfigured targets do not produce false alerts', () => {
  const row = { netSales: 1000, bonusDiscountPct: 2, voidPct: .5 };
  assert.deepEqual(performanceWarnings(row, 21, 32), []);
  assert.deepEqual(performanceWarnings({ ...row, netSales: 999, voidPct: 99 }, 21, 90), []);
  assert.deepEqual(performanceWarnings(row, 21, null), []);
  assert.equal(performanceWarnings({ ...row, bonusDiscountPct: 2.01, voidPct: .51 }, 21, 32.01, 5000).length, 4);
  assert.equal(performanceWarnings(row, 17, null, 5000).length, 0);
});
test('expense 48-hour threshold uses exact timestamps and excludes pending charges and credits', () => {
  const now = new Date('2026-09-27T16:00:00Z');
  const row = { state: 'CLEARED', amount: 50, date: '2026-09-25', transactionTime: '2026-09-25T16:00:00Z', memo: '', receiptAttached: false };
  assert.equal(overdueExpense(row, now), true);
  assert.equal(overdueExpense({ ...row, transactionTime: '2026-09-25T16:00:01Z' }, now), false);
  assert.equal(overdueExpense({ ...row, transactionTime: undefined }, now), false);
  assert.equal(overdueExpense({ ...row, state: 'PENDING' }, now), false);
  assert.equal(overdueExpense({ ...row, amount: -50 }, now), false);
  assert.equal(overdueExpense({ ...row, memo: 'Supplies', receiptAttached: true }, now), false);
});
test('alert scheduler requires its own workflow and audience; source-sync identity cannot send alerts', () => {
  const now = Date.now() / 1000;
  const claims = { iss: 'https://token.actions.githubusercontent.com', aud: 'opsvista-operational-alerts', repository: 'Rodriguezmxcode/restaurant-support', repository_id: '1218432655', repository_owner_id: '278524509', ref: 'refs/heads/main', workflow_ref: 'Rodriguezmxcode/restaurant-support/.github/workflows/opsvista-operational-alerts.yml@refs/heads/main', event_name: 'schedule', sub: 'repo:Rodriguezmxcode/restaurant-support:ref:refs/heads/main', exp: now + 300, iat: now - 5, nbf: now - 5 };
  assert.equal(validSyncClaims(claims, now, 'alerts'), true);
  assert.equal(validSyncClaims(claims, now), false);
  for (const change of [{ event_name: 'pull_request' }, { ref: 'refs/heads/feature' }, { repository_id: 'fake' }, { exp: 0 }, { aud: 'opsvista-source-sync' }]) assert.equal(validSyncClaims({ ...claims, ...change }, now, 'alerts'), false);
});
test('routing checks active accounts, canonical locations, expired grants and reputation role', () => {
  assert.deepEqual(runner.scheduledRecipients(alert('routing'), users), ['usr-founder-roberto', 'manager']);
  assert.deepEqual(runner.scheduledRecipients({ ...alert('routing'), location: 'Avon' }, users), ['usr-founder-roberto']);
  assert.deepEqual(runner.scheduledRecipients({ ...alert('routing'), kind: 'reviews' }, users), ['usr-founder-roberto', 'manager', 'reputation']);
});
test('SQL leases serialize overlapping jobs and respect daily completion', async () => {
  const now = new Date('2026-09-27T15:00:00Z');
  const tokens = await Promise.all([store.claimAlertJob('race', now), store.claimAlertJob('race', now)]);
  assert.equal(tokens.filter(Boolean).length, 1);
  await store.finishAlertJob('race', tokens.find(Boolean)!, 'ok', 'checked', now);
  assert.equal(await store.claimAlertJob('race', new Date('2026-09-27T17:00:00Z'), '2026-09-27T06:00:00Z'), null);
  assert.ok(await store.claimAlertJob('race', new Date('2026-09-28T15:00:00Z'), '2026-09-28T06:00:00Z'));
});
test('per-recipient ledger deduplicates concurrent sends, retries transient errors, and stops at three attempts', async () => {
  sends = 0;
  await Promise.all([store.saveAndDeliverAlert(alert('race-event'), ['manager']), store.saveAndDeliverAlert(alert('race-event'), ['manager'])]);
  assert.equal(sends, 1);
  transport = 'fail';
  for (let i = 0; i < 4; i++) await store.saveAndDeliverAlert(alert('failed-event'), ['manager']);
  assert.equal(sends, 4);
  transport = 'none'; await store.saveAndDeliverAlert(alert('no-device'), ['manager']);
  transport = 'ok'; await store.saveAndDeliverAlert(alert('no-device'), ['manager']);
  assert.equal(sends, 5);
  transport = 'fail'; await store.saveAndDeliverAlert(alert('recover-event'), ['manager']);
  transport = 'ok'; await store.saveAndDeliverAlert(alert('recover-event'), ['manager']);
  assert.equal(sends, 7);
});
test('inbox never leaks other recipients, organizations or expired location access', async () => {
  assert.ok((await store.alertInbox(user('manager'), ['ORANGE'])).alerts.length > 0);
  assert.equal((await store.alertInbox(user('other'), null)).alerts.length, 0);
  assert.equal((await store.alertInbox(user('manager', 'org-other'), null)).alerts.length, 0);
  assert.equal((await store.alertInbox(user('manager'), ['Avon'])).alerts.length, 0);
});
test('quiet hours never load sources; verification loads data without creating or sending warnings', async () => {
  const now = new Date('2026-09-27T07:00:00Z'), before = sends;
  const quiet = await runner.runScheduledAlertJob('tasks', 'Orange', now);
  assert.equal(quiet.quiet, true); assert.equal(sourceReads, 0); assert.equal(sends, before);
  const verification = await runner.runScheduledAlertJob('tasks', 'Orange', now, true);
  assert.equal(verification.verified, true); assert.equal(sourceReads, 1); assert.equal(sends, before);
  assert.equal((await pg.query("select * from opsvista_alert_inbox where event_key like 'tasks:%'")).rows.length, 0);
});
test('source failures create no violation and a later run recovers', async () => {
  taskFails = true; const before = sends;
  assert.equal((await runner.runScheduledAlertJob('tasks', 'Orange', new Date('2026-09-28T01:00:00Z'))).ok, false);
  assert.equal(sends, before);
  taskFails = false;
  assert.equal((await runner.runScheduledAlertJob('tasks', 'Orange', new Date('2026-09-28T01:30:00Z'))).ok, true);
  assert.equal(sends, before + 2);
});
test('a failed push on a daily rule retries before tomorrow without duplicating successful recipients', async () => {
  transport = 'fail'; const before = sends;
  await runner.runScheduledAlertJob('logbook', undefined, new Date('2026-09-29T15:00:00Z'));
  assert.equal(sends, before + 2);
  transport = 'ok';
  await runner.runScheduledAlertJob('logbook', undefined, new Date('2026-09-29T15:30:00Z'));
  assert.equal(sends, before + 4);
  await runner.runScheduledAlertJob('logbook', undefined, new Date('2026-09-29T16:00:00Z'));
  assert.equal(sends, before + 4);
});
test('scheduled endpoint rejects browser cookies, invalid method and unsigned bearer tokens', async () => {
  const response = () => { const result: any = {}; result.status = (value: number) => { result.code = value; return result; }; result.json = (value: any) => { result.body = value; }; return result; };
  const get = response(); await runner.scheduledAlertsEndpoint({ method: 'GET' }, get); assert.equal(get.code, 405);
  const post = response(); await runner.scheduledAlertsEndpoint({ method: 'POST', headers: { authorization: 'Bearer unsigned', cookie: 'session' }, query: { job: 'tasks', location: 'Orange' } }, post); assert.equal(post.code, 401);
});
test.after(async () => { await pg.close(); });
