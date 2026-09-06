import type { SessionUser } from './authSession.js';
import type { ActionRecord } from './actionStore.js';
import { dispatchOperationalPush, type OperationalPushInput } from './actionNotificationStore.js';
import { listManagedUsers, type ManagedDirectoryUser } from './managementStore.js';

const corporateObserverIds = new Set(['usr-founder-roberto', 'usr-roberto-ops', 'usr-jacob']);

function currentLocations(user: ManagedDirectoryUser) {
  const now = Date.now();
  const grants = user.locationGrants?.length
    ? user.locationGrants
    : user.locations.map((location,index) => ({ location, type:index === 0 ? 'Primary' as const : 'Additional' as const }));
  return Array.from(new Set(grants.filter(grant => !grant.expiresAt || new Date(grant.expiresAt).getTime() > now).map(grant => grant.location)));
}

export async function operationalRecipientIds(location?: string, ownerId?: string) {
  const directory = (await listManagedUsers()).filter(user => user.active);
  return Array.from(new Set(directory.filter(user =>
    corporateObserverIds.has(user.id) ||
    Boolean(ownerId && user.id === ownerId) ||
    Boolean(location && user.role === 'Location Manager' && currentLocations(user).includes(location))
  ).map(user => user.id)));
}

function categoryForAction(action: ActionRecord): OperationalPushInput['category'] {
  const value = action.category.toLowerCase();
  if (/sales|venta|revenue|upsell/.test(value)) return 'sales';
  if (/labor|overtime/.test(value)) return 'labor';
  if (/task|checklist/.test(value)) return 'tasks';
  if (/maintenance|mantenimiento|repair|facilities/.test(value)) return 'maintenance';
  return 'action';
}

export async function notifyActionObservers(
  action: ActionRecord,
  actor: SessionUser,
  event: 'assigned' | 'accepted' | 'in_progress' | 'evidence' | 'verified',
) {
  const labels = {
    assigned: 'Nueva responsabilidad asignada',
    accepted: 'Responsabilidad aceptada',
    in_progress: 'Trabajo iniciado',
    evidence: 'Evidencia enviada',
    verified: 'Acción verificada',
  } as const;
  const recipients = (await operationalRecipientIds(action.location, action.ownerId)).filter(id => id !== actor.id && (event !== 'assigned' || id !== action.ownerId));
  const owner = action.ownerName || 'Sin responsable';
  return dispatchOperationalPush({
    eventKey: `action:${action.id}:${event}`,
    category: categoryForAction(action),
    location: action.location,
    actionId: action.id,
    title: `${action.location} · ${labels[event]}`,
    body: `${action.title} · ${owner}${event === 'assigned' ? ' debe aceptar la asignación.' : ` · actualizado por ${actor.name}.`}`,
    recipientIds: recipients,
  }, actor);
}

