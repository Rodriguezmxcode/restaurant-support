import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = await mkdtemp(join(tmpdir(), 'opsvista-native-tasks-'));
try {
  await writeFile(join(output, 'package.json'), '{"type":"module"}\n');
  for (const name of ['shared/nativeTasks', 'shared/tenantAccess', 'server/authorization', 'server/tenantAccess.test', 'server/nativeTaskService', 'server/nativeTaskService.test', 'src/actionAssignments', 'server/actionAssignments.test']) {
    const fileName = join(root, `${name}.ts`);
    const compiled = ts.transpileModule(await readFile(fileName, 'utf8'), { fileName, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
    await mkdir(dirname(join(output, name)), { recursive: true });
    await writeFile(join(output, `${name}.js`), compiled.outputText);
  }
  const result = spawnSync(process.execPath, ['--test', join(output, 'server/nativeTaskService.test.js'), join(output, 'server/actionAssignments.test.js'), join(output, 'server/tenantAccess.test.js')], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally { await rm(output, { recursive: true, force: true }); }
