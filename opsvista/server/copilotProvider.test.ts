import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOpenAIError, openAIResponse } from './copilotEngine.js';
import { CopilotError } from './copilotPolicy.js';

test('precise billing codes take precedence over insufficient_quota type', () => {
  const cases = { credit_balance_exhausted: 'openai_credit', project_spend_limit_exceeded: 'openai_project_spend', organization_spend_limit_exceeded: 'openai_organization_spend', organization_usage_limit_exceeded: 'openai_usage', insufficient_quota: 'openai_quota' };
  for (const [code, kind] of Object.entries(cases)) {
    const failure = classifyOpenAIError(429, { error: { code, type: 'insufficient_quota' } }, '60');
    assert.equal(failure.kind, kind);
    assert.equal(failure.retryable, false);
    assert.equal(failure.error.details.retryAfterSeconds, undefined);
  }
});
test('temporary rate limits keep provider wait time, including HTTP-date', () => {
  const payload = { error: { code: 'rate_limit_exceeded' } };
  assert.equal(classifyOpenAIError(429, payload, '90').retryAfterSeconds, 90);
  const now = Date.parse('2026-09-21T04:00:00Z');
  assert.equal(classifyOpenAIError(429, payload, 'Mon, 21 Sep 2026 04:01:00 GMT', now).retryAfterSeconds, 60);
  assert.equal(classifyOpenAIError(429, { error: { type: 'rate_limit_error', code: 'slow_down' } }, null).kind, 'openai_rate');
});
test('unknown or malformed 429 responses do not imply credit exhaustion or trigger retry', () => {
  for (const payload of [null, {}, { error: { code: '__proto__', message: 'sk-SECRET' } }, { error: { code: 'future_unknown_code' } }]) {
    const failure = classifyOpenAIError(429, payload, null);
    assert.equal(failure.kind, 'openai_rejected');
    assert.equal(failure.retryable, false);
    assert.doesNotMatch(failure.error.message, /SECRET|future_unknown_code/);
  }
});
test('authentication and model-access failures are actionable without misleading session expiry', () => {
  assert.equal(classifyOpenAIError(401, null, null).kind, 'openai_auth');
  assert.equal(classifyOpenAIError(404, { error: { code: 'model_not_found' } }, null).kind, 'openai_configuration');
  assert.equal(classifyOpenAIError(403, null, null).error.status, 503);
});

async function withTransport(responses: Response[], fn: (calls: () => number, logs: unknown[][]) => Promise<void>) {
  const originalFetch = globalThis.fetch, originalWarn = console.warn;
  let count = 0;
  const logs: unknown[][] = [];
  globalThis.fetch = async () => { const response = responses[count++]; assert.ok(response, 'Unexpected extra provider request'); return response; };
  console.warn = (...args: unknown[]) => { logs.push(args); };
  try { await fn(() => count, logs); } finally { globalThis.fetch = originalFetch; console.warn = originalWarn; }
}
const failed = (code: string, retry = '0') => new Response(JSON.stringify({ error: { code, message: 'secret API key sk-NEVER-LOG; private question' } }), { status: 429, headers: { 'Retry-After': retry, 'x-request-id': 'req_test123' } });

test('credit error makes one attempt and logs only an allowlisted reason', async () => {
  await withTransport([failed('credit_balance_exhausted')], async (calls, logs) => {
    await assert.rejects(openAIResponse({}, new AbortController().signal), error => error instanceof CopilotError && error.details.code === 'openai_credit' && !error.details.retryAfterSeconds);
    assert.equal(calls(), 1);
    assert.match(JSON.stringify(logs), /credit_balance_exhausted/);
    assert.doesNotMatch(JSON.stringify(logs), /NEVER-LOG|private question|secret API key/);
  });
});
test('brief rate limit retries once and returns the successful response', async () => {
  await withTransport([failed('rate_limit_exceeded'), new Response(JSON.stringify({ status: 'completed', output: [] }))], async calls => {
    assert.equal((await openAIResponse({}, new AbortController().signal)).status, 'completed');
    assert.equal(calls(), 2);
  });
});
test('persistent rate limit has a bounded retry and preserves retry guidance', async () => {
  await withTransport([failed('slow_down'), failed('slow_down', '45')], async calls => {
    await assert.rejects(openAIResponse({}, new AbortController().signal), error => error instanceof CopilotError && error.details.retryAfterSeconds === 45 && error.details.code === 'openai_rate');
    assert.equal(calls(), 2);
  });
});
test('long server wait is not shortened to fit an automatic retry', async () => {
  await withTransport([failed('rate_limit_exceeded', '120')], async calls => {
    await assert.rejects(openAIResponse({}, new AbortController().signal), error => error instanceof CopilotError && error.details.retryAfterSeconds === 120);
    assert.equal(calls(), 1);
  });
});
test('cancellation interrupts retry without sending another provider request', async () => {
  await withTransport([failed('rate_limit_exceeded', '2')], async calls => {
    const controller = new AbortController();
    const pending = openAIResponse({}, controller.signal);
    const timer = setTimeout(() => controller.abort(new Error('Canceled test')), 10);
    try { await assert.rejects(pending, /Canceled test/); assert.equal(calls(), 1); }
    finally { clearTimeout(timer); }
  });
});
