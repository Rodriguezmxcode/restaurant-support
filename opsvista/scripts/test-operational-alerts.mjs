import { mkdtemp, readFile, writeFile, mkdir, rm, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
const root = fileURLToPath(new URL('../', import.meta.url)), output = await mkdtemp(join(tmpdir(), 'opsvista-alerts-'));
try {
  await writeFile(join(output, 'package.json'), '{"type":"module"}');
  await symlink(join(root, 'node_modules'), join(output, 'node_modules'), 'dir');
  const files = ['src/bonusEngine.ts'];
  for (const directory of ['server', 'shared']) for (const file of await readdir(join(root, directory))) if (file.endsWith('.ts')) files.push(`${directory}/${file}`);
  for (const file of files) {
    const target = join(output, file.replace(/\.ts$/, '.js'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, ts.transpileModule(await readFile(join(root, file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
  }
  process.exitCode = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--test', join(output, 'server/operationalAlerts.test.js')], { stdio: 'inherit' }).status ?? 1;
} finally { await rm(output, { recursive: true, force: true }); }
