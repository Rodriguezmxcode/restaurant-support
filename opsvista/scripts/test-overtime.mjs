import { mkdtemp,readFile,writeFile,mkdir,rm,symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=await mkdtemp(join(tmpdir(),'opsvista-overtime-'));
const visited=new Set();
async function compile(path){
  if(visited.has(path))return;visited.add(path);
  const source=await readFile(join(root,path),'utf8');
  const compiled=ts.transpileModule(source,{fileName:path,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
  const target=join(output,path.replace(/\.ts$/,'.js'));await mkdir(dirname(target),{recursive:true});await writeFile(target,compiled.outputText);
  for(const match of source.matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+\.js)['"]/g)){
    const dependency=resolve(dirname(join(root,path)),match[1]).slice(root.length).replace(/\.js$/,'.ts');await compile(dependency);
  }
}
try{
  await writeFile(join(output,'package.json'),'{"type":"module"}\n');await symlink(join(root,'node_modules'),join(output,'node_modules'),'dir');
  await compile('server/overtimeReconciliation.test.ts');
  await compile('api/operations/performance.ts');
  process.exitCode=spawnSync(process.execPath,['--test',join(output,'server/overtimeReconciliation.test.js')],{stdio:'inherit'}).status??1;
}finally{await rm(output,{recursive:true,force:true});}
