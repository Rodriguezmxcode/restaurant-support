import {
  canManageNativeTasks, canReadNativeTasks, canSeeNativeTask, canWorkNativeTask,
  nativeTaskLocationAllowed, NativeTaskError, parseNativeTaskDefinition,
  type NativeTask, type NativeTaskAudit, type NativeTaskDefinition, type NativeTaskPerson, type TaskIdentity,
} from '../shared/nativeTasks.js';

export type TaskActor = TaskIdentity & { name: string };
export type NativeTaskRepository = {
  list: (user: TaskActor, location?: string) => Promise<{ tasks: NativeTask[]; hasMore: boolean }>;
  get: (id: string, user: TaskActor) => Promise<NativeTask | null>;
  audit: (id: string, user: TaskActor) => Promise<NativeTaskAudit[]>;
  people: (user: TaskActor) => Promise<NativeTaskPerson[]>;
  create: (definition: NativeTaskDefinition, requestId: string, user: TaskActor) => Promise<NativeTask>;
  update: (task: NativeTask, expectedVersion: number, event: string, note: string, user: TaskActor) => Promise<NativeTask>;
};

export async function nativeTaskRequest(
  method: string, query: Record<string, string | string[]>, body: Record<string, unknown>,
  user: TaskActor, repository: NativeTaskRepository, knownLocations: string[],
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!canReadNativeTasks(user)) throw new NativeTaskError(403, 'Tu perfil no tiene acceso a Tasks.');
  if (!['GET', 'POST', 'PUT'].includes(method)) throw new NativeTaskError(405, 'Método no permitido.');
  if (method === 'GET') {
    const id = typeof query.id === 'string' ? query.id : '';
    if (id) {
      const task = await repository.get(id, user);
      if (!task || !canSeeNativeTask(user, task)) throw new NativeTaskError(404, 'Tarea no encontrada.');
      return { status: 200, body: { task, audit: await repository.audit(id, user) } };
    }
    const location = typeof query.location === 'string' ? query.location : '';
    if (location && (!knownLocations.includes(location) || !nativeTaskLocationAllowed(user, location))) throw new NativeTaskError(403, 'Locación no autorizada.');
    const [result, people] = await Promise.all([repository.list(user, location), repository.people(user)]);
    return { status: 200, body: { ...result, tasks: result.tasks.filter(task => canSeeNativeTask(user, task)), people, canManage: canManageNativeTasks(user) } };
  }

  if (method === 'POST' || body.action === 'edit') {
    if (!canManageNativeTasks(user)) throw new NativeTaskError(403, 'Solo los gerentes y corporativo pueden crear o editar tareas.');
  }
  if (method === 'POST') {
    if (typeof body.requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.requestId)) throw new NativeTaskError(400, 'Identificador de solicitud inválido.');
    const definition = parseNativeTaskDefinition(body);
    await validateAssignment(definition, user, repository, knownLocations);
    return { status: 201, body: { task: await repository.create(definition, body.requestId, user) } };
  }

  if (typeof body.id !== 'string' || !Number.isInteger(body.version) || Number(body.version) < 1) throw new NativeTaskError(400, 'Falta identificar la tarea y su versión.');
  const existing = await repository.get(body.id, user);
  if (!existing || !canSeeNativeTask(user, existing)) throw new NativeTaskError(404, 'Tarea no encontrada.');
  if (!canWorkNativeTask(user, existing)) throw new NativeTaskError(403, 'Solo el responsable o un gerente autorizado puede actualizar esta tarea.');
  if (existing.version !== body.version) throw new NativeTaskError(409, 'Otra persona actualizó esta tarea. Actualiza la lista antes de guardar.');
  let next: NativeTask = { ...existing, steps: existing.steps.map(step => ({ ...step })) };
  let event = '';
  let note = '';
  if (body.action === 'edit') {
    if (existing.status !== 'Open') throw new NativeTaskError(409, 'Reabre la tarea antes de editarla.');
    const definition = parseNativeTaskDefinition(body, existing);
    await validateAssignment(definition, user, repository, knownLocations);
    next = { ...next, ...definition };
    event = 'Tarea editada'; note = `${definition.title} · ${definition.ownerName || 'Sin asignar'}`;
  } else if (body.action === 'check') {
    if (existing.status !== 'Open') throw new NativeTaskError(409, 'Reabre la tarea antes de cambiar sus pasos.');
    const step = next.steps.find(item => item.id === body.stepId);
    if (!step || typeof body.completed !== 'boolean') throw new NativeTaskError(400, 'Paso de checklist inválido.');
    step.completed = body.completed;
    step.completedBy = body.completed ? user.name : undefined;
    step.completedAt = body.completed ? new Date().toISOString() : undefined;
    event = body.completed ? 'Paso completado' : 'Paso reabierto'; note = step.label;
  } else if (body.action === 'complete') {
    if (existing.status !== 'Open') throw new NativeTaskError(409, 'La tarea ya no está abierta.');
    if (next.steps.some(step => !step.completed)) throw new NativeTaskError(400, 'Completa todos los pasos antes de cerrar la tarea.');
    next.status = 'Completed'; next.completedAt = new Date().toISOString(); next.completedBy = user.name;
    event = 'Tarea completada';
  } else if (body.action === 'reopen' || body.action === 'archive') {
    if (!canManageNativeTasks(user)) throw new NativeTaskError(403, 'Solo los gerentes y corporativo pueden reabrir o archivar tareas.');
    if (body.action === 'reopen') {
      next.status = 'Open'; next.completedAt = ''; next.completedBy = ''; event = 'Tarea reabierta';
    } else { next.status = 'Archived'; event = 'Tarea archivada'; }
  } else throw new NativeTaskError(400, 'Acción de tarea inválida.');
  return { status: 200, body: { task: await repository.update(next, existing.version, event, note, user) } };
}

async function validateAssignment(definition: NativeTaskDefinition, user: TaskActor, repository: NativeTaskRepository, knownLocations: string[]) {
  if (!knownLocations.includes(definition.location) || !nativeTaskLocationAllowed(user, definition.location)) throw new NativeTaskError(403, 'No puedes crear o mover tareas a esta locación.');
  if (!definition.ownerId) return;
  const owner = (await repository.people(user)).find(person => person.id === definition.ownerId && (person.allLocations || person.locations.includes(definition.location)));
  if (!owner) throw new NativeTaskError(400, 'Selecciona un responsable activo con acceso a esa locación.');
  definition.ownerName = owner.name;
}
