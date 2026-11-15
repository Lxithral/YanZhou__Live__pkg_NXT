import test from 'node:test';
import assert from 'node:assert/strict';
import { applyManagement, defaultManagement } from '../server/stage-management.js';

const base = () => defaultManagement('program', {});

test('reorder moves items, keeps the selected programme and recomputes next', () => {
  const module = applyManagement(base(), 'program', { action: 'select', id: 'program-3' });
  const ids = module.items.map((item) => item.id);
  const order = [ids[2], ...ids.filter((id) => id !== ids[2])];
  const result = applyManagement(module, 'program', { action: 'reorder', order });
  assert.deepEqual(result.items.map((item) => item.id), order);
  assert.equal(result.selectedId, 'program-3');
  assert.equal(result.current, module.current);
  assert.equal(result.next, result.items[1].title);
  assert.deepEqual(result.items.map((item) => item.number), order.map((_, i) => String(i + 1).padStart(2, '0')), 'numbers follow the new order');
  assert.equal(result.items.find((item) => item.id === 'program-3').number, '01', 'the current programme is renumbered too');
});

test('reorder rejects anything that is not a full permutation of the current list', () => {
  const module = base();
  const ids = module.items.map((item) => item.id);
  for (const order of [ids.slice(1), [...ids.slice(1), ids[1]], [...ids.slice(0, -1), 'nope'], 'x', [...ids, 'extra']]) {
    assert.throws(() => applyManagement(module, 'program', { action: 'reorder', order }));
  }
  assert.throws(() => applyManagement(base(), 'program', { action: 'reorder', order: ids, id: 'x' }));
});

test('reorder is program-only and leaves the input untouched', () => {
  const module = base();
  const before = JSON.stringify(module);
  applyManagement(module, 'program', { action: 'reorder', order: module.items.map((i) => i.id).reverse() });
  assert.equal(JSON.stringify(module), before);
  const hosts = defaultManagement('hosts', {});
  assert.throws(() => applyManagement(hosts, 'hosts', { action: 'reorder', order: hosts.people.map((p) => p.id) }));
});

const make = (numbers) => ({ ...base(), items:numbers.map((number, i) => ({ id:`p${i}`, number, type:'舞蹈', title:`节目${i}`, performer:'', desc:'', cover:'' })), selectedId:'p0' });

test('reorder renumbers duplicates and blanks into a clean sequence', () => {
  const module = make(['01', '07', '07', '', '9']);
  const result = applyManagement(module, 'program', { action:'reorder', order:['p2', 'p0', 'p1', 'p4', 'p3'] });
  assert.deepEqual(result.items.map((item) => [item.id, item.number]), [['p2','01'],['p0','02'],['p1','03'],['p4','04'],['p3','05']]);
  assert.equal(result.selectedId, 'p0');
});

test('reorder uses three digits once there are more than 99 programmes', () => {
  const module = make(Array.from({ length:100 }, () => ''));
  const order = module.items.map((item) => item.id).reverse();
  const result = applyManagement(module, 'program', { action:'reorder', order });
  assert.equal(result.items[0].number, '001');
  assert.equal(result.items.at(-1).number, '100');
});

test('editing or adding a programme never renumbers the others', () => {
  const module = make(['01', '07', '07', '12']);
  const edited = applyManagement(module, 'program', { action:'save', item:{ ...module.items[1], title:'改名' } });
  assert.deepEqual(edited.items.map((item) => item.number), ['01', '07', '07', '12']);
  const added = applyManagement(edited, 'program', { action:'save', item:{ id:'new', number:'', type:'舞蹈', title:'新节目', performer:'', desc:'', cover:'' } });
  assert.deepEqual(added.items.map((item) => item.number), ['01', '07', '07', '12', '']);
});
