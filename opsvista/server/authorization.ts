import type { ServerRole, SessionUser } from './authSession';

export type ServerCapability =
  | 'ramp:read'
  | 'labor:read'
  | 'evidence:read'
  | 'evidence:review'
  | 'actions:read'
  | 'actions:write'
  | 'actions:verify'
  | 'automation:run'
  | 'payments:approve'
  | 'users:manage'
  | 'platform:admin'
  | 'integrations:manage';

const operational: ServerCapability[] = ['ramp:read','labor:read','evidence:read','evidence:review','actions:read','actions:write','actions:verify','automation:run','payments:approve','users:manage'];

const capabilities: Record<ServerRole, ServerCapability[]> = {
  Founder: [...operational,'platform:admin','integrations:manage'],
  Corporate: operational,
  'Location Manager': ['labor:read','evidence:read','evidence:review','actions:read','actions:write','actions:verify'],
  Kitchen: ['evidence:read','evidence:review','actions:read','actions:write','actions:verify'],
  HR: ['labor:read','actions:read','actions:write'],
  Administration: ['ramp:read','actions:read','actions:write','actions:verify','payments:approve'],
  Maintenance: ['evidence:read','actions:read','actions:write','actions:verify'],
};

const globalLocationRoles: ServerRole[] = ['Founder','Corporate','HR','Administration','Maintenance'];

export function hasCapability(user: SessionUser, capability: ServerCapability) {
  return capabilities[user.role].includes(capability);
}

export function serverLocationAllowed(user: SessionUser, location?: string) {
  if (!location || globalLocationRoles.includes(user.role)) return true;
  return user.locations.includes(location);
}

export function authorize(user: SessionUser | null, capability: ServerCapability, location?: string) {
  if (!user) return { ok: false as const, status: 401, error: 'Authentication required' };
  if (!hasCapability(user, capability)) return { ok: false as const, status: 403, error: 'Permission denied' };
  if (!serverLocationAllowed(user, location)) return { ok: false as const, status: 403, error: 'Location not authorized' };
  return { ok: true as const, user };
}
