import type { ActionRecord } from './actionCenterTypes';
import { actionIsOpen, actionIsOverdue, actionOwnerKey } from './actionAssignments';

export type ActionFilters = { status: string; ownership: string; responsibleFilter: string };
type ActionView = ActionFilters & { id: string; en: string; es: string };

export const actionViews: ActionView[] = [
  { id: 'active', en: 'All active', es: 'Todas las activas', status: 'Active', ownership: 'All actions', responsibleFilter: '' },
  { id: 'mine', en: 'My actions', es: 'Mis acciones', status: 'Active', ownership: 'My actions', responsibleFilter: '' },
  { id: 'high', en: 'High priority', es: 'Alta prioridad', status: 'High priority', ownership: 'All actions', responsibleFilter: '' },
  { id: 'overdue', en: 'Overdue', es: 'Vencidas', status: 'Overdue', ownership: 'All actions', responsibleFilter: '' },
  { id: 'unassigned', en: 'Unassigned', es: 'Sin asignar', status: 'Active', ownership: 'All actions', responsibleFilter: '__unassigned' },
  { id: 'history', en: 'History', es: 'Historial', status: 'History', ownership: 'All actions', responsibleFilter: '' },
];

export function matchesActionFilters(action: ActionRecord, filters: ActionFilters, userId: string, today: string) {
  const { status, ownership, responsibleFilter } = filters;
  const matchesStatus = status === 'All'
    || (status === 'Active' ? actionIsOpen(action)
      : status === 'High priority' ? actionIsOpen(action) && action.severity === 'High'
      : status === 'Overdue' ? actionIsOverdue(action, today)
      : status === 'History' ? !actionIsOpen(action)
      : status === 'No date' ? actionIsOpen(action) && !action.dueAt
      : action.status === status);
  return matchesStatus
    && (ownership === 'All actions' || action.ownerId === userId)
    && (!responsibleFilter || actionOwnerKey(action) === responsibleFilter);
}

export function matchesActionSearch(action: ActionRecord, search: string) {
  const query = search.trim().toLowerCase();
  return !query || [action.title, action.location, action.category, action.ownerName,
    action.accountableName, action.accountableRole, action.signal]
    .filter(Boolean).join(' ').toLowerCase().includes(query);
}
