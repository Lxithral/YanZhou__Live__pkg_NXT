import test from 'node:test';
import assert from 'node:assert/strict';
import { INTRO_SCROLL, introSpeed, introPlan, introBar, introBarOffset, introKeyframes } from '../public/js/motion/intro-scroll.js';
import { PERF_SCROLL } from '../public/js/motion/perf-scroll.js';

test('reading speed 3.5 chars/s converts to a vertical px/s from line width and line height', () => {
  assert.equal(INTRO_SCROLL.charsPerSecond, 3.5);
  assert.equal(INTRO_SCROLL.lines, 3);
  // 350px 宽 ÷ 14.25px = 24.56 字/行；24.56 ÷ 3.5 = 7.02 秒/行；行高 23.51px ÷ 7.02 秒 = 3.351 px/s
  assert.equal(introSpeed({ viewportWidth: 350 }), 3.351);
  assert.equal(introSpeed({ viewportWidth: 280, fontSize: 14, lineHeight: 20, charsPerSecond: 4 }), 4);
  assert.ok(introSpeed({ viewportWidth: 700 }) < introSpeed({ viewportWidth: 350 }), 'wider lines hold more characters, so they move slower');
  assert.equal(introSpeed({ viewportWidth: 0 }), 0);
  assert.ok(INTRO_SCROLL.charsPerSecond * 60 <= 240, 'at or below 240 chars/min');
  assert.equal(INTRO_SCROLL.pause, PERF_SCROLL.pause, 'same start pause as the performers');
});

test('an intro that fits in three lines stays still (1px tolerance)', () => {
  assert.equal(introPlan({ contentHeight: 47, viewportHeight: 70.5, speed: 3.351 }), null);
  assert.equal(introPlan({ contentHeight: 71.4, viewportHeight: 70.5, speed: 3.351 }), null);
  assert.equal(introPlan({ contentHeight: 0, viewportHeight: 70.5, speed: 3.351 }), null);
  assert.equal(introPlan({ contentHeight: 120, viewportHeight: 70.5, speed: 0 }), null);
});

test('a long intro scrolls up to its end, holds, fades back and holds at the start', () => {
  const plan = introPlan({ contentHeight: 117.5, viewportHeight: 70.5, speed: 4 });
  assert.equal(plan.distance, 47);
  assert.equal(plan.scroll, 11750);
  assert.equal(plan.total, 11750 + INTRO_SCROLL.holdEnd + INTRO_SCROLL.fadeOut + INTRO_SCROLL.fadeIn + INTRO_SCROLL.holdStart);
  const { scrolled, fadeStart, reset, back } = plan.offsets;
  assert.ok(0 < scrolled && scrolled < fadeStart && fadeStart < reset && reset < back && back < 1);
  const longer = introPlan({ contentHeight: 235, viewportHeight: 70.5, speed: 4 });
  assert.ok(Math.abs(longer.distance / longer.scroll - plan.distance / plan.scroll) < 1e-6, 'constant speed regardless of length');
});

test('vertical bar: thumb = visible height / full height of the 3-line track, position follows progress', () => {
  assert.deepEqual(introBar({ contentHeight: 141, viewportHeight: 70.5 }), { ratio: 0.5, thumb: 35.25, travel: 35.25 }, 'track length defaults to the 3-line viewport');
  assert.deepEqual(introBar({ contentHeight: 120, viewportHeight: 60, barLength: 60 }), { ratio: 0.5, thumb: 30, travel: 30 });
  const tiny = introBar({ contentHeight: 100000, viewportHeight: 70.5 });
  assert.equal(tiny.ratio, INTRO_SCROLL.minThumb, 'never shorter than 12%');
  assert.equal(tiny.thumb, Math.round(70.5 * 0.12 * 100) / 100);
  assert.equal(introBar({ contentHeight: 50, viewportHeight: 70.5 }).travel, 0);
  assert.equal(introBarOffset(0, 35.25), 0);
  assert.equal(introBarOffset(0.5, 35.25), 17.63);
  assert.equal(introBarOffset(2, 35.25), 35.25);
  assert.equal(introBarOffset(-1, 35.25), 0);
});

test('text track and vertical bar thumb move down in step', () => {
  const plan = introPlan({ contentHeight: 141, viewportHeight: 70.5, speed: 4 });
  const { track, thumb } = introKeyframes(plan, 35.25);
  assert.equal(track[0].transform, 'translate3d(0, 0px, 0)');
  assert.equal(track[1].transform, 'translate3d(0, -70.5px, 0)');
  assert.equal(track[1].offset, thumb[1].offset, 'bar reaches the right end exactly when the text reaches its end');
  assert.equal(thumb[1].transform, 'translate3d(0, 35.25px, 0)', 'thumb reaches the bottom of the bar');
  assert.equal(thumb.at(-1).transform, 'translate3d(0, 0px, 0)', 'and returns to the top with the text');
  assert.equal(thumb[3].offset, track[5].offset, 'thumb is back at the top when the text has faded back in');
  assert.deepEqual(track.map((k) => k.opacity), [1, 1, 1, 0, 0, 1, 1]);
  assert.equal(track[3].offset, track[4].offset, 'jump back to the start happens while invisible');
  for (const frames of [track, thumb]) for (let i = 1; i < frames.length; i++) assert.ok(frames[i].offset >= frames[i - 1].offset);
});
