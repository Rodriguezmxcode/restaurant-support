import { mkdtemp, readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = await mkdtemp(join(tmpdir(), 'opsvista-finance-'));
async function write(name, body) { const path = join(output, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, body); }
try {
  await write('package.json', '{"type":"module"}');
  for (const name of ['shared/tenantAccess', 'shared/finance', 'src/accessControl', 'server/financeStore', 'server/financeEndpoint', 'server/finance.test']) {
    const fileName = join(root, `${name}.ts`);
    await write(`${name}.js`, ts.transpileModule(await readFile(fileName, 'utf8'), { fileName, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
  }
  await mkdir(join(output, 'node_modules'), { recursive: true });
  await symlink(join(root, 'node_modules/@electric-sql'), join(output, 'node_modules/@electric-sql'));
  for (const name of ['react', 'react-dom', 'scheduler']) await symlink(join(root, 'node_modules', name), join(output, 'node_modules', name));
  for (const name of ['i18n', 'FinanceView']) {
    const fileName = join(root, `src/${name}.tsx`);
    const source = (await readFile(fileName, 'utf8')).replace("import './FinanceView.css';", '').replace("from './i18n'", "from './i18n.js'").replace("from '../shared/finance'", "from '../shared/finance.js'");
    await write(`src/${name}.js`, ts.transpileModule(source, { fileName, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText);
  }
  await write('finance-render.test.mjs', `import test from 'node:test';import assert from 'node:assert/strict';import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {I18nProvider} from './src/i18n.js';import {FinanceReport} from './src/FinanceView.js';
    const fixture={location:'Avon',month:'2026-09',sales:1000,cogs:250,labor:300,operatingExpenses:350,operatingResult:100,extraordinary:null,rampIncluded:null,payrollBasis:'Test basis',notes:['<script>unsafe</script>'],source:{file:'fixture.xlsx',references:{sales:'Sheet!B1'}},bank:null};
    const render=records=>renderToStaticMarkup(createElement(I18nProvider,null,createElement(FinanceReport,{records})));
    test('Finance renders truthful empty, partial and provisional report states with escaped notes',()=>{
      const empty=render([]);assert.match(empty,/No reports imported yet/);assert.doesNotMatch(empty,/\\$0\\.00/);
      const html=render([fixture]);assert.match(html,/Partial total/);assert.match(html,/30/);assert.match(html,/Historical bank closing balances/);assert.match(html,/Not disclosed/);assert.match(html,/No report for this period/);assert.match(html,/&lt;script&gt;unsafe/);assert.doesNotMatch(html,/<script>unsafe/);assert.match(html,/\\$100\\.00/);
    });`);
  await write('node_modules/postgres/package.json', '{"type":"module","exports":"./index.js"}');
  await write('node_modules/postgres/index.js', `import {PGlite} from '@electric-sql/pglite';
    const database=new PGlite();
    function adapter(db){const sql=async(strings,...values)=>{const query=strings.reduce((text,part,i)=>text+(i?'$'+i:'')+part,'');return(await db.query(query,values)).rows;};sql.begin=fn=>db.transaction(tx=>fn(adapter(tx)));return sql;}
    export default function(){return adapter(database);}
    export const fixtureQuery=(query,values)=>database.query(query,values);
    export const closeFixture=()=>database.close();`);
  await write('server/finance.test.js', (await readFile(join(output, 'server/finance.test.js'), 'utf8')) + `\nimport {after} from 'node:test';import {closeFixture} from 'postgres';after(closeFixture);\n`);
  process.exitCode = spawnSync(process.execPath, ['--test', join(output, 'server/finance.test.js'), join(output, 'finance-render.test.mjs')], { stdio: 'inherit', timeout: 30000 }).status ?? 1;
  // Optional local-only source validation. The private artifact is never copied
  // into the repository, test output, or build assets.
  if (process.env.FINANCE_REVIEW_FILE && !process.exitCode) {
    const { parseFinanceImport } = await import(join(output, 'shared/finance.js'));
    const batch = parseFinanceImport(JSON.parse(await readFile(process.env.FINANCE_REVIEW_FILE, 'utf8')));
    console.log(`Private review file: ${batch.records.length} reports validated against the production import schema.`);
  }
} finally { await rm(output, { recursive: true, force: true }); }
