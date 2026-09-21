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
console.log('5 offline chat rendering checks passed: cited response/escaping, preview guard, setup guidance, pending request, Founder billing guidance.');
