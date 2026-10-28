import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = await mkdtemp(join(tmpdir(), 'opsvista-salary-'));
try {
  await writeFile(join(output, 'package.json'), '{"type":"module"}\n');
  for (const name of ['shared/salaryTiming', 'server/salaryLabor', 'server/googleOperatingHours', 'server/verifiedGoogleHours', 'server/intradaySalary', 'server/salaryTiming.test']) {
    const fileName = join(root, `${name}.ts`);
    const compiled = ts.transpileModule(await readFile(fileName, 'utf8'), { fileName, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
    const target = join(output, `${name}.js`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, compiled.outputText);
  }
  process.exitCode = spawnSync(process.execPath, ['--test', join(output, 'server/salaryTiming.test.js')], { stdio: 'inherit' }).status ?? 1;
} finally { await rm(output, { recursive: true, force: true }); }
