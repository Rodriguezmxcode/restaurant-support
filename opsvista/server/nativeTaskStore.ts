import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { listManagedUsers } from './managementStore.js';
import { getOrganizationMembership } from './organizationStore.js';
import {
  nativeTaskGlobalRole, nativeTaskReaders, taskOrganization, NativeTaskError, canSeeNativeTask,
  type NativeTask, type NativeTaskAudit, type NativeTaskPerson,
} from '../shared/nativeTasks.js';
import type { NativeTaskRepository, TaskActor } from './nativeTaskService.js';

let client: ReturnType<typeof postgres> | undefined;
let ready: Promise<void> | undefined;
function db() {
  const url = process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL;
  if (!url) throw new Error('OpsVista database is unavailable');
  return client ??= postgres(url, { max: 4, idle_timeout: 20, connect_timeout: 10 });
}
async function schema() {
  if (!ready) ready = (async () => {
    await db()`create table if not exists opsvista_native_tasks (
      id text primary key, organization_id text not null, location text not null,
      definition jsonb not null, status text not null default 'Open' check (status in ('Open','Completed','Archived')),
      version integer not null default 1, created_by_id text not null, created_by_name text not null,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      completed_at text not null default '', completed_by text not null default ''
    )`;
    await db()`create table if not exists opsvista_native_task_audit (
      id text primary key, task_id text not null references opsvista_native_tasks(id), organization_id text not null,
      at timestamptz not null default now(), actor_id text not null, actor_name text not null,
      event text not null, note text not null, snapshot jsonb not null
    )`;
    await db()`create index if not exists opsvista_native_tasks_scope_idx on opsvista_native_tasks(organization_id,location,status,updated_at desc)`;
    await db()`create index if not exists opsvista_native_task_audit_scope_idx on opsvista_native_task_audit(organization_id,task_id,at desc)`;
  })().catch(error => { ready = undefined; throw error; });
  await ready;
}
function normalize(row: Record<string, unknown>): NativeTask {
  return {
    ...(row.definition as NativeTask), id: String(row.id), organizationId: String(row.organization_id), location: String(row.location),
    status: row.status as NativeTask['status'], version: Number(row.version),
    createdById: String(row.created_by_id), createdByName: String(row.created_by_name),
    createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(),
    completedAt: String(row.completed_at || ''), completedBy: String(row.completed_by || ''),
  };
}
function definition(task: NativeTask) {
  const { title, description, location, category, position, ownerId, ownerName, dueDate, priority, steps } = task;
  return { title, description, location, category, position, ownerId, ownerName, dueDate, priority, steps };
}

