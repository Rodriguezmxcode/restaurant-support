const assert = require('node:assert/strict');
const test = require('node:test');
const ts = require('typescript');
const {readFileSync} = require('node:fs');
const path = require('node:path');
test('push recovers cold launch once, opens later taps, and stops on cleanup', async () => {
  const response = id => ({notification: {request: {identifier: id, content: {data: {actionId: id}}}}});
  let listener, cleared = 0, removed = 0;
  const receipts = [], opened = [];
  const notifications = {
    setNotificationHandler() {},
    addNotificationReceivedListener() {return {remove() {removed++;}};},
    addNotificationResponseReceivedListener(fn) {listener = fn; return {remove() {removed++;}};},
    getLastNotificationResponse() {return response('cold');},
    clearLastNotificationResponse() {cleared++;},
  };
  const dependencies = {'expo-constants': {}, 'expo-device': {}, 'expo-notifications': notifications, 'react-native': {Platform: {OS: 'ios'}}, './api': {actionApi: {receipt: async (...args) => {receipts.push(args);}}}};
  const m = {exports: {}};
  const src = readFileSync(path.join(__dirname, '../src/push.ts'), 'utf8');
  new Function('require', 'exports', 'module', ts.transpileModule(src, {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText)(name => dependencies[name], m.exports, m);
  const cleanup = m.exports.listenForActionPush(id => opened.push(id));
  listener(response('cold')); listener(response('later'));
  assert.deepEqual(opened, ['cold', 'later']);
  assert.deepEqual(receipts, [['cold','Seen'],['later','Seen']]);
  assert.equal(cleared, 1);
  cleanup(); listener(response('after-logout'));
  assert.deepEqual(opened, ['cold', 'later']); assert.equal(removed, 2);
});
