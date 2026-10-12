import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';

const temp = await mkdtemp(join(process.cwd(), 'node_modules/.sign-in-health-'));
const saved = { fetch: globalThis.fetch, error: console.error, db: process.env.OPSVISTA_DATABASE_URL, secret: process.env.OPSVISTA_SESSION_SECRET };
try {
  await writeFile(join(temp, 'package.json'), '{"type":"module"}');
  await writeFile(join(temp, 'config.js'), "export const SUPABASE_URL='https://identity.example.invalid';export const SUPABASE_PUBLISHABLE_KEY='public-test-key';");
  await writeFile(join(temp, 'db.js'), `export const queries=[];export let failure;export function fail(value){failure=value};export default function postgres(){return async(strings)=>{queries.push(strings.join('?'));if(failure)throw failure;return []}}`);
  const { queries, fail } = await import(join(temp, 'db.js'));
  const source = (await readFile(new URL('../server/signInHealth.ts', import.meta.url), 'utf8'))
    .replace("from 'postgres'", "from './db.js'")
    .replace("from '../shared/supabaseConfig.js'", "from './config.js'");
  await writeFile(join(temp, 'health.js'), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
  process.env.OPSVISTA_DATABASE_URL = 'postgres://private-test-secret';
  process.env.OPSVISTA_SESSION_SECRET = 'private-test-session-secret-at-least-32';
  const logs = [];
  console.error = (...args) => logs.push(args);
  let identityCalls = 0, identityOK = true;
  globalThis.fetch = async (url, options) => {
    identityCalls++;
    assert.equal(url, 'https://identity.example.invalid/auth/v1/health');
    assert.equal(options.headers.Authorization, undefined);
    assert.ok(options.signal);
    return { ok: identityOK };
  };
  const healthy = await import(join(temp, 'health.js') + '?healthy');
  const results = await Promise.all([healthy.signInHealth(), healthy.signInHealth(), healthy.signInHealth()]);
  assert.ok(results.every(result => result.ok));
  assert.equal(identityCalls, 1);
  assert.equal(queries.length, 2);
  assert.ok(queries.every(query => /^select /i.test(query) && /limit 0$/i.test(query)));
  assert.deepEqual(Object.keys(results[0]).sort(), ['checkedAt', 'ok']);
  fail(Object.assign(new Error('private-credential-never-log'), { code: '42P01' }));
  assert.equal((await (await import(join(temp, 'health.js') + '?db')).signInHealth()).ok, false);
  assert.deepEqual(logs.at(-1)[1], { stage: 'directory', reason: '42P01', category: 'dependency_failure' });
  fail(undefined); identityOK = false;
  assert.equal((await (await import(join(temp, 'health.js') + '?identity')).signInHealth()).ok, false);
  identityOK = true; delete process.env.OPSVISTA_SESSION_SECRET;
  assert.equal((await (await import(join(temp, 'health.js') + '?config')).signInHealth()).ok, false);
  assert.ok(!JSON.stringify(logs).includes('private-'));
  console.log('PASS sign-in readiness, concurrent probe caching, read-only dependency checks, failure detection, configuration checks and private diagnostics');
} finally {
  globalThis.fetch = saved.fetch; console.error = saved.error;
  for (const [key, value] of [['OPSVISTA_DATABASE_URL', saved.db], ['OPSVISTA_SESSION_SECRET', saved.secret]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await rm(temp, { recursive: true, force: true });
}
