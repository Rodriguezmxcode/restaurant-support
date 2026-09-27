// Operator-only, read-only diagnostic. No HTTP route, sessions, or public output.
// Production execution is opt-in. Every result (including errors) is encrypted
// to the operator's public key before it is made available as a temporary encrypted artifact.
import { mkdtemp,readFile,writeFile,mkdir,rm,symlink } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, publicEncrypt, createCipheriv } from 'node:crypto';
import ts from 'typescript';

if(process.env.VERCEL_ENV!=='production'){console.log('Private labor audit skipped outside production.');process.exit(0);}
const config=JSON.parse(await readFile(new URL('./toast-audit-once.json',import.meta.url),'utf8'));
if(Date.now()>Date.parse(config.expiresAt)){console.log('Private labor audit window expired.');process.exit(0);}
const root=fileURLToPath(new URL('../',import.meta.url));
const output=await mkdtemp(join(tmpdir(),'opsvista-private-audit-'));
const visited=new Set();
async function compile(path){
  if(visited.has(path))return;visited.add(path);
  const source=await readFile(join(root,path),'utf8');
  const target=join(output,path.replace(/\.ts$/,'.js'));
  await mkdir(dirname(target),{recursive:true});
  await writeFile(target,ts.transpileModule(source,{fileName:path,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
  for(const match of source.matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+\.js)['"]/g)){
    const dependency=join(dirname(path),match[1]).replace(/\.js$/,'.ts');await compile(dependency);
  }
}
function emit(value){
  const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  const envelope=Buffer.from(JSON.stringify({key:publicEncrypt(config.publicKey,key).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')})).toString('base64');
  writeFileSync(join(root,'public/opsvista-private-audit.txt'),envelope);
  console.log('Private labor audit encrypted artifact ready.');
}
const timer=setTimeout(()=>{emit({error:'Audit exceeded 90 seconds'});process.exit(0);},90_000);
try{
  await writeFile(join(output,'package.json'),'{"type":"module"}');
  await symlink(join(root,'node_modules'),join(output,'node_modules'),'dir');
  await compile('server/toastPerformance.ts');await compile('server/sevenShiftsClient.ts');
  const {getToastEmployeeLabor}=await import(pathToFileURL(join(output,'server/toastPerformance.js')));
  const {analyticsToastConfigured,standardToastConfigured}=await import(pathToFileURL(join(output,'server/toastClient.js')));
  const {applyToastLaborToScheduleRisk,getSevenShiftsScheduleRisk,toastOnlyScheduleRisk}=await import(pathToFileURL(join(output,'server/sevenShiftsClient.js')));
  const [rows,schedule]=await Promise.all([
    getToastEmployeeLabor(config.start,config.end,config.locations),
    getSevenShiftsScheduleRisk(config.start,config.end,config.locations,config.end).catch(()=>null)
  ]);
  const result=applyToastLaborToScheduleRisk(schedule??toastOnlyScheduleRisk(config.start,config.end,config.locations),rows);
  emit({start:config.start,end:config.end,generatedAt:result.generatedAt,standardConfigured:standardToastConfigured(),analyticsConfigured:analyticsToastConfigured(),scheduleAvailable:Boolean(schedule),hours:result.actualOvertimeHours,cost:result.workedOvertimeCost,costSource:result.workedOvertimeCostSource,reportStatuses:result.laborReportStatuses,locations:result.locations,employees:rows.filter(row=>row.overtimeHours>0).map(({employeeGuid,employeeName,location,regularHours,overtimeHours,totalHours,hourlyWage,overtimeLaborCost,overtimeCostComplete,overtimeCostSource,employmentType,laborReportStatus})=>({employeeGuid,employeeName,location,regularHours,overtimeHours,totalHours,hourlyWage,overtimeLaborCost,overtimeCostComplete,overtimeCostSource,employmentType,laborReportStatus})),unclassified:result.employees.filter(row=>row.employmentType==='unknown').map(row=>({employeeName:row.employeeName,location:row.primaryLocation,workedHours:row.workedHours,ot:row.unclassifiedOvertimeHours}))});
}catch(error){emit({error:error instanceof Error?error.message:'Private audit failed'});}
finally{clearTimeout(timer);await rm(output,{recursive:true,force:true});}
