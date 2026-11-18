import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { nativeTaskRequest, type NativeTaskRepository, type TaskActor } from './nativeTaskService.js';
import { NativeTaskError, type NativeTask, type NativeTaskPerson } from '../shared/nativeTasks.js';

const manager: TaskActor = { id: 'manager-a', name: 'Manager A', role: 'Location Manager', organizationId: 'org-a', locations: ['Orange'] };
const corporate: TaskActor = { id: 'corporate-a', name: 'Corporate', role: 'Corporate', organizationId: 'org-a', locations: [] };
const maintenance: TaskActor = { id: 'maintenance-a', name: 'Maintenance', role: 'Maintenance', organizationId: 'org-a', locations: [] };
const places = ['Orange', 'Avon'];
const input = () => ({ requestId: randomUUID(), title: 'Revisar refrigerador', description: 'Verificar temperatura', location: 'Orange', category: 'Mantenimiento', position: 'Cocina', priority: 'High', dueDate: '2026-09-09', ownerId: manager.id, steps: [{ id: 'temperature', label: 'Medir temperatura' }] });

function fixture() {
  const records = new Map<string, NativeTask>();
  let writes = 0;
  const people: NativeTaskPerson[] = [
    { ...manager, allLocations: false }, { ...corporate, allLocations: true }, { ...maintenance, allLocations: true },
    { id: 'manager-avon', name: 'Avon manager', role: 'Location Manager', locations: ['Avon'], allLocations: false },
  ];
  const repository: NativeTaskRepository = {
    async list() { return { tasks: [...records.values()], hasMore: false }; },
    async get(id) { return records.get(id) || null; },
    async audit() { return []; },
    async people() { return people; },
    async create(definition, requestId, user) {
      const id = `NT-${requestId}`;
      if (records.has(id)) return records.get(id)!;
      writes++;
      const task: NativeTask = { ...definition, id, organizationId: user.organizationId!, status: 'Open', version: 1, createdById: user.id, createdByName: user.name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: '', completedBy: '' };
      records.set(id, structuredClone(task)); return task;
    },
    async update(task, version) {
      if (records.get(task.id)?.version !== version) throw new NativeTaskError(409, 'Concurrent change');
      writes++; const next = { ...task, version: version + 1 }; records.set(task.id, structuredClone(next)); return next;
    },
  };
  const request = (method: string, body: Record<string, unknown> = {}, user = manager, query: Record<string, string> = {}) => nativeTaskRequest(method, query, body, user, repository, places);
  const create = async (body = input()) => (await request('POST', body)).body.task as NativeTask;
  return { records, repository, request, create, writes: () => writes };
}
const rejectsWith = (operation: Promise<unknown>, status: number) => assert.rejects(operation, error => error instanceof NativeTaskError && error.status === status);

test('manager creates a custom task, progress survives a subsequent read, and task closes only after all steps', async () => {
  const f = fixture(); const task = await f.create();
  assert.equal(task.ownerName, manager.name);
  await rejectsWith(f.request('PUT', { id: task.id, version: 1, action: 'complete' }), 400);
  await f.request('PUT', { id: task.id, version: 1, action: 'check', stepId: 'temperature', completed: true });
  const read = (await f.request('GET', {}, manager, { id: task.id })).body.task as NativeTask;
  assert.equal(read.steps[0].completedBy, manager.name);
  const completed = (await f.request('PUT', { id: task.id, version: 2, action: 'complete' })).body.task as NativeTask;
  assert.equal(completed.status, 'Completed'); assert.equal(completed.completedBy, manager.name);
});

test('creation cannot forge completed steps, status, audit author, or assignee name', async () => {
  const f = fixture(); const task = await f.create({ ...input(), ownerName: 'Forged', status: 'Completed', createdByName: 'Forged', steps: [{ id: 'temperature', label: 'Medir temperatura', completed: true, completedBy: 'Forged' }] } as ReturnType<typeof input>);
  assert.equal(task.status, 'Open'); assert.equal(task.createdByName, manager.name); assert.equal(task.ownerName, manager.name); assert.equal(task.steps[0].completed, false);
});

