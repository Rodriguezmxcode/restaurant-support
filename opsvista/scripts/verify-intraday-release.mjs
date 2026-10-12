// Offline release checks: the real handler and component with fixture-only
// sessions and upstream responses. This never signs in or calls live services.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const nativeRequire = createRequire(new URL('../package.json', import.meta.url));
const { renderToStaticMarkup } = nativeRequire('react-dom/server');
const { createElement } = nativeRequire('react');
let state;
const schedule = { timeZone: 'America/New_York', source: 'Google Business Profile API', week: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [String(day), { open: '11:00', close: '23:00' }])) };
const toastRow = { location: 'Avon', netSales: 1200, discountAmount: 0, bonusDiscountAmount: 0, uberEatsDiscountAmount: 0, employeeMealDiscountAmount: 0, voidAmount: 0, hourlyHours: 12, overtimeHours: 0, regularLaborCost: 240, overtimeLaborCost: 0, hourlyLaborCost: 240, employeeLabor: [] };
function reset() {
  state = { now: '2026-09-21T17:00:00Z', user: { role: 'Corporate', organizationId: 'org-puerto-vallarta', locations: ['Avon'] }, rows: [{ ...toastRow }], schedules: { Avon: schedule }, toastCalls: 0, hoursCalls: 0, hoursFail: false, toastFail: false };
}
class FixtureDate extends Date {
  constructor(...args) { super(...(args.length ? args : [state.now])); }
  static now() { return Date.parse(state.now); }
}
const fixtures = {
  'server/authSession': { readSession: () => state.user },
  'server/googleBusinessProfile': { getGoogleOperatingSchedules: async () => { state.hoursCalls++; if (state.hoursFail) throw new Error('Fixture Google unavailable'); return state.schedules; } },
  'server/toastPerformance': {
    getToastPerformance: async () => { state.toastCalls++; if (state.toastFail) throw new Error('Fixture Toast unavailable'); return state.rows; },
    getToastEmployeeLabor: async () => [],
  },
  'server/sevenShiftsClient': {
    getSevenShiftsScheduleRisk: async () => null,
    applyToastLaborToScheduleRisk: data => data,
    weeklyTaskCompliance: async () => ({ locations: [], completed: 0, total: 0, completionPct: 0 }),
  },
};
const cache = new Map();
function load(file) {
  const key = file.slice(root.length).replace(/\.(tsx?|js)$/, '');
  if (fixtures[key]) return fixtures[key];
  if (file.endsWith('.css')) return {};
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const localRequire = specifier => {
    if (!specifier.startsWith('.')) return nativeRequire(specifier);
    let target = resolve(dirname(file), specifier);
    if (target.endsWith('.js')) target = target.slice(0, -3) + '.ts';
    else if (!/\.(tsx?|css)$/.test(target)) target += '.ts';
    return load(target);
  };
  new Function('require', 'module', 'exports', 'Date', 'process', compiled)(localRequire, module, module.exports, FixtureDate, { env: { OPSVISTA_WEEKLY_SALARY_LABOR_JSON: '{"Avon":4200}' } });
  return module.exports;
}
reset();
const handler = load(resolve(root, 'api/operations/performance.ts')).default;
const Panel = load(resolve(root, 'src/SalaryTimingPanel.tsx')).default;
async function request(query = {}, method = 'GET') {
  const response = { code: 0, body: null, headers: {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; }, setHeader(name, value) { this.headers[name] = value; } };
  await handler({ method, query: { start: '2026-09-21', end: '2026-09-21', salary_basis: 'elapsed', include_tasks: 'false', ...query }, headers: {} }, response);
  return response;
}
async function check(name, run) { reset(); await run(); console.log(`PASS ${name}`); }

