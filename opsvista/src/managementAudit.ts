import { type LocationAccessGrant, type OpsVistaUser } from './accessControl';

export type ManagementAuditAction =
  | 'User created'
  | 'User activated'
  | 'User deactivated'
  | 'Role changed'
  | 'Title changed'
  | 'Primary location changed'
  | 'Additional location granted'
  | 'Additional location revoked'
  | 'Additional access expiration changed'
  | 'Access note changed';

export type ManagementAuditEvent = {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  targetUserId: string;
  targetUserName: string;
  action: ManagementAuditAction;
  location?: string;
  before?: string;
  after?: string;
  reason: string;
  automatic?: boolean;
};

const USERS_KEY = 'opsvista.preview.managedUsers.v1';
const AUDIT_KEY = 'opsvista.preview.managementAudit.v1';

function cloneUser(user: OpsVistaUser): OpsVistaUser {
  return {
    ...user,
    locations: [...user.locations],
    locationGrants: user.locationGrants?.map(grant => ({ ...grant })),
  };
}

export function loadManagedUsers(): OpsVistaUser[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(USERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OpsVistaUser[];
    return parsed.map(cloneUser);
  } catch {
    return [];
  }
}

export function persistManagedUsers(users: OpsVistaUser[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export function loadManagementAudit(): ManagementAuditEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(AUDIT_KEY);
    return raw ? JSON.parse(raw) as ManagementAuditEvent[] : [];
  } catch {
    return [];
  }
}

export function persistManagementAudit(events: ManagementAuditEvent[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(AUDIT_KEY, JSON.stringify(events.slice(0, 1000)));
}

function grantMap(user: OpsVistaUser) {
  const grants = user.locationGrants?.length
    ? user.locationGrants
    : user.locations.map((location, index) => ({ location, type: index === 0 ? 'Primary' : 'Additional' } as LocationAccessGrant));
  return new Map(grants.map(grant => [grant.location, grant]));
}

function value(value?: string) { return value || '—'; }

export function diffUserChanges(before: OpsVistaUser, after: OpsVistaUser, actor: OpsVistaUser, reason: string): ManagementAuditEvent[] {
  const now = new Date().toISOString();
  const base = {
    at: now,
    actorId: actor.id,
    actorName: actor.name,
    targetUserId: after.id,
    targetUserName: after.name,
    reason,
  };
  const events: ManagementAuditEvent[] = [];
  const add = (event: Omit<ManagementAuditEvent, 'id' | keyof typeof base>) => events.push({
    ...base,
    ...event,
    id: `mgmt-${Date.now()}-${events.length}-${Math.random().toString(36).slice(2,7)}`,
  });

  if (before.active !== after.active) add({ action: after.active ? 'User activated' : 'User deactivated', before: String(before.active), after: String(after.active) });
  if (before.role !== after.role) add({ action:'Role changed', before:before.role, after:after.role });
  if (before.title !== after.title) add({ action:'Title changed', before:value(before.title), after:value(after.title) });

  const beforeGrants = grantMap(before);
  const afterGrants = grantMap(after);
  const allLocations = new Set([...beforeGrants.keys(), ...afterGrants.keys()]);

  for (const location of allLocations) {
    const oldGrant = beforeGrants.get(location);
    const newGrant = afterGrants.get(location);
    if (!oldGrant && newGrant) {
      add({ action:newGrant.type === 'Primary' ? 'Primary location changed' : 'Additional location granted', location, before:'No access', after:newGrant.type });
      continue;
    }
    if (oldGrant && !newGrant) {
      add({ action:'Additional location revoked', location, before:oldGrant.type, after:'No access' });
      continue;
    }
    if (!oldGrant || !newGrant) continue;
    if (oldGrant.type !== newGrant.type) {
      add({ action:'Primary location changed', location, before:oldGrant.type, after:newGrant.type });
    }
    if (value(oldGrant.expiresAt) !== value(newGrant.expiresAt)) {
      add({ action:'Additional access expiration changed', location, before:value(oldGrant.expiresAt), after:value(newGrant.expiresAt) });
    }
    if (value(oldGrant.note) !== value(newGrant.note)) {
      add({ action:'Access note changed', location, before:value(oldGrant.note), after:value(newGrant.note) });
    }
  }

  return events;
}

export function expireAccessGrants(users: OpsVistaUser[], actorName = 'OpsVista Automation', now = new Date()) {
  const events: ManagementAuditEvent[] = [];
  const nextUsers = users.map(user => {
    if (!user.locationGrants?.length) return user;
    const expired = user.locationGrants.filter(grant => grant.type === 'Additional' && grant.expiresAt && new Date(grant.expiresAt).getTime() <= now.getTime());
    if (!expired.length) return user;
    const remaining = user.locationGrants.filter(grant => !expired.includes(grant));
    for (const grant of expired) events.push({
      id:`mgmt-auto-${Date.now()}-${events.length}`,
      at:now.toISOString(),
      actorId:'system',
      actorName,
      targetUserId:user.id,
      targetUserName:user.name,
      action:'Additional location revoked',
      location:grant.location,
      before:`Additional until ${grant.expiresAt}`,
      after:'No access',
      reason:'Temporary location access expired automatically.',
      automatic:true,
    });
    return { ...user, locations:remaining.map(grant => grant.location), locationGrants:remaining };
  });
  return { users:nextUsers, events };
}