test('manager cannot create or move tasks to another location', async () => {
  const f = fixture(); await rejectsWith(f.create({ ...input(), location: 'Avon', ownerId: '' }), 403);
  const task = await f.create(); await rejectsWith(f.request('PUT', { ...input(), id: task.id, version: 1, action: 'edit', location: 'Avon', ownerId: '' }), 403);
  assert.equal(f.records.get(task.id)?.location, 'Orange');
});

test('cross-organization and cross-location records cannot be read or mutated even if repository returns them', async () => {
  const f = fixture(); const task = await f.create();
  for (const user of [{ ...manager, organizationId: 'org-b' }, { ...manager, locations: ['Avon'] }]) {
    await rejectsWith(f.request('GET', {}, user, { id: task.id }), 404);
    await rejectsWith(f.request('PUT', { id: task.id, version: 1, action: 'archive' }, user), 404);
    assert.deepEqual((await f.request('GET', {}, user)).body.tasks, []);
  }
});

test('HR has no Tasks access; maintenance can only complete its assigned work', async () => {
  const f = fixture(); const task = await f.create();
  await rejectsWith(f.request('GET', {}, { ...corporate, role: 'HR' }), 403);
  await rejectsWith(f.request('POST', input(), maintenance), 403);
  await rejectsWith(f.request('PUT', { id: task.id, version: 1, action: 'check', stepId: 'temperature', completed: true }, maintenance), 403);
  await f.request('PUT', { ...input(), id: task.id, version: 1, action: 'edit', ownerId: maintenance.id });
  await f.request('PUT', { id: task.id, version: 2, action: 'check', stepId: 'temperature', completed: true }, maintenance);
  await rejectsWith(f.request('PUT', { id: task.id, version: 3, action: 'archive' }, maintenance), 403);
});

test('assignee must be active, in the organization directory, and allowed at the location', async () => {
  const f = fixture();
  for (const ownerId of ['not-in-directory', 'manager-avon']) await rejectsWith(f.create({ ...input(), ownerId }), 400);
  assert.equal(f.writes(), 0);
});

test('definition edits preserve unchanged completed steps and reset changed/new steps', async () => {
  const f = fixture(); const task = await f.create();
  await f.request('PUT', { id: task.id, version: 1, action: 'check', stepId: 'temperature', completed: true });
  const same = (await f.request('PUT', { ...input(), id: task.id, version: 2, action: 'edit', title: 'Otro título' })).body.task as NativeTask;
  assert.equal(same.steps[0].completed, true);
  const edited = (await f.request('PUT', { ...input(), id: task.id, version: 3, action: 'edit', steps: [{ id: 'temperature', label: 'Medir temperatura de nuevo' }, { id: 'new', label: 'Limpiar' }] })).body.task as NativeTask;
  assert.equal(edited.steps[0].completed, false); assert.equal(edited.steps[1].completed, false);
});

test('invalid dates, duplicate step IDs, empty titles, and oversized checklists are rejected', async () => {
  const f = fixture();
  for (const patch of [{ dueDate: '2026-02-30' }, { dueDate: 'nonsense' }, { title: '   ' }, { steps: Array.from({ length: 51 }, (_, n) => ({ id: `s${n}`, label: 'Step' })) }, { steps: [{ id: 'same', label: 'One' }, { id: 'same', label: 'Two' }] }]) await rejectsWith(f.create({ ...input(), ...patch }), 400);
  assert.equal(f.writes(), 0);
});

test('stale updates are rejected without losing the other person’s progress', async () => {
  const f = fixture(); const task = await f.create();
  await f.request('PUT', { id: task.id, version: 1, action: 'check', stepId: 'temperature', completed: true });
  await rejectsWith(f.request('PUT', { ...input(), id: task.id, version: 1, action: 'edit' }), 409);
  assert.equal(f.records.get(task.id)?.steps[0].completed, true);
});

test('archiving retains the record and a manager can restore it', async () => {
  const f = fixture(); const task = await f.create();
  await f.request('PUT', { id: task.id, version: 1, action: 'archive' });
  await rejectsWith(f.request('PUT', { id: task.id, version: 2, action: 'check', stepId: 'temperature', completed: true }), 409);
  await f.request('PUT', { id: task.id, version: 2, action: 'reopen' });
  assert.equal(f.records.get(task.id)?.status, 'Open');
});
