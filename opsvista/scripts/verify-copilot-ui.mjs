// Offline rendering checks. Seeds state without authenticating or contacting a
// live source. These do not replace an authenticated browser acceptance check.
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
let seed = {}, stateIndex = 0, interactive = false, refIndex = 0;
const refs = [];
const cache = new Map();
function load(file) {
  if (file.endsWith('.css')) return {};
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const localRequire = specifier => {
    if (specifier === 'react') return {
      ...React,
      useState: initial => {
        const index = stateIndex++;
        if (!interactive) return React.useState(Object.hasOwn(seed, index) ? seed[index] : initial);
        if (!Object.hasOwn(seed, index)) seed[index] = typeof initial === 'function' ? initial() : initial;
        return [seed[index], value => { seed[index] = typeof value === 'function' ? value(seed[index]) : value; }];
      },
      useEffect: (...args) => interactive ? undefined : React.useEffect(...args),
      useMemo: (fn, deps) => interactive ? fn() : React.useMemo(fn, deps),
      useRef: initial => interactive ? (refs[refIndex++] ??= { current: initial }) : React.useRef(initial),
    };
    if (!specifier.startsWith('.')) return nativeRequire(specifier);
    let target = resolve(dirname(file), specifier);
    if (target.endsWith('.js')) target = target.slice(0, -3) + '.ts';
    else if (!/\.(tsx?|css)$/.test(target)) target += '.ts';
    return load(target);
  };
  new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
  return module.exports;
}
const Copilot = load(resolve(root, 'src/OpsVistaCopilot.tsx')).default;
const props = { currentUserId: 'fixture', currentUserName: 'Test Manager', role: 'Location Manager', allowedLocations: ['Avon'], modules: ['Ventas', 'Gastos', 'Tasks', 'Action Center'], currentSection: 'Ventas', onNavigate() {} };
function render(values, overrides = {}) { seed = values; stateIndex = 0; return renderToStaticMarkup(React.createElement(Copilot, { ...props, ...overrides })); }
const source = { id: 'S1', dataset: 'performance', label: 'Toast', start: '2026-09-20', end: '2026-09-20', locations: ['Avon'], retrievedAt: '2026-09-20T17:00:00Z', note: 'Accrued salary; not closing forecast.', available: true };
const ai = render({ 0: true, 3: 'labor', 6: [{ id: '1', role: 'assistant', text: '<script>bad()</script> Labor [S1]', sources: [source], createdAt: 1 }], 7: 'ai', 8: ['performance'] });
assert.match(ai, /Fuentes consultadas/);
assert.match(ai, /2026-09-20/);
assert.match(ai, /Avon/);
assert.match(ai, /Abrir módulo de la fuente/);
assert.match(ai, /&lt;script&gt;/);
assert.doesNotMatch(ai, /<script>/);
const preview = render({ 0: true, 3: 'labor', 7: 'ai', 8: ['performance'] }, { readOnlyPreview: true });
assert.match(preview, /consultas de IA desactivadas/);
assert.match(preview, /<button[^>]*disabled=""[^>]*aria-label="Enviar pregunta"/);
const guide = render({ 0: true, 7: 'guide' });
assert.match(guide, /La IA requiere activar la conexión de OpenAI/);
assert.doesNotMatch(guide, /IA habilitada/);
const busy = render({ 0: true, 3: 'labor', 7: 'ai', 10: true });
assert.match(busy, /Consultando tus datos/);
assert.match(busy, /<button[^>]*disabled=""[^>]*aria-label="Enviar pregunta"/);
const billing=render({0:true,6:[{id:'billing',role:'assistant',text:'Crédito agotado.',error:true,issueCode:'openai_credit',createdAt:1}],7:'ai'},{role:'Founder'});
assert.match(billing,/Revisar saldo de OpenAI/);
assert.match(billing,/https:\/\/platform.openai.com\/settings\/organization\/billing\/overview/);
const managerBilling=render({0:true,6:[{id:'billing',role:'assistant',text:'Crédito agotado.',error:true,issueCode:'openai_credit',createdAt:1}],7:'ai'});
assert.doesNotMatch(managerBilling,/Revisar saldo de OpenAI/);
const invoices = render({0:true,6:[{id:'ap',role:'assistant',text:'Aprobada; pago no disponible. [S1]',sources:[{...source,dataset:'invoices',label:'Restaurant365'}],createdAt:1}],7:'ai',8:['invoices']},{role:'Founder',modules:['Restaurant365']});
assert.match(invoices,/Abrir módulo de la fuente/);
assert.match(invoices,/facturas de los últimos 7 días/);
assert.doesNotMatch(ai,/facturas de los últimos 7 días/);
console.log('6 offline chat rendering checks passed: cited response/escaping, preview guard, setup guidance, pending request, Founder billing guidance, invoice source and authorized suggestion.');

