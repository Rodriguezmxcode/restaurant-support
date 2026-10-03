import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = await mkdtemp(join(root, 'node_modules/.overview-tasks-'));
try {
  await writeFile(join(output, 'package.json'), '{"type":"module"}\n');
  for (const [name, extension] of [['i18n', 'tsx'], ['overviewTaskCompliance', 'ts'], ['OverviewExplorer', 'tsx'], ['OverviewCharts', 'tsx']]) {
    const fileName = join(root, `src/${name}.${extension}`);
    const source = (await readFile(fileName, 'utf8')).replace(/^import ['"].*\.css['"];?\s*$/gm, '');
    const compiled = ts.transpileModule(source, { fileName, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
      .replace(/from '(\.\/[^']+)'/g, (_, path) => `from '${path.endsWith('.js') ? path : `${path}.js`}'`);
    const target = join(output, `${name}.js`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, compiled);
  }
  const load = name => import(pathToFileURL(join(output, `${name}.js`)).href);
  const [{ I18nProvider }, { default: OverviewCharts }, { overviewMetricRows }, { findOverviewTaskCompliance }] = await Promise.all(['i18n', 'OverviewCharts', 'OverviewExplorer', 'overviewTaskCompliance'].map(load));
  // Regression: the Sept 26 screenshot's aggregate included ORANGE's 433/433,
  // but the Toast-named Orange ring and task breakdown could not find it.
  const records = [['Stamford', 444, 444], ['ORANGE', 433, 433], ['Danbury', 373, 373], ['Fairfield', 413, 413], ['Avon', 344, 359], ['Southington', 311, 339]];
  const locations = records.map(([location, completed, total]) => ({ location, completed, total, compliancePct: completed / total * 100 }));
  const tasks = { source: 'Regression fixture', locations, totals: { completed: 2318, total: 2361, compliancePct: 2318 / 2361 * 100 } };
  const values = { netSales: 10000, discountAmount: 100, discountPct: 1, voidAmount: 20, voidPct: .2, hourlyHours: 100, overtimeHours: 0, hourlyLaborCost: 2000, salaryLaborCost: 500, totalLaborCost: 2500, laborPct: 20, hourlyLaborPct: 20, salaryLaborPct: 5, totalLaborPct: 25, splh: 100 };
  const rows = locations.map(row => ({ ...values, location: row.location === 'ORANGE' ? 'Orange' : row.location }));
  const render = data => renderToStaticMarkup(createElement(I18nProvider, null, createElement(OverviewCharts, { rows, totals: values, tasks: data, salaryConfigured: true, onExplore: () => {} })));
  const markup = render(tasks);
  assert.match(markup, /Orange: 100\.0%\. View tasks/);
  assert.match(markup, /433\/433/);
  assert.match(markup, /98\.2%/);
  const orange = overviewMetricRows('tasks', rows, tasks, true).find(row => row.location === 'Orange');
  assert.equal(orange.value, 100);
  assert.match(orange.detail, /433 de 433/);
  assert.equal(orange.attention, false);
  assert.equal(findOverviewTaskCompliance(tasks, ' orange ').completed, 433);
  assert.equal(findOverviewTaskCompliance(tasks, 'Orange Annex'), undefined);
  assert.equal(findOverviewTaskCompliance(tasks, ''), undefined);
  assert.equal(findOverviewTaskCompliance(null, 'Orange'), undefined);
  const incomplete = { ...tasks, locations: locations.map(row => row.location === 'ORANGE' ? { ...row, completed: 300, compliancePct: 300 / 433 * 100 } : row) };
  const incompleteMarkup = render(incomplete);
  assert.match(incompleteMarkup, /Orange: 69\.3%\. View tasks/);
  assert.match(incompleteMarkup, /Tasks 69\.3%/);
  assert.equal(overviewMetricRows('tasks', rows, incomplete, true).find(row => row.location === 'Orange').attention, true);
  const missing = { ...tasks, locations: locations.filter(row => row.location !== 'ORANGE') };
  assert.match(render(missing), /Orange: No task data for this location/);
  assert.equal(overviewMetricRows('tasks', rows, missing, true).find(row => row.location === 'Orange').value, null);
  const empty = { ...tasks, locations: locations.map(row => row.location === 'ORANGE' ? { ...row, completed: 0, total: 0, compliancePct: 0 } : row) };
  assert.match(render(empty), /Orange: No tasks recorded/);
  assert.equal(overviewMetricRows('tasks', rows, empty, true).find(row => row.location === 'Orange').value, null);
  console.log('PASS: Orange/ORANGE ring and breakdown, source counts, review flag, exact location scope, missing vs zero tasks.');
} finally {
  await rm(output, { recursive: true, force: true });
}
