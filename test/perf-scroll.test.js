import test from 'node:test';
import assert from 'node:assert/strict';
import { PERF_SCROLL, scrollPlan, startDelay, scrollKeyframes } from '../public/perf-scroll.js';

test('performers that fit in two lines stay still', () => {
  assert.equal(scrollPlan({ contentHeight: 22.5, viewportHeight: 45 }), null);
  assert.equal(scrollPlan({ contentHeight: 45, viewportHeight: 45 }), null);
  assert.equal(scrollPlan({ contentHeight: 45.8, viewportHeight: 45 }), null, '1px tolerance for sub-pixel rounding');
  assert.equal(scrollPlan({ contentHeight: 0, viewportHeight: 45 }), null, 'empty or unmeasured (hidden) content never scrolls');
  assert.equal(scrollPlan({ contentHeight: 90, viewportHeight: 0 }), null);
});

test('overflowing performers scroll one copy plus the gap at a constant speed', () => {
  const plan = scrollPlan({ contentHeight: 90, viewportHeight: 45 });
  assert.equal(plan.distance, 90 + PERF_SCROLL.gap);
  assert.equal(plan.duration, Math.round((90 + PERF_SCROLL.gap) / PERF_SCROLL.speed * 1000));
  const longer = scrollPlan({ contentHeight: 180, viewportHeight: 45 });
  assert.ok(Math.abs(longer.distance / longer.duration - plan.distance / plan.duration) < 1e-4, 'speed does not depend on length');
  assert.deepEqual(scrollPlan({ contentHeight: 67.5, viewportHeight: 45, gap: 10, speed: 25 }), { distance: 77.5, duration: 3100 });
});

test('speed stays readable (20–30 px/s) and the pause is about 1.5 s', () => {
  assert.ok(PERF_SCROLL.speed >= 20 && PERF_SCROLL.speed <= 30);
  assert.equal(PERF_SCROLL.pause, 1500);
  assert.equal(PERF_SCROLL.lines, 2);
});

test('scrolling waits for the enter animation, then pauses', () => {
  assert.equal(startDelay({ entering: true, enter: 'fade-up', duration: 600 }), 2100);
  assert.equal(startDelay({ entering: true, enter: 'none', duration: 600 }), 1500, 'no enter animation, only the pause');
  assert.equal(startDelay({ entering: false, enter: 'fade-up', duration: 600 }), 1500, 'switching programme while on screen');
  assert.equal(startDelay(), 1500);
  assert.equal(startDelay({ entering: true, enter: 'fade', duration: 'bad' }), 1500);
});

test('keyframes move exactly one copy so the loop is seamless', () => {
  assert.deepEqual(scrollKeyframes(112), [{ transform: 'translate3d(0, 0, 0)' }, { transform: 'translate3d(0, -112px, 0)' }]);
});