// Exercise the real component event handlers with isolated state and transport.
// This verifies the zero-POST path, not just the presence of a guide button.
const { localCopilotAnswer } = load(resolve(root, 'src/copilot.ts'));
const modules = ['Resumen', 'Ventas', 'Gastos', 'Tasks', 'Horarios', 'Bono semanal', 'Restaurant365', 'Action Center'];
for (const [question, destination] of [
  ['Llévame a ventas', 'Ventas'], ['¿Puedes llevarme a Gastos?', 'Gastos'],
  ['Abre Tasks', 'Tasks'], ['Abre Resumen', 'Resumen'],
  ['¿Dónde subo un recibo?', 'Gastos'], ['¿Dónde subo archivos de Provi?', 'Restaurant365'],
  ['Abre Price Watch', 'Restaurant365'], ['¿Cómo funciona el bono?', 'Bono semanal'],
  ['Abre Facturas', 'Restaurant365'],
  ['¿Dónde subo una foto?', 'Tasks'], ['Open sales', 'Ventas'],
]) assert.equal(localCopilotAnswer(question, modules)?.module, destination, question);
for (const question of [
  '¿Cómo va hoy el salario acumulado y el labor total?',
  '¿Cuántos gastos de esta semana no tienen recibo?', 'What are sales today?',
  '¿Qué reportes Provi tengo de los últimos 28 días?',
  '¿Qué facturas de los últimos 7 días están aprobadas y cuáles faltan por aprobar?',
  '¿Cuáles facturas están aprobadas y pagadas?',
]) assert.equal(localCopilotAnswer(question, modules), null, question);
assert.equal(localCopilotAnswer('Abre Configuración', modules).module, undefined);
assert.match(localCopilotAnswer('Abre Configuración', modules).answer, /no tiene acceso/);

function walk(node, predicate) {
  if (!node || typeof node !== 'object') return undefined;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const found = walk(child, predicate); if (found) return found;
  }
}
let navigated;
function tree() { stateIndex = 0; refIndex = 0; return Copilot({ ...props, modules, onNavigate: value => { navigated = value; } }); }
function start(values = {}) { seed = { 0: true, 6: [], 7: 'ai', 8: ['performance'], ...values }; refs.length = 0; return tree(); }
function suggestion(label) { return walk(tree(), node => node.type === 'button' && node.props.children === label); }
async function submit(question) {
  seed[3] = question;
  walk(tree(), node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  // Allow the mocked async fetch/json chain to settle.
  await new Promise(resolve => setImmediate(resolve));
}
const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
let requests = 0, providerError = false;
interactive = true;
globalThis.window = { setTimeout, clearTimeout, localStorage: { getItem() { return null; } } };
globalThis.fetch = async (_url, options) => {
  assert.equal(options.method, 'POST'); requests++;
  return { ok: !providerError, json: async () => providerError
    ? { code: 'openai_credit', error: 'Crédito agotado.' }
    : { answer: 'Fixture data answer [S1]', sources: [source] } };
};
try {
  for (const mode of ['ai', 'checking', 'error', 'guide']) {
    start({ 7: mode });
    await submit('Llévame a ventas');
    assert.equal(requests, 0, `Navigation must not POST in ${mode} mode`);
    assert.equal(seed[6].at(-1).answer.module, 'Ventas');
    walk(tree(), node => node.props?.className === 'copilot-open-module').props.onClick();
    assert.equal(navigated, 'Ventas'); assert.equal(seed[0], false);
  }
  start(); await submit('¿Cómo va hoy el salario acumulado y el labor total?');
  assert.equal(requests, 1); assert.equal(seed[6].at(-1).text, 'Fixture data answer [S1]');
  start(); providerError = true;
  await submit('¿Cómo va hoy el salario acumulado y el labor total?');
  assert.equal(requests, 2); assert.equal(seed[12], true); assert.equal(seed[6].at(-1).issueCode, 'openai_credit');
  await submit('¿Dónde subo archivos de Provi?');
  assert.equal(requests, 2); assert.equal(seed[6].at(-1).answer.module, 'Restaurant365');
  await submit('¿Cuántos gastos de esta semana no tienen recibo?');
  assert.equal(requests, 2, 'Blocked provider must stay in free guide until explicitly retried');
  suggestion('Consultar datos con IA').props.onClick();
  assert.equal(seed[12], false);
  providerError = false; await submit('What are sales today?'); assert.equal(requests, 3);
  suggestion('Guía de módulos · Gratis').props.onClick();
  await submit('What are sales today?'); assert.equal(requests, 3, 'Manual guide must not POST');
} finally { interactive = false; globalThis.fetch = originalFetch; globalThis.window = originalWindow; }
console.log('Free routing and interaction checks passed: 11 destinations, live-data routing, permissions, four connection modes, navigation click, zero-credit fallback, explicit retry and manual guide.');
