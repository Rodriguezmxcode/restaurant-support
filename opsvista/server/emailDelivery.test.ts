import assert from 'node:assert/strict';
import test from 'node:test';
import { deliverNotificationEmail } from './emailDelivery.js';

const input = {
  apiKey: 'test-key', from: 'OpsVista <alerts@example.com>', recipients: ['recipient@example.com'],
  eventKey: 'test-event', title: 'Prueba <OpsVista>', body: 'Detalle <script>texto</script>',
  appUrl: 'https://restaurant-support.vercel.app/',
};

test('missing configuration or recipients never makes a network request', async () => {
  const request = (() => { throw new Error('Network must not be called'); }) as typeof fetch;
  assert.equal((await deliverNotificationEmail({ ...input, apiKey: '' }, request)).accepted, false);
  assert.equal((await deliverNotificationEmail({ ...input, recipients: [] }, request)).accepted, false);
});

test('acceptance requires a provider ID and sends an escaped template with the app link', async () => {
  const request = (async (url, init) => {
    assert.equal(url, 'https://api.resend.com/emails');
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.to, input.recipients);
    assert.ok(body.html.includes('&lt;script&gt;texto&lt;/script&gt;'));
    assert.ok(!body.html.includes('<script>'));
    assert.ok(body.text.includes(input.appUrl));
    assert.ok(init?.signal);
    return new Response(JSON.stringify({ id: 'provider-message-1' }), { status: 200 });
  }) as typeof fetch;
  assert.deepEqual(await deliverNotificationEmail(input, request), { accepted: true, providerId: 'provider-message-1' });
});

test('provider errors cannot be reported as acceptance', async () => {
  for (const status of [401, 403, 422, 429, 500]) {
    const request = (async () => new Response('private provider detail', { status })) as typeof fetch;
    const result = await deliverNotificationEmail(input, request);
    assert.equal(result.accepted, false);
    assert.ok(!JSON.stringify(result).includes('private provider detail'));
  }
});

test('a malformed success response and network failure leave delivery unconfirmed', async () => {
  for (const payload of ['{}', '{"id":null}', 'not-json']) {
    const request = (async () => new Response(payload, { status: 200 })) as typeof fetch;
    assert.equal((await deliverNotificationEmail(input, request)).accepted, false);
  }
  const request = (async () => { throw new Error('secret transport detail'); }) as typeof fetch;
  const result = await deliverNotificationEmail(input, request);
  assert.equal(result.accepted, false);
  assert.ok(!JSON.stringify(result).includes('secret transport detail'));
});

test('retries normalize recipients and keep the same idempotency key and payload', async () => {
  const attempts: { key: string | null; body: string }[] = [];
  const request = (async (_url, init) => {
    attempts.push({ key: new Headers(init?.headers).get('Idempotency-Key'), body: String(init?.body) });
    return new Response(JSON.stringify({ id: 'same-message' }), { status: 200 });
  }) as typeof fetch;
  await deliverNotificationEmail({ ...input, recipients: ['b@example.com', 'a@example.com', 'a@example.com'] }, request);
  await deliverNotificationEmail({ ...input, recipients: ['a@example.com', 'b@example.com'] }, request);
  assert.deepEqual(attempts[0], attempts[1]);
  assert.ok(attempts[0].key && attempts[0].key.length <= 256);
});

test('unsafe app links never reach the provider', async () => {
  const request = (() => { throw new Error('Network must not be called'); }) as typeof fetch;
  for (const appUrl of ['javascript:alert(1)', 'http://example.com', 'https://user:password@example.com']) {
    assert.equal((await deliverNotificationEmail({ ...input, appUrl }, request)).accepted, false);
  }
});
