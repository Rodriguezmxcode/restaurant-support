import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { hasLegacyWorkspace, parseClientSetup, tenantWorkflowAllowed } from '../shared/tenantAccess.js';
import { authorize } from './authorization.js';
import type { SessionUser } from './authSession.js';

const other: SessionUser = { id: 'client-a', name: 'Client A', email: 'a@example.com', title: 'Owner', role: 'Corporate', locations: ['Orange'], organizationId: 'org-a' };
test('a Corporate role and an identical location name do not unlock Puerto Vallarta data', () => {
  for (const role of ['Corporate','Location Manager','Kitchen','HR','Administration','Maintenance'] as const) {
    const user = { ...other, role };
    assert.equal(hasLegacyWorkspace(user), false);
    for (const capability of ['ramp:read','labor:read','restaurant365:read','users:manage','actions:read','payments:approve'] as const) assert.equal(authorize(user, capability).ok, false);
    for (const resource of ['payments','actions','projects','reviews','google_reviews','tasks','management_audit','action_suggestions','operational_alert_scan','google_business_integration','organizations','future_resource']) assert.equal(tenantWorkflowAllowed(user, resource), false, resource);
    assert.equal(tenantWorkflowAllowed(user, 'native_tasks'), true);
  }
});
test('unscoped identities fail closed; the existing organization and Founder retain their workspace', () => {
  assert.equal(hasLegacyWorkspace({ ...other, organizationId: undefined }), false);
  assert.equal(tenantWorkflowAllowed({ ...other, organizationId: undefined }, 'native_tasks'), false);
  assert.equal(hasLegacyWorkspace({ ...other, organizationId: 'org-puerto-vallarta' }), true);
  assert.equal(authorize({ ...other, organizationId: 'org-puerto-vallarta' }, 'ramp:read').ok, true);
  assert.equal(tenantWorkflowAllowed({ role: 'Founder' }, 'organizations'), true);
  assert.equal(tenantWorkflowAllowed({ ...other, organizationId: 'org-puerto-vallarta' }, 'organizations'), false);
});
test('activation requires a subscription review with exactly the purchased location count', () => {
  const base = { requestId: randomUUID(), name: 'Example Cafe', adminName: 'Owner', email: 'OWNER@example.com', subscriptionId: 'sub_example', locations: ['First'], paidLocations: 1, paymentReviewed: true };
  assert.equal(parseClientSetup(base).email, 'owner@example.com');
  assert.throws(() => parseClientSetup({ ...base, paymentReviewed: false }));
  assert.throws(() => parseClientSetup({ ...base, subscriptionId: 'cs_redirectOnly' }));
  assert.throws(() => parseClientSetup({ ...base, locations: ['First', 'Second'] }));
  assert.throws(() => parseClientSetup({ ...base, locations: ['First', ' first '], paidLocations: 2 }));
  assert.throws(() => parseClientSetup({ ...base, locations: [] }));
});
