// Offline regression checks using the real view handlers and navigation code.
// Fixtures stay in this process; no authenticated service or business write is used.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const nativeRequire = createRequire(new URL('../package.json', import.meta.url));
const React = nativeRequire('react');
const { renderToStaticMarkup } = nativeRequire('react-dom/server');
let seed = {}, stateIndex = 0, language = 'es';
const cache = new Map();
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
function load(file) {
  if (file.endsWith('.css')) return {};
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const localRequire = specifier => {
    if (specifier === 'react') return { ...React,
      useState(initial) {
        const index = stateIndex++;
        if (!Object.hasOwn(seed, index)) seed[index] = typeof initial === 'function' ? initial() : initial;
        return [seed[index], value => { seed[index] = typeof value === 'function' ? value(seed[index]) : value; }];
      },
      useEffect() {}, useMemo: fn => fn(),
    };
    if (specifier === './i18n') return { useI18n: () => ({ t: (en, es) => language === 'es' ? es : en }) };
    if (['./NotificationEmailPanel', './OpsVistaDatePicker', './ActionAssignmentOverview'].includes(specifier)) return { __esModule: true, default: () => null };
    if (!specifier.startsWith('.')) return nativeRequire(specifier);
    let target = resolve(dirname(file), specifier);
    if (target.endsWith('.js')) target = target.slice(0, -3) + '.ts';
    else if (!/\.(tsx?|css)$/.test(target)) target += existsSync(target + '.ts') ? '.ts' : '.tsx';
    return load(target);
  };
  new Function('require', 'module', 'exports', compile(readFileSync(file, 'utf8')))(localRequire, module, module.exports);
  return module.exports;
}

const access = load(resolve(root, 'src/accessControl.ts'));
for (const [role, permissions] of Object.entries(access.rolePermissions)) {
  assert.equal(permissions.modules.includes('Prioridades'), false, role);
  assert.equal(permissions.modules.filter(module => module === 'Action Center').length, role === 'Online Reputation Manager' ? 0 : 1, role);
  assert.equal(access.canAccessModule({ role }, 'Prioridades'), access.canAccessModule({ role }, 'Action Center'));
}

