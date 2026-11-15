import test from 'node:test';
import assert from 'node:assert/strict';
import { queueManagement } from '../public/stage-controls.js';

const step = (direction) => ({ kind: 'program', payload: { action: 'navigate', direction } });
const pick = (id) => ({ kind: 'program', payload: { action: 'select', id } });

test('programme steps pressed while a save is in flight are kept in order', () => {
  let queue = [];
  queue = queueManagement(queue, step(1));
  queue = queueManagement(queue, step(1));
  queue = queueManagement(queue, step(-1));
  assert.deepEqual(queue.map((item) => item.payload.direction), [1, 1, -1]);
});

test('choosing a programme directly replaces steps that were already queued', () => {
  const queue = queueManagement([step(1), step(1)], pick('program-4'));
  assert.deepEqual(queue, [pick('program-4')]);
  const after = queueManagement(queue, step(1));
  assert.deepEqual(after.map((item) => item.payload.action), ['select', 'navigate']);
});

test('saves, deletes and reorders are not queued behind an in-flight edit', () => {
  const queue = [step(1)];
  for (const action of ['save', 'delete', 'reorder', 'slot']) {
    assert.equal(queueManagement(queue, { kind: 'program', payload: { action } }), queue);
  }
});

test('the step queue stops growing after 30 so a stuck key cannot run away', () => {
  let queue = [];
  for (let i = 0; i < 40; i += 1) queue = queueManagement(queue, step(1));
  assert.equal(queue.length, 30);
});
