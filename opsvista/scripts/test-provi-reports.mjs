import {mkdtemp,readFile,writeFile,mkdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';
const root=fileURLToPath(new URL('../',import.meta.url)), output=await mkdtemp(join(tmpdir(),'opsvista-provi-'));
try {
  await writeFile(join(output,'package.json'),'{"type":"module"}');
  await symlink(join(root,'node_modules'),join(output,'node_modules'),'dir');
  for(const name of ['shared/beverageMetrics','shared/proviReports','server/sourceCache','server/proviReports','server/proviReports.test']){
    const fileName=join(root,`${name}.ts`), target=join(output,`${name}.js`);
    const result=ts.transpileModule(await readFile(fileName,'utf8'),{fileName,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
    await mkdir(dirname(target),{recursive:true});await writeFile(target,result.outputText);
  }
  process.exitCode=spawnSync(process.execPath,['--experimental-test-module-mocks','--test',join(output,'server/proviReports.test.js')],{stdio:'inherit'}).status??1;
} finally {await rm(output,{recursive:true,force:true});}