// Extract production navigation functions, preserving their actual permission checks.
const appSource = readFileSync(resolve(root, 'src/App.tsx'), 'utf8');
const app = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function namedCode(name) {
  let result;
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(app) === name)
      result = ts.isFunctionDeclaration(node) ? node.getText(app) : `const ${node.getText(app)};`;
    ts.forEachChild(node, visit);
  }
  visit(app); assert.ok(result, name); return result;
}
function fromApp(name, context) {
  return new Function(...Object.keys(context), compile(namedCode(name)) + `\nreturn ${name};`)(...Object.values(context));
}
const memory = new Map([['opsvista-section', 'Prioridades']]);
const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
const browser = { localStorage: storage, sessionStorage: storage, scrollTo() {} };
const storedSection = fromApp('storedSection', { window: browser, normalizeModule: access.normalizeModule });
const rememberSection = fromApp('rememberSection', { window: browser, normalizeModule: access.normalizeModule });
assert.equal(storedSection(), 'Action Center');
rememberSection('Prioridades'); assert.equal(memory.get('opsvista-section'), 'Action Center');
const catalog = fromApp('searchCatalog', {});
assert.equal(catalog.filter(item => item.section === 'Action Center').length, 1);
assert.equal(catalog.some(item => item.section === 'Prioridades'), false);
assert.ok(catalog.find(item => item.section === 'Action Center').keywords.includes('prioridades'));
for (const nav of [['Action Center'], ['Google Reviews']]) {
  let destination, selectedTarget;
  const context = { nav, normalizeModule: access.normalizeModule, rememberSection, window: browser,
    setSection: value => { destination = value; }, setSearchTarget: value => { selectedTarget = value; },
    setSearch() {}, setSearchOpen() {}, setSearchIndex() {}, setLiveSearchResults() {},
  };
  fromApp('openSearchResult', context)({ section: 'Prioridades', badge: 'ACCIÓN', recordId: 'completed', location: 'Avon' });
  assert.equal(destination, nav[0] === 'Action Center' ? 'Action Center' : undefined);
  if (destination) { assert.equal(selectedTarget.recordId, 'completed'); assert.equal(selectedTarget.section, 'Action Center'); }
  destination = undefined;
  fromApp('openCopilotModule', context)('Prioridades');
  assert.equal(destination, nav[0] === 'Action Center' ? 'Action Center' : undefined);
}

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const yesterday = new Date(new Date(`${today}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
const fixture = (id, patch = {}) => ({ id, title: id, location: 'Avon', category: 'Operations', status: 'Open', severity: 'Medium',
  signal: 'fixture signal', cause: '', recommendation: '', impact: '', automated: false, priorityScore: 50,
  sources: [], sourceIds: [], verificationStatus: 'Pending', createdAt: `${today}T10:00:00Z`, updatedAt: `${today}T10:00:00Z`, ...patch });
const actions = [
  fixture('mine-high', { ownerId: 'me', ownerName: 'Manager', severity: 'High', priorityScore: 80, dueAt: yesterday }),
  fixture('other-high', { ownerId: 'other', ownerName: 'Other', status: 'Investigating', severity: 'High', priorityScore: 80, dueAt: today }),
  fixture('unassigned'),
  fixture('legacy-owner', { ownerName: 'Legacy Manager', status: 'Assigned' }),
  fixture('completed', { ownerId: 'other', status: 'Completed', severity: 'High', priorityScore: 100, dueAt: yesterday, updatedAt: `${yesterday}T10:00:00Z` }),
  fixture('dismissed', { ownerName: 'Archived Owner', status: 'Dismissed', dueAt: yesterday }),
  fixture('outside-scope', { location: 'Forbidden', severity: 'High', priorityScore: 100 }),
];
const originalActions = JSON.stringify(actions);
const ActionCenter = load(resolve(root, 'src/ActionCenterView.tsx')).default;
const props = { currentUser: { id: 'me', name: 'Manager', role: 'Founder', locations: ['Avon'], active: true }, allowedLocations: ['Avon'], canTestNotifications: false };
let currentProps = props;
function tree() { stateIndex = 0; return ActionCenter(currentProps); }
function start(overrides = {}, nextProps = props) { currentProps = nextProps; seed = { 2: actions, 10: false, ...overrides }; return tree(); }
function nodes(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...[node.props?.children].flat(Infinity).flatMap(child => nodes(child, predicate))];
}
const tab = id => nodes(tree(), node => node.props?.['data-action-view'] === id)[0];
const rows = () => nodes(tree(), node => node.props?.className?.startsWith('action-row ')).map(node => node.key);
const assertView = (id, expected) => {
  tab(id).props.onClick();
  assert.deepEqual(rows(), expected, id);
  assert.equal(tab(id).props['aria-pressed'], true);
  assert.equal(tab(id).props.children.at(-1).props.children, expected.length, `${id} count`);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('View navigation must not write business data'); };
try {
  start();
  assertView('active', ['mine-high', 'other-high', 'unassigned', 'legacy-owner']);
  assertView('mine', ['mine-high']);
  assertView('high', ['mine-high', 'other-high']);
  assertView('overdue', ['mine-high']); // A deadline today is not overdue; closed actions stay in history.
  assertView('unassigned', ['unassigned']); // A legacy name-only owner is still assigned.
  assertView('history', ['dismissed', 'completed']); // Recent closure before priority score.
  const markup = renderToStaticMarkup(tree());
  for (const label of ['Mis acciones', 'Alta prioridad', 'Vencidas', 'Sin asignar', 'Historial']) assert.ok(markup.includes(label), label);
  assert.ok(markup.includes('Audit history'));
  assert.ok(markup.includes('value="name:Archived Owner"'), 'History retains owners with only dismissed actions');
  language = 'en'; assert.match(renderToStaticMarkup(tree()), /High priority/); language = 'es';
  start({ 15: 'My actions', 0: 'name:Legacy Manager' });
  assertView('high', ['mine-high', 'other-high']); // Presets reset conflicting owner filters.
  nodes(tree(), node => node.props?.['aria-label'] === 'Buscar acciones')[0].props.onChange({ target: { value: 'other-high' } });
  assertView('active', ['other-high']);
  nodes(tree(), node => node.props?.['aria-label'] === 'Locación de las acciones')[0].props.onChange({ target: { value: 'Forbidden' } });
  assertView('high', []);
  start({}, { ...props, currentUser: { ...props.currentUser, role: 'Location Manager' } });
  assert.equal(tab('mine').props['aria-pressed'], true);
  start({}, { ...props, currentUser: { ...props.currentUser, role: 'Location Manager' }, initialRecordId: 'completed' });
  assert.ok(rows().includes('completed'), 'Search can open a completed action owned by another authorized user');
  assert.equal(nodes(tree(), node => node.props?.className === 'panel detail-panel')[0].props.children[0].props.children.props.children[1].props.children, 'completed');
  assert.equal(JSON.stringify(actions), originalActions, 'Views must not mutate records');
} finally { globalThis.fetch = originalFetch; }

const { localCopilotAnswer } = load(resolve(root, 'src/copilot.ts'));
for (const question of ['Abre Prioridades', 'Open priorities', 'Centro de acciones', 'Abre Action Center']) {
  assert.equal(localCopilotAnswer(question, ['Action Center']).module, 'Action Center', question);
  assert.equal(localCopilotAnswer(question, ['Google Reviews']).module, undefined, question);
}
const { searchLiveOpsVista } = load(resolve(root, 'src/globalSearch.ts'));
globalThis.fetch = async (_url, options) => {
  assert.ok(!options?.method || options.method === 'GET');
  return { ok: true, json: async () => ({ actions }) };
};
try {
  for (const modules of [['Prioridades'], ['Action Center'], ['Prioridades', 'Action Center']]) {
    const found = await searchLiveOpsVista('high', modules, ['Avon']);
    assert.equal(found.length, 2);
    assert.ok(found.every(item => item.section === 'Action Center' && item.location === 'Avon'));
  }
} finally { globalThis.fetch = originalFetch; }
console.log('Action Center checks passed: all views, counts, owner/location scope, history, saved navigation, search aliases, role permissions and bilingual labels. No live business writes.');
