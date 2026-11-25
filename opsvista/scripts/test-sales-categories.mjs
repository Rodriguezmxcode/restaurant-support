import { mkdtemp, readdir, readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = await mkdtemp(join(tmpdir(), 'opsvista-sales-categories-'));
try {
  await writeFile(join(output, 'package.json'), '{"type":"module"}\n');
  await symlink(join(root, 'node_modules'), join(output, 'node_modules'), 'dir');
  for (const folder of ['shared', 'server']) {
    await mkdir(join(output, folder), { recursive: true });
    for (const name of await readdir(join(root, folder))) {
      if (!name.endsWith('.ts')) continue;
      const fileName = join(root, folder, name);
      const compiled = ts.transpileModule(await readFile(fileName, 'utf8'), { fileName, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
      await writeFile(join(output, folder, name.replace(/\.ts$/, '.js')), compiled.outputText);
    }
  }
  const result = spawnSync(process.execPath, ['--test', join(output, 'server/salesCategories.test.js')], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally { await rm(output, { recursive: true, force: true }); }
