import { mkdtemp, readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = await mkdtemp(join(tmpdir(), 'opsvista-copilot-'));
async function write(name, body) { const path = join(output, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, body); }
try {
  await write('package.json', '{"type":"module"}');
  for (const name of ['shared/tenantAccess', 'shared/copilotAgent', 'server/copilotPolicy', 'server/copilotEngine', 'server/copilotSources', 'server/copilotQuota', 'server/copilotEndpoint', 'server/copilotAgent.test', 'server/copilotProvider.test']) {
    const fileName = join(root, `${name}.ts`);
    const compiled = ts.transpileModule(await readFile(fileName, 'utf8'), { fileName, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
    await write(`${name}.js`, compiled.outputText);
  }
  // Only the external data adapters are fixtures. Policy, tool loop, source
  // projections, endpoint checks and actual quota SQL run unchanged.
  await write('api/operations/performance.js', `export default async function(req,res){
    if(req.headers.cookie!=='fixture-cookie'||req.query.locations!=='Avon'||req.query.salary_basis!=='elapsed')throw new Error('Invalid fixture scope');
    res.status(200).json({locations:[{location:'Avon',netSales:1000,hourlyLaborCost:100,salaryLaborCost:20,totalLaborCost:120,totalLaborPct:12,employeeLabor:[{name:'PRIVATE_EMPLOYEE'}]}],totals:{netSales:1000,totalLaborCost:120},salaryLaborConfigured:true,salaryTiming:{applied:true,rows:[{location:'Avon',accruedSalary:20,fullDaySalary:120}]},scheduleRisk:{people:['PRIVATE_EMPLOYEE']},notes:{salaryLabor:'Accrued through snapshot time'}});
  }`);
  await write('server/actionStore.js', 'export const listActions=async()=>[];');
  await write('api/restaurant365.js', `export default async function(req,res){
    if(req.headers.cookie!=='fixture-cookie'||req.query.view!=='ap'||req.query.start!=='2026-09-20'||req.query.end!=='2026-09-20')throw new Error('Invalid AP fixture request');
    res.status(200).json({period:{start:'2026-09-20',endExclusive:'2026-09-21'},fetchedAt:'2026-09-20T15:00:00Z',memory:{pending:true},totals:{approved:999,amount:999999},transactions:[
      {id:'1',entity:'Avon',date:'2026-09-20',number:'INV-1',vendor:'Vendor A',approved:true,amount:120,createdBy:'PRIVATE_EMPLOYEE'},
      {id:'2',entity:'Orange',date:'2026-09-20',number:'PRIVATE_INVOICE',approved:true,amount:999999},
      {id:'3',entity:'Corporate Office',date:'2026-09-20',number:'PRIVATE_OFFICE',approved:true,amount:999999}
    ]});
  }`);
  await write('server/rampComplianceEndpoint.js', 'export const getRampCompliancePayload=async()=>({transactions:[]});');
  await write('server/proviReports.js', 'export const getProviReports=async()=>[];');
  await write('server/googleBusinessProfile.js', 'export const getGoogleReviewSummaries=async()=>({locations:[]});export const googleBusinessProfileConfigured=async()=>false;');
  await write('server/reviewImportStore.js', 'export const getImportedReviewSummaries=async()=>({hasData:false});export const reviewImportConfigured=()=>false;');
  await symlink(join(root, 'node_modules/@electric-sql'), join(output, 'node_modules/@electric-sql')).catch(async () => { await mkdir(join(output, 'node_modules'), { recursive: true }); await symlink(join(root, 'node_modules/@electric-sql'), join(output, 'node_modules/@electric-sql')); });
  await write('node_modules/postgres/package.json', '{"type":"module","exports":"./index.js"}');
  await write('node_modules/postgres/index.js', `import {PGlite} from '@electric-sql/pglite';
    const database=new PGlite();
    function adapter(db){
      const sql=async(strings,...values)=>{const query=strings.reduce((text,part,i)=>text+(i?'$'+i:'')+part,'');return(await db.query(query,values)).rows;};
      sql.begin=fn=>db.transaction(tx=>fn(adapter(tx)));return sql;
    }
    export default function(){return adapter(database);}
    export const closeFixture=()=>database.close();`);
  await write('server/copilotAgent.test.js', (await readFile(join(output, 'server/copilotAgent.test.js'), 'utf8')) + `\nimport {after} from 'node:test'; import {closeFixture} from 'postgres'; after(closeFixture);\n`);
  process.exitCode = spawnSync(process.execPath, ['--test', join(output, 'server/copilotAgent.test.js'), join(output, 'server/copilotProvider.test.js')], { stdio: 'inherit', timeout: 30000 }).status ?? 1;
} finally { await rm(output, { recursive: true, force: true }); }
