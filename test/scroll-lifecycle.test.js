import test from 'node:test';
import assert from 'node:assert/strict';
import { programScrollKey, shouldArmScrollExit } from '../public/program-renderer.js';

test('switching programmes changes the scroll identity even when the words match', () => {
  const words = '高一（1）班 张三、李四';
  assert.notEqual(programScrollKey('program-1', words), programScrollKey('program-2', words));
  assert.equal(programScrollKey('program-1', words), programScrollKey('program-1', words));
  assert.notEqual(programScrollKey('program-1', words), programScrollKey('program-1', words + '。'));
  assert.equal(programScrollKey(undefined, ''), programScrollKey(undefined, ''));
});

test('the exit timer is armed once and later echoes do not re-arm it', () => {
  assert.equal(shouldArmScrollExit({ visible: true, shown: true, running: true, exitArmed: false }), false);
  assert.equal(shouldArmScrollExit({ visible: false, shown: true, running: true, exitArmed: false }), true, 'hide arms the stop');
  assert.equal(shouldArmScrollExit({ visible: false, shown: false, running: true, exitArmed: true }), false, 'a state echo keeps the original deadline');
  assert.equal(shouldArmScrollExit({ visible: false, shown: false, running: false, exitArmed: false }), false, 'already stopped');
  assert.equal(shouldArmScrollExit({ visible: false, shown: false, running: true, exitArmed: false }), true, 'still running with no timer gets one');
});
