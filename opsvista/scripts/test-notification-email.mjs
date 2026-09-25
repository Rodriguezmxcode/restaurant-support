import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = await mkdtemp(join(tmpdir(), 'opsvista-email-tests-'));
try {
  await writeFile(join(output, 'package.json'), '{"type":"module"}\n');
  for (const name of ['emailDelivery', 'emailDelivery.test']) {
    const fileName = join(root, 'server', `${name}.ts`);
    const source = await readFile(fileName, 'utf8');
    const compiled = ts.transpileModule(source, {
      fileName, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    });
    await writeFile(join(output, `${name}.js`), compiled.outputText);
  }
  const result = spawnSync(process.execPath, ['--test', join(output, 'emailDelivery.test.js')], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(output, { recursive: true, force: true });
}
