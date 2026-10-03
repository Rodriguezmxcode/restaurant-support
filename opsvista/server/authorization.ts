import type { ServerRole, SessionUser } from './authSession.js';
import { hasLegacyWorkspace } from '../shared/tenantAccess.js';

export type ServerCapability =
  | 'ramp:read'
  | 'labor:read'
  | 'evidence:read'
  | 'evidence:review'
  | 'actions:read'
  | 'actions:write'
  | 'actions:verify'
  | 'projects:read'
  | 'projects:write'
  | 'automation:run'
  | 'payments:approve'
  | 'restaurant365:read'
  | 'price-watch:read'
  | 'bonus:read'
  | 'users:manage'
  | 'platform:admin'
  | 'integrations:manage';

const operational: ServerCapability[] = ['ramp:read','labor:read','evidence:read','evidence:review','actions:read','actions:write','actions:verify','projects:read','projects:write','automation:run','payments:approve','users:manage'];

const capabilities: Record<ServerRole, ServerCapability[]> = {
  Founder: [...operational,'restaurant365:read','price-watch:read','bonus:read','platform:admin','integrations:manage'],
  Corporate: [...operational,'restaurant365:read','price-watch:read','bonus:read','integrations:manage'],
  'Online Reputation Manager': [],
  'Location Manager': ['bonus:read','price-watch:read','ramp:read','labor:read','evidence:read','evidence:review','actions:read','actions:write','actions:verify','projects:read','projects:write'],
  Kitchen: ['bonus:read','evidence:read','evidence:review','actions:read','actions:write','actions:verify','projects:read','projects:write'],
  HR: ['labor:read','actions:read','actions:write','projects:read','projects:write'],
  Administration: ['ramp:read','actions:read','actions:write','actions:verify','projects:read','projects:write','payments:approve','restaurant365:read','price-watch:read'],
  Maintenance: ['evidence:read','actions:read','actions:write','actions:verify','projects:read','projects:write'],
};

const globalLocationRoles: ServerRole[] = ['Founder','Corporate','Online Reputation Manager','HR','Administration','Maintenance'];

export function hasCapability(user: SessionUser, capability: ServerCapability) {
  return capabilities[user.role].includes(capability);
}

export function serverLocationAllowed(user: SessionUser, location?: string) {
  if (!location || globalLocationRoles.includes(user.role)) return true;
  return user.locations.includes(location);
}

export function authorize(user: SessionUser | null, capability: ServerCapability, location?: string) {
  if (!user) return { ok: false as const, status: 401, error: 'Authentication required' };
  const tenantIntegrationAdmin = capability === 'integrations:manage' && user.role === 'Corporate' && Boolean(user.organizationId);
  if (!hasLegacyWorkspace(user) && !tenantIntegrationAdmin) return { ok: false as const, status: 403, error: 'This module is not enabled for your organization' };
  if (!hasCapability(user, capability)) return { ok: false as const, status: 403, error: 'Permission denied' };
  if (!serverLocationAllowed(user, location)) return { ok: false as const, status: 403, error: 'Location not authorized' };
  return { ok: true as const, user };
}