export const nativeTaskRepository: NativeTaskRepository = {
  async list(user, location) {
    await schema();
    const rows = await db()`select * from opsvista_native_tasks where organization_id=${taskOrganization(user)}
      and (${nativeTaskGlobalRole(user.role)} or location=any(${user.locations}::text[]))
      and (${!location} or location=${location || ''})
      order by case status when 'Open' then 0 when 'Completed' then 1 else 2 end,updated_at desc limit 1001`;
    return { tasks: rows.slice(0, 1000).map(normalize), hasMore: rows.length > 1000 };
  },
  async get(id, user) {
    await schema();
    const rows = await db()`select * from opsvista_native_tasks where id=${id} and organization_id=${taskOrganization(user)}
      and (${nativeTaskGlobalRole(user.role)} or location=any(${user.locations}::text[])) limit 1`;
    return rows[0] ? normalize(rows[0]) : null;
  },
  async audit(id, user): Promise<NativeTaskAudit[]> {
    await schema();
    const rows = await db()`select a.* from opsvista_native_task_audit a join opsvista_native_tasks t on t.id=a.task_id
      where a.task_id=${id} and a.organization_id=${taskOrganization(user)}
      and (${nativeTaskGlobalRole(user.role)} or t.location=any(${user.locations}::text[])) order by a.at desc limit 100`;
    return rows.map(row => ({ id: String(row.id), at: new Date(String(row.at)).toISOString(), actorName: String(row.actor_name), event: String(row.event), note: String(row.note) }));
  },
  async people(user): Promise<NativeTaskPerson[]> {
    // Initialize the existing organization directory once before parallel membership reads.
    await getOrganizationMembership(user.id);
    const candidates = (await listManagedUsers()).filter(person => person.active && nativeTaskReaders.includes(person.role));
    const people = await Promise.all(candidates.map(async (person): Promise<NativeTaskPerson | null> => {
      const organizationId = person.id === user.id ? taskOrganization(user) : (await getOrganizationMembership(person.id))?.organizationId;
      if (organizationId !== taskOrganization(user)) return null;
      const grants = person.locationGrants?.length ? person.locationGrants : person.locations.map(location => ({ location, expiresAt: undefined }));
      const locations = grants.filter(grant => !grant.expiresAt || Date.parse(grant.expiresAt) > Date.now()).map(grant => grant.location);
      const allLocations = nativeTaskGlobalRole(person.role);
      if (!nativeTaskGlobalRole(user.role) && !allLocations && !locations.some(location => user.locations.includes(location))) return null;
      return { id: person.id, name: person.name, role: person.role, locations, allLocations };
    }));
    return people.filter((person): person is NativeTaskPerson => person !== null);
  },
  async create(input, requestId, user) {
    await schema();
    const id = `NT-${requestId}`;
    return db().begin(async tx => {
      const rows = await tx`insert into opsvista_native_tasks(id,organization_id,location,definition,created_by_id,created_by_name)
        values(${id},${taskOrganization(user)},${input.location},${tx.json(input)},${user.id},${user.name}) on conflict(id) do nothing returning *`;
      if (!rows[0]) {
        const existing = await tx`select * from opsvista_native_tasks where id=${id} and organization_id=${taskOrganization(user)} and created_by_id=${user.id}`;
        if (!existing[0]) throw new NativeTaskError(409, 'No se pudo reutilizar esta solicitud. Abre un formulario nuevo.');
        const recovered = normalize(existing[0]);
        if (!canSeeNativeTask(user, recovered)) throw new NativeTaskError(404, 'Tarea no encontrada.');
        if (JSON.stringify(definition(recovered)) !== JSON.stringify(input)) throw new NativeTaskError(409, 'Esta solicitud ya se guardó. Actualiza la lista para editar la tarea existente.');
        return recovered;
      }
      await tx`insert into opsvista_native_task_audit(id,task_id,organization_id,actor_id,actor_name,event,note,snapshot)
        values(${randomUUID()},${id},${taskOrganization(user)},${user.id},${user.name},'Tarea creada',${input.title},${tx.json(input)})`;
      return normalize(rows[0]);
    });
  },
  async update(task, expectedVersion, event, note, user) {
    await schema();
    return db().begin(async tx => {
      const rows = await tx`update opsvista_native_tasks set location=${task.location},definition=${tx.json(definition(task))},
        status=${task.status},version=version+1,updated_at=now(),completed_at=${task.completedAt},completed_by=${task.completedBy}
        where id=${task.id} and organization_id=${taskOrganization(user)} and version=${expectedVersion}
        and (${nativeTaskGlobalRole(user.role)} or location=any(${user.locations}::text[])) returning *`;
      if (!rows[0]) throw new NativeTaskError(409, 'Otra persona actualizó esta tarea. Actualiza la lista antes de guardar.');
      await tx`insert into opsvista_native_task_audit(id,task_id,organization_id,actor_id,actor_name,event,note,snapshot)
        values(${randomUUID()},${task.id},${taskOrganization(user)},${user.id},${user.name},${event},${note},${tx.json({ ...definition(task), status: task.status })})`;
      return normalize(rows[0]);
    });
  },
};
