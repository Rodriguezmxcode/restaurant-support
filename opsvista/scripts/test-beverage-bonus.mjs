import { mkdtemp, readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = await mkdtemp(join(tmpdir(), 'opsvista-beverages-'));
try {
  await writeFile(join(output, 'package.json'), '{"type":"module"}\n');
  await symlink(join(root, 'node_modules'), join(output, 'node_modules'), 'dir');
  for (const name of ['shared/beverageMetrics', 'server/toastClient', 'server/toastBeverageSales', 'server/integrationStore', 'server/restaurant365OData', 'server/beverageMetrics.test']) {
    const fileName = join(root, `${name}.ts`);
    const compiled = ts.transpileModule(await readFile(fileName, 'utf8'), { fileName, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
    const target = join(output, `${name}.js`); await mkdir(dirname(target), { recursive: true }); await writeFile(target, compiled.outputText);
  }
  const result = spawnSync(process.execPath, ['--test', join(output, 'server/beverageMetrics.test.js')], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally { await rm(output, { recursive: true, force: true }); }