await check('unauthenticated requests remain blocked before upstream calls', async () => {
  state.user = null;
  assert.equal((await request()).code, 401);
  assert.equal(state.toastCalls, 0);
});
await check('tenant and location restrictions remain enforced', async () => {
  state.user.organizationId = 'other-organization';
  assert.equal((await request()).code, 403);
  state.user = { role: 'Manager', organizationId: 'org-puerto-vallarta', locations: ['Avon'] };
  assert.equal((await request({ locations: 'Orange' })).code, 403);
  assert.equal(state.toastCalls, 0);
});
await check('current-day API and both language renderings agree on accrued/full salary', async () => {
  const response = await request();
  assert.equal(response.code, 200);
  const data = response.body;
  assert.equal(data.salaryTiming.applied, true);
  assert.equal(data.totals.salaryLaborCost, 100);
  assert.equal(data.totals.totalLaborCost, 340);
  assert.equal(data.totals.totalLaborPct, 28.33);
  assert.equal(data.salaryTiming.rows[0].fullDaySalary, 600);
  for (const language of ['es', 'en']) {
    const html = renderToStaticMarkup(createElement(Panel, { data: data.salaryTiming, language, onRefresh() {} }));
    for (const text of ['$100.00', '$600.00', '$340.00', '28.33%', '$500.00', '16.7%']) assert.ok(html.includes(text), `Missing ${text} in ${language}`);
    assert.ok(html.includes('<progress'));
    assert.ok(html.includes(language === 'es' ? 'Salario acumulado' : 'Salary accrued'));
  }
});
await check('default, historical and multiday views keep full payroll allocation', async () => {
  assert.equal((await request({ salary_basis: '' })).body.totals.salaryLaborCost, 600);
  const yesterday = (await request({ start: '2026-09-20', end: '2026-09-20' })).body;
  assert.equal(yesterday.salaryTiming, null);
  assert.equal(yesterday.totals.salaryLaborCost, 600);
  const range = (await request({ start: '2026-09-20' })).body;
  assert.equal(range.salaryTiming, null);
  assert.equal(range.totals.salaryLaborCost, 1200);
});
await check('overnight service retains its opening business date', async () => {
  state.now = '2026-09-21T05:00:00Z';
  state.schedules = { Avon: { ...schedule, week: { '0': { open: '11:00', close: '02:00', closeDayOffset: 1 } } } };
  const data = (await request({ start: '2026-09-20', end: '2026-09-20' })).body;
  assert.equal(data.salaryTiming.applied, true);
  assert.equal(data.totals.salaryLaborCost, 560);
});
await check('missing salary preserves full-basis totals and shows missing configuration', async () => {
  state.rows.push({ ...toastRow, location: 'Middletown' });
  const data = (await request()).body;
  assert.equal(data.salaryTiming.applied, false);
  assert.equal(data.totals.salaryLaborCost, 600);
  assert.equal(data.salaryTiming.rows[1].status, 'missing_salary');
  const html = renderToStaticMarkup(createElement(Panel, { data: data.salaryTiming }));
  assert.ok(html.includes('Salario pendiente de configuración'));
  assert.ok(html.includes('dashboard aún muestra el salario completo'));
});
await check('Google outage uses dated public hours with a visible warning', async () => {
  state.hoursFail = true;
  const data = (await request()).body;
  assert.equal(data.salaryTiming.applied, true);
  assert.ok(data.salaryTiming.hoursError);
  assert.equal(data.salaryTiming.rows[0].operatingHours, 11);
});
await check('incomplete Google mapping cannot silently fabricate live hours', async () => {
  state.schedules = {};
  const data = (await request()).body;
  assert.equal(data.salaryTiming.applied, false);
  assert.equal(data.totals.salaryLaborCost, 600);
});
await check('Toast errors stay visible and do not produce partial labor totals', async () => {
  state.toastFail = true;
  const response = await request();
  assert.equal(response.code, 502);
  assert.equal(response.body.totals, undefined);
});
console.log('9 offline API/render release checks passed. Live authenticated data and visual layout are not asserted.');
