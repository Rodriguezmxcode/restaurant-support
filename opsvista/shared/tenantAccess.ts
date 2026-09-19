export const PUERTO_VALLARTA_ORG = 'org-puerto-vallarta';
type TenantIdentity = { role: string; organizationId?: string };

// Legacy integrations have account-wide credentials. Never route another
// organization's request to those sources, even if its user is Corporate.
export function hasLegacyWorkspace(user: TenantIdentity) {
  return user.role === 'Founder' || user.organizationId === PUERTO_VALLARTA_ORG;
}

export function tenantWorkflowAllowed(user: TenantIdentity, resource: string) {
  if (resource === 'organizations') return user.role === 'Founder';
  if (hasLegacyWorkspace(user)) return true;
  if (!user.organizationId) return false;
  if (resource === 'native_tasks') return true;
  if (user.role === 'Corporate') {
    return ['tenant_team','google_business_integration','google_business_callback','google_reviews'].includes(resource);
  }
  return false;
}

export function parseClientSetup(body: Record<string, unknown>) {
  const value = (key: string, max: number) => {
    const result = typeof body[key] === 'string' ? body[key].trim() : '';
    if (!result || result.length > max) throw new Error(`Invalid ${key}`);
    return result;
  };
  const requestId = value('requestId', 36);
  if (!/^[a-f0-9-]{36}$/i.test(requestId)) throw new Error('Invalid requestId');
  const name = value('name', 160), adminName = value('adminName', 160), email = value('email', 254).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Invalid email');
  const subscriptionId = value('subscriptionId', 120);
  if (!/^sub_[a-zA-Z0-9]+$/.test(subscriptionId) || body.paymentReviewed !== true) throw new Error('Review the paid subscription in Stripe before activating access');
  const locations = Array.isArray(body.locations) ? body.locations : [];
  if (!locations.length || locations.length > 10000 || locations.some(v => typeof v !== 'string' || !v.trim() || v.trim().length > 120)) throw new Error('Enter valid location names');
  const normalized = locations.map(v => (v as string).trim());
  if (new Set(normalized.map(v => v.toLowerCase())).size !== normalized.length) throw new Error('Location names must be unique');
  if (body.paidLocations !== normalized.length) throw new Error('Locations must match the quantity reviewed in Stripe');
  return { requestId, name, adminName, email, subscriptionId, locations: normalized };
}
