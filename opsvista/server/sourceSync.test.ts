import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { validSyncClaims, authorizedSourceSync } from './sourceSyncAuth.js';
import { generateKeyPairSync, sign } from 'node:crypto';

// Execute the production SQL against real PostgreSQL (WASM); no production
// database, credentials or business records are used by these tests.
const pg = new PGlite();
const sql: any = async (parts: TemplateStringsArray, ...values: any[]) => {
  const query = parts.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, '');
  return (await pg.query(query, values.map(value => value?.__json !== undefined ? JSON.stringify(value.__json) : value))).rows;
};
sql.json = (value: unknown) => ({__json:value});
mock.module('postgres',{defaultExport:()=>sql});
process.env.OPSVISTA_DATABASE_URL='postgres://synthetic-test';
const cache = await import('./sourceCache.js');

test('browser reload reads durable data without calling R365 again; organizations remain isolated', async()=>{
  let reads=0;
  const load=async()=>({invoices:[{id:'synthetic-1',amount:100}],read:++reads});
  const first=await cache.cachedSource('org-a','r365-ap',{start:'2026-08'},load);
  const reload=await cache.cachedSource('org-a','r365-ap',{start:'2026-08'},load);
  assert.equal(reads,1); assert.deepEqual(first.data,reload.data); assert.equal(reload.memory.stored,true);
  await cache.cachedSource('org-b','r365-ap',{start:'2026-08'},load);
  assert.equal(reads,2);
});
test('failed refresh retains previous invoices and reports pending status, then retries successfully', async()=>{
  const initial=await cache.cachedSource('org-failure','r365-ap',{start:'2026-08'},async()=>({total:120}));
  const failed=await cache.cachedSource('org-failure','r365-ap',{start:'2026-08'},async()=>{throw new Error('R365 unavailable');},true);
  assert.deepEqual(failed.data,initial.data); assert.equal(failed.memory.pending,true); assert.equal(failed.memory.error,'R365 unavailable');
  const recovered=await cache.cachedSource('org-failure','r365-ap',{start:'2026-08'},async()=>({total:150}),true);
  assert.equal(recovered.data?.total,150); assert.equal(recovered.memory.pending,false);
});
test('existing snapshots migrate without downloading invoices on the first visit', async()=>{
  let reads=0;
  const result=await cache.cachedSource('org-legacy','r365-ap',{start:'2026-07'},async()=>{reads++;return {total:999};},false,
    async()=>({payload:{total:123},updatedAt:'2026-07-31T12:00:00Z'}));
  assert.equal(reads,0); assert.equal(result.data?.total,123); assert.equal(result.memory.pending,true);
});
test('overlapping refreshes cannot double process; changes during a refresh remain due', async()=>{
  const registered=await cache.registerSource('org-race','r365-ap',{start:'2026-08'});
  const first=await cache.claimSource('org-race',registered.key);
  assert.ok(first); assert.equal(await cache.claimSource('org-race',registered.key),null);
  await cache.dirtyR365Sources('org-race');
  const result=await cache.finishSource(first,{total:100},'2020-01-01T00:00:00Z');
  assert.equal(result.due,true);
  assert.equal((await cache.sourceQueueStatus('org-race')).remaining,1);
});
test('nightly cadence is 24 hours and remains overnight in Connecticut in winter and summer',()=>{
  assert.equal(cache.nextNight(new Date('2026-07-01T08:00:00Z')),'2026-07-02T07:30:00.000Z');
  assert.equal(cache.nextNight(new Date('2026-12-01T06:00:00Z')),'2026-12-01T07:30:00.000Z');
});

const claims=()=>({iss:'https://token.actions.githubusercontent.com',aud:'opsvista-source-sync',
  repository:'Rodriguezmxcode/restaurant-support',repository_id:'1218432655',repository_owner_id:'278524509',
  ref:'refs/heads/main',workflow_ref:'Rodriguezmxcode/restaurant-support/.github/workflows/opsvista-source-sync.yml@refs/heads/main',
  event_name:'schedule',sub:'repo:Rodriguezmxcode/restaurant-support:ref:refs/heads/main',
  exp:Date.now()/1000+300,iat:Date.now()/1000-5,nbf:Date.now()/1000-5});
test('scheduler rejects pull requests, forks, other workflows, expired and malformed tokens',async()=>{
  assert.equal(validSyncClaims(claims()),true);
  for(const change of [{event_name:'pull_request'},{repository_id:'fake'},{ref:'refs/heads/feature'},{workflow_ref:'another'},{aud:'other'},{sub:'other'},{exp:0}])assert.equal(validSyncClaims({...claims(),...change}),false);
  assert.equal(await authorizedSourceSync('Bearer unsigned'),false);
});
test('scheduler verifies the signature against the pinned GitHub key endpoint',async()=>{
  const original=globalThis.fetch;
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...publicKey.export({format:'jwk'}),kid:'synthetic-test-key'};
  globalThis.fetch=async(input)=>{assert.equal(String(input),'https://token.actions.githubusercontent.com/.well-known/jwks');return new Response(JSON.stringify({keys:[jwk]}));};
  try {
    const head=Buffer.from(JSON.stringify({alg:'RS256',kid:jwk.kid})).toString('base64url');
    const body=Buffer.from(JSON.stringify(claims())).toString('base64url');
    const signature=sign('RSA-SHA256',Buffer.from(`${head}.${body}`),privateKey).toString('base64url');
    assert.equal(await authorizedSourceSync(`Bearer ${head}.${body}.${signature}`),true);
    assert.equal(await authorizedSourceSync(`Bearer ${head}.${body}.${Buffer.alloc(256).toString('base64url')}`),false);
  } finally {globalThis.fetch=original;}
});
test.after(async()=>{await pg.close();});
