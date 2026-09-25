import type { ActionRecord } from './actionCenterTypes';

export const actionOwnerKey = (action: Pick<ActionRecord, 'ownerId' | 'ownerName'>) => action.ownerId || (action.ownerName ? `name:${action.ownerName}` : '__unassigned');
export const actionIsOpen = (action: Pick<ActionRecord, 'status'>) => !['Completed', 'Dismissed'].includes(action.status);
export const actionIsOverdue = (action: Pick<ActionRecord, 'status' | 'dueAt'>, today: string) => actionIsOpen(action) && Boolean(action.dueAt) && action.dueAt!.slice(0, 10) < today;
export type AssignmentSummary = {
  key: string; name: string; title: string; locations: string[]; pending: number; overdue: number;
  noDate: number; investigating: number; completed: number; verified: number; nextDue: string;
};

export function summarizeAssignments(actions: ActionRecord[], people: { id: string; name: string; title: string }[], today: string): AssignmentSummary[] {
  const directory = new Map(people.map(person => [person.id, person]));
  const groups = new Map<string, AssignmentSummary>();
  for (const action of actions) {
    if (action.status === 'Dismissed') continue;
    const key = actionOwnerKey(action);
    const person = action.ownerId ? directory.get(action.ownerId) : undefined;
    const row = groups.get(key) || { key, name: person?.name || action.ownerName || 'Sin asignar', title: person?.title || (key === '__unassigned' ? 'Requiere responsable' : 'Responsable de seguimiento'), locations: [], pending: 0, overdue: 0, noDate: 0, investigating: 0, completed: 0, verified: 0, nextDue: '' };
    if (!row.locations.includes(action.location)) row.locations.push(action.location);
    if (actionIsOpen(action)) {
      row.pending++;
      if (actionIsOverdue(action, today)) row.overdue++;
      if (!action.dueAt) row.noDate++;
      if (action.status === 'Investigating') row.investigating++;
      if (action.dueAt && (!row.nextDue || action.dueAt < row.nextDue)) row.nextDue = action.dueAt.slice(0, 10);
    } else if (action.status === 'Completed') {
      row.completed++;
      if (action.verificationStatus === 'Worked') row.verified++;
    }
    groups.set(key, row);
  }
  return [...groups.values()].sort((a, b) => b.overdue - a.overdue || b.pending - a.pending || a.name.localeCompare(b.name));
}
