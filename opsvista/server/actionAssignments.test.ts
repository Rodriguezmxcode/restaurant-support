import test from 'node:test';
import assert from 'node:assert/strict';
import { actionIsOverdue, summarizeAssignments } from '../src/actionAssignments.js';
import type { ActionRecord } from '../src/actionCenterTypes.js';

const action = (input: Partial<ActionRecord>): ActionRecord => ({ id: 'a', title: 'Task', location: 'Orange', category: 'Operations', severity: 'Medium', status: 'Assigned', signal: '', cause: '', recommendation: '', impact: '', automated: false, priorityScore: 1, sources: [], sourceIds: [], verificationStatus: 'Pending', createdAt: '', updatedAt: '', ...input });
test('corporate counts distinguish overdue, undated, completed, verified and dismissed actions', () => {
  const rows = [action({ ownerId: 'a', ownerName: 'Manager', dueAt: '2026-09-06' }), action({ ownerId: 'a', dueAt: '2026-09-07', status: 'Investigating' }), action({ ownerId: 'a' }), action({ ownerId: 'a', dueAt: '2026-01-01', status: 'Completed', verificationStatus: 'Worked' }), action({ ownerId: 'a', status: 'Completed' }), action({ ownerId: 'a', status: 'Dismissed' })];
  const [row] = summarizeAssignments(rows, [{ id: 'a', name: 'Manager', title: 'Location Manager' }], '2026-09-07');
  assert.equal(row.pending, 3); assert.equal(row.overdue, 1); assert.equal(row.noDate, 1); assert.equal(row.investigating, 1); assert.equal(row.completed, 2); assert.equal(row.verified, 1);
  assert.equal(actionIsOverdue(rows[1], '2026-09-07'), false);
});
test('same-name owners stay distinct; a named legacy owner is not counted as unassigned', () => {
  const rows = summarizeAssignments([action({ ownerId: '1', ownerName: 'Alex' }), action({ ownerId: '2', ownerName: 'Alex' }), action({ ownerName: 'Legacy manager' }), action({})], [], '2026-09-07');
  assert.equal(rows.length, 4); assert.equal(rows.find(row => row.key === '__unassigned')?.pending, 1); assert.equal(rows.find(row => row.key === 'name:Legacy manager')?.pending, 1);
});
