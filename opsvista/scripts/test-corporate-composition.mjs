import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root = fileURLToPath(new URL('../', import.meta.url));
const nativeRequire = createRequire(new URL('../package.json', import.meta.url));
const React = nativeRequire('react');
const { renderToStaticMarkup } = nativeRequire('react-dom/server');
let seed = {}, stateIndex = 0;
const cache = new Map();
function load(file) {
  if (file.endsWith('.css')) return {};
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const localRequire = specifier => {
    if (specifier === 'react') return { ...React, useState: initial => { const index = stateIndex++; return React.useState(Object.hasOwn(seed, index) ? seed[index] : initial); } };
    if (!specifier.startsWith('.')) return nativeRequire(specifier);
    let target = resolve(dirname(file), specifier);
    if (target.endsWith('.js')) target = target.slice(0, -3) + '.ts';
    else if (!/\.(tsx?|css)$/.test(target)) target += '.ts';
    return load(target);
  };
  new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
  return module.exports;
}
const { corporateExpenseComposition, summarizeCorporateRows } = load(resolve(root, 'shared/corporateImports.ts'));
const { default: Panel, CorporateExpenseComposition: Chart } = load(resolve(root, 'src/CorporateImportPanel.tsx'));
const row = (key, section, amount, more = {}) => ({ key, date: '2026-08-15', description: key, amount, section, category: key, includeInPnl: true, sourceFile: 'corporate.xlsx', sourceSheet: 'Detalle', sourceRow: 1, confidence: 'manual', ...more });
const rows = [
  row('salary', 'Labor', 100), row('payroll-tax', 'Labor', 20), row('software', 'Operating Expenses', 30),
  row('rent', 'Occupancy', 40), row('other', 'Other Expense', 5), row('food', 'COGS', 10),
  row('credit', 'Operating Expenses', -3),
  row('transfer', 'Balance Sheet', 1000, { includeInPnl: false }),
  row('budget', 'Review', 800, { includeInPnl: false }),
  row('excluded', 'Operating Expenses', 200, { includeInPnl: false }),
  row('previous', 'Labor', 999, { date: '2026-07-31' }),
  row('next', 'Labor', 999, { date: '2026-09-01' }),
];
const composition = corporateExpenseComposition(rows, '2026-08-01', '2026-08-31');
assert.equal(composition.summary.total, 202);
assert.equal(composition.summary.excluded, 2000);
assert.equal(composition.summary.reviewCount, 1);
assert.equal(composition.groups.find(g => g.section === 'Labor').amount, 120);
assert.equal(composition.groups.find(g => g.section === 'Operating Expenses').amount, 27);
assert.equal(composition.groups.find(g => g.section === 'Occupancy').amount, 40);
assert.equal(composition.groups.reduce((sum, g) => sum + g.amount, 0), composition.summary.total);
assert.equal(composition.groups.find(g => g.section === 'Labor').categoryCount, 2);
assert.equal(corporateExpenseComposition(rows, '2026-08-16', '2026-08-31').summary.rowCount, 0);
const html = renderToStaticMarkup(React.createElement(Chart, { composition, start: '2026-08-01', end: '2026-08-31' }));
assert.match(html, /Excel guardado en OpsVista/);
assert.match(html, /\$120\.00/); assert.match(html, /\$40\.00/); assert.match(html, /\$202\.00/);
assert.match(html, /1 movimientos por revisar/); assert.doesNotMatch(html, /\$999\.00|tipos GL de R365/);
const empty = renderToStaticMarkup(React.createElement(Chart, { composition: corporateExpenseComposition(rows, '2026-10-01', '2026-10-31'), start: '2026-10-01', end: '2026-10-31' }));
assert.match(empty, /No hay filas guardadas/); assert.doesNotMatch(empty, /\$0\.00/);
const data = { rows, summary: summarizeCorporateRows(rows), canImport: true, updatedAt: '2026-09-21T08:00:00Z' };
function panel(values, allowImport = true, start = '2026-08-01', end = '2026-08-31') {
  seed = { 0: data, 3: false, ...values }; stateIndex = 0;
  return renderToStaticMarkup(React.createElement(Panel, { start, end, allowImport, onSelectMonth() {} }));
}
const saved = panel({}); assert.match(saved, /Composición de gastos corporativos/); assert.match(saved, /\$202\.00/);
const preview = panel({ 1: [row('unsaved', 'Labor', 8888)] });
const chartOnly = preview.slice(preview.indexOf('aria-label="Composición de gastos corporativos del Excel guardado"')).split('</section>')[0];
assert.match(chartOnly, /\$202\.00/); assert.doesNotMatch(chartOnly, /8,888/); assert.match(preview, /Vista previa sin guardar/);
assert.doesNotMatch(panel({}, false), /type="file"|Guardar P&amp;L en OpsVista/);
assert.doesNotMatch(panel({ 0: { ...data, canImport: false } }), /type="file"/);
assert.doesNotMatch(panel({}, true, '2026-10-01', '2026-10-31'), /\$0\.00/);
console.log('Corporate composition checks passed: saved Excel totals, five groups, credits, exclusions, exact periods, category counts, missing-period state, unsaved preview isolation and import permissions.');
