const assert = require('node:assert/strict');
const test = require('node:test');
const ts = require('typescript');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const source = readFileSync(path.join(__dirname, '../src/presentation.ts'), 'utf8');
const moduleOutput = {exports: {}};
new Function('exports', 'module', ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText)(moduleOutput.exports, moduleOutput);
const {inLocation, isOpen, prioritize, summarize, money, number} = moduleOutput.exports;
const rows = [
  {location: 'A', netSales: 1000, totalLaborCost: 200, hourlyHours: 10, overtimeHours: 1},
  {location: 'B', netSales: 3000, totalLaborCost: 1200, hourlyHours: 25, overtimeHours: 2},
];
test('labor is weighted by sales, not averaged across locations', () => {
  assert.equal(summarize(rows).totalLaborPct, 35);
  assert.equal(summarize(inLocation(rows, 'A')).totalLaborPct, 20);
  assert.equal(summarize(rows).overtimeHours, 3);
});
test('missing data is distinct from genuine zero, including zero-sales labor', () => {
  assert.equal(summarize([]), null);
  assert.equal(summarize([{...rows[0], netSales: 0}]).totalLaborPct, null);
  assert.equal(money(undefined), '—'); assert.equal(money(NaN), '—');
  assert.equal(money(0), '$0'); assert.equal(number(null, '%'), '—');
});
test('location selection filters only supplied scope and does not invent locations', () => {
  assert.equal(inLocation(rows, '').length, 2);
  assert.equal(inLocation(rows, 'B')[0].netSales, 3000);
  assert.equal(inLocation(rows, 'Unknown').length, 0);
});
test('closed actions stay out of open list and severity wins without mutating input', () => {
  const actions = [{id:'low',severity:'Low',priorityScore:100,status:'Assigned'}, {id:'high',severity:'High',priorityScore:1,status:'Assigned'}, {id:'done',severity:'High',priorityScore:99,status:'Completed'}, {id:'dismissed',severity:'Medium',priorityScore:10,status:'Dismissed'}];
  assert.deepEqual(prioritize(actions.filter(isOpen)).map(a=>a.id), ['high','low']);
  assert.equal(actions[0].id, 'low');
});
