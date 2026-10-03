export type NativeTaskStatus = 'Open' | 'Completed' | 'Archived';
export type NativeTaskPriority = 'High' | 'Medium' | 'Low';
export type NativeTaskPerson = { id: string; name: string; role: string; locations: string[]; allLocations: boolean };
export type NativeTaskStep = { id: string; label: string; completed: boolean; completedBy?: string; completedAt?: string };
export type NativeTaskDefinition = {
  title: string; description: string; location: string; category: string; position: string;
  ownerId: string; ownerName: string; dueDate: string; priority: NativeTaskPriority; steps: NativeTaskStep[];
};
export type NativeTask = NativeTaskDefinition & {
  id: string; organizationId: string; status: NativeTaskStatus; version: number;
  createdById: string; createdByName: string; createdAt: string; updatedAt: string;
  completedBy: string; completedAt: string;
};
export type NativeTaskAudit = { id: string; at: string; actorName: string; event: string; note: string };
export type TaskIdentity = { id: string; role: string; locations: string[]; organizationId?: string };

export const nativeTaskManagers = ['Founder', 'Corporate', 'Location Manager', 'Kitchen'];
export const nativeTaskReaders = [...nativeTaskManagers, 'Maintenance'];
export const taskOrganization = (user: TaskIdentity) => user.organizationId || 'org-puerto-vallarta';
export const canManageNativeTasks = (user: TaskIdentity) => nativeTaskManagers.includes(user.role);
export const canReadNativeTasks = (user: TaskIdentity) => nativeTaskReaders.includes(user.role);
export const nativeTaskGlobalRole = (role: string) => ['Founder', 'Corporate', 'Maintenance'].includes(role);
export const nativeTaskLocationAllowed = (user: TaskIdentity, location: string) => nativeTaskGlobalRole(user.role) || user.locations.includes(location);
export const canSeeNativeTask = (user: TaskIdentity, task: NativeTask) => canReadNativeTasks(user) && task.organizationId === taskOrganization(user) && nativeTaskLocationAllowed(user, task.location);
export const canWorkNativeTask = (user: TaskIdentity, task: NativeTask) => canSeeNativeTask(user, task) && (canManageNativeTasks(user) || task.ownerId === user.id);
export const nativeTaskOverdue = (task: Pick<NativeTask, 'status' | 'dueDate'>, today: string) => task.status === 'Open' && Boolean(task.dueDate) && task.dueDate < today;

export class NativeTaskError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function text(value: unknown, max: number, label: string, required = false) {
  if (value !== undefined && typeof value !== 'string') throw new NativeTaskError(400, `${label}: valor inválido.`);
  const result = (value as string | undefined)?.trim() || '';
  if (required && !result) throw new NativeTaskError(400, `${label} es obligatorio.`);
  if (result.length > max) throw new NativeTaskError(400, `${label}: máximo ${max} caracteres.`);
  return result;
}

export function parseNativeTaskDefinition(input: Record<string, unknown>, existing?: NativeTask): NativeTaskDefinition {
  const dueDate = text(input.dueDate, 10, 'Fecha');
  if (dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !Number.isFinite(Date.parse(`${dueDate}T12:00:00Z`)) || new Date(`${dueDate}T12:00:00Z`).toISOString().slice(0, 10) !== dueDate)) {
    throw new NativeTaskError(400, 'Selecciona una fecha válida.');
  }
  const priority = input.priority;
  if (!['High', 'Medium', 'Low'].includes(String(priority))) throw new NativeTaskError(400, 'Selecciona una prioridad válida.');
  if (!Array.isArray(input.steps) || input.steps.length > 50) throw new NativeTaskError(400, 'La checklist puede tener hasta 50 pasos.');
  const ids = new Set<string>();
  const steps = input.steps.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new NativeTaskError(400, 'Paso de checklist inválido.');
    const row = value as Record<string, unknown>;
    const id = text(row.id, 64, 'Identificador del paso', true);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) throw new NativeTaskError(400, 'Los pasos deben tener identificadores únicos.');
    ids.add(id);
    const label = text(row.label, 300, 'Nombre del paso', true);
    const previous = existing?.steps.find(step => step.id === id && step.label === label);
    // Editing a label changes the work requested; it must be checked again.
    return previous ? { ...previous } : { id, label, completed: false };
  });
  return {
    title: text(input.title, 160, 'Nombre de la tarea', true),
    description: text(input.description, 3000, 'Instrucciones'),
    location: text(input.location, 120, 'Locación', true),
    category: text(input.category, 80, 'Área o categoría', true),
    position: text(input.position, 120, 'Puesto o equipo'),
    ownerId: text(input.ownerId, 120, 'Responsable'), ownerName: '', dueDate,
    priority: priority as NativeTaskPriority, steps,
  };
}
