import { mkdtemp, readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = await mkdtemp(join(tmpdir(), 'opsvista-partner-'));
async function write(name, body) { const path = join(output, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, body); }
try {
  await write('package.json', '{"type":"module"}');
  for (const name of ['shared/tenantAccess', 'shared/partnerApi', 'server/partnerApiStore', 'server/pvInvoiceStore', 'server/pvInvoiceEndpoint', 'server/partnerApi', 'server/partnerApi.test', 'server/pvInvoice.test']) {
    const fileName = join(root, `${name}.ts`);
    await write(`${name}.js`, ts.transpileModule(await readFile(fileName, 'utf8'), { fileName, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
  }
  // External source loading is replaced; key storage and quota SQL run unchanged.
  await write('server/sourceCache.js', 'export const cachedSource=async()=>{throw new Error("External source must be injected")};');
  await write('server/sourceLoaders.js', 'export const loadSource=async()=>{throw new Error("No live R365 in tests")};');
  await write('server/integrationStore.js', 'export const getIntegrationSnapshot=async()=>null;');
  await mkdir(join(output, 'node_modules'), { recursive: true });
  await symlink(join(root, 'node_modules/@electric-sql'), join(output, 'node_modules/@electric-sql'));
  await write('node_modules/postgres/package.json', '{"type":"module","exports":"./index.js"}');
  await write('node_modules/postgres/index.js', `import {PGlite} from '@electric-sql/pglite';
    const database=new PGlite();
    function adapter(db){const sql=async(strings,...values)=>{const q=strings.reduce((text,part,i)=>text+(i?'$'+i:'')+part,'');return(await db.query(q,values)).rows;};sql.begin=fn=>db.transaction(tx=>fn(adapter(tx)));return sql;}
    export default function(){return adapter(database);}
    export const fixtureQuery=(q,values)=>database.query(q,values);
    export const closeFixture=()=>database.close();`);
  await write('server/partnerApi.test.js', (await readFile(join(output, 'server/partnerApi.test.js'), 'utf8')) + `\nimport {after} from 'node:test';import {closeFixture} from 'postgres';after(closeFixture);\n`);
  await write('server/pvInvoice.test.js', (await readFile(join(output, 'server/pvInvoice.test.js'), 'utf8')) + `\nimport {after} from 'node:test';import {closeFixture} from 'postgres';after(closeFixture);\n`);
  process.exitCode = spawnSync(process.execPath, ['--test', join(output, 'server/partnerApi.test.js'), join(output, 'server/pvInvoice.test.js')], { stdio: 'inherit', timeout: 30000 }).status ?? 1;
} finally { await rm(output, { recursive: true, force: true }); }
