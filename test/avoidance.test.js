import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAvoidance, AVOID_GAP, LEAN_GAP, LEAN_MIN_GAP, SAFE_X } from '../public/js/stage/stage-avoidance.js';

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const moved = (r, o) => ({ ...r, x: r.x + o.dx, y: r.y + o.dy });

test('non-overlapping modules keep their saved positions', () => {
  const boxes = { logo: [{ x: 72, y: 64, w: 300, h: 80 }], program: [{ x: 1144, y: 64, w: 680, h: 350 }] };
  assert.deepEqual(resolveAvoidance(boxes, ['logo', 'program']), { logo: { dx: 0, dy: 0 }, program: { dx: 0, dy: 0 } });
});

test('the module shown later moves; the earlier one stays put', () => {
  const host = { x: 1251, y: 933, w: 497, h: 93 };
  const card = { x: 1240, y: 730, w: 680, h: 350 };
  const later = resolveAvoidance({ hosts: [host], program: [card] }, ['hosts', 'program']);
  assert.deepEqual(later.hosts, { dx: 0, dy: 0 });
  assert.equal(later.program.dx, 0, 'a vertical move is preferred');
  assert.equal(later.program.dy, host.y - AVOID_GAP - (card.y + card.h));
  assert.ok(!overlap(moved(card, later.program), host));

  const reversed = resolveAvoidance({ hosts: [host], program: [card] }, ['program', 'hosts']);
  assert.deepEqual(reversed.program, { dx: 0, dy: 0 });
  assert.ok(reversed.hosts.dy < 0 && !overlap(moved(host, reversed.hosts), card));
});

test('the smallest move wins and the result stays inside the canvas with a gap', () => {
  const a = { x: 100, y: 100, w: 400, h: 100 };
  const b = { x: 120, y: 180, w: 200, h: 60 };
  const { b: o } = resolveAvoidance({ a: [a], b: [b] }, ['a', 'b']);
  assert.deepEqual(o, { dx: 0, dy: a.y + a.h + AVOID_GAP - b.y });

  // At the top edge moving up is impossible, so the module moves down.
  const top = resolveAvoidance({ a: [{ x: 0, y: 0, w: 300, h: 200 }], b: [{ x: 50, y: 150, w: 100, h: 100 }] }, ['a', 'b']);
  assert.deepEqual(top.b, { dx: 0, dy: 66 });
});

test('falls back to a horizontal move when no vertical spot fits', () => {
  const tall = { x: 800, y: 0, w: 200, h: 1080 };
  const box = { x: 900, y: 400, w: 200, h: 100 };
  const { box: o } = resolveAvoidance({ tall: [tall], box: [box] }, ['tall', 'box']);
  assert.equal(o.dy, 0);
  assert.equal(o.dx, tall.x + tall.w + AVOID_GAP - box.x);
});

test('multi-part modules move as one and later modules avoid every earlier part', () => {
  const hosts = [{ x: 172, y: 933, w: 499, h: 93 }, { x: 1251, y: 933, w: 497, h: 93 }];
  const lyrics = { x: 240, y: 900, w: 1440, h: 80 };
  const { lyrics: o } = resolveAvoidance({ hosts, lyrics: [lyrics] }, ['hosts', 'lyrics']);
  assert.ok(hosts.every((h) => !overlap(moved(lyrics, o), h)));
  assert.equal(o.dx, 0);
});

test('modules missing from the show order go last and empty boxes are ignored', () => {
  const a = { x: 0, y: 0, w: 100, h: 100 };
  const result = resolveAvoidance({ a: [a], b: [{ ...a }], c: [] }, ['b']);
  assert.deepEqual(result.b, { dx: 0, dy: 0 });
  assert.ok(result.a.dx !== 0 || result.a.dy !== 0);
  assert.deepEqual(result.c, { dx: 0, dy: 0 });
});

test('an impossible layout leaves the module in place instead of throwing', () => {
  const full = { x: 0, y: 0, w: 1920, h: 1080 };
  const { b } = resolveAvoidance({ a: [full], b: [{ x: 10, y: 10, w: 100, h: 100 }] }, ['a', 'b']);
  assert.deepEqual(b, { dx: 0, dy: 0 });
});

const HOSTS = [{ x: 172, y: 933, w: 499, h: 93 }, { x: 1251, y: 933, w: 497, h: 93 }];
const CARD = { x: 1240, y: 730, w: 680, h: 350 };



test('the pair returns to its symmetric layout once the obstacle is gone', () => {
  const { hosts } = resolveAvoidance({ hosts: HOSTS }, ['program', 'hosts'], { lean: ['hosts'] });
  assert.deepEqual(hosts, { dx: 0, dy: 0 });
});

test('falls back to the old whole-module move when the row has no room', () => {
  const wall = { x: 400, y: 730, w: 1200, h: 350 };
  const { hosts } = resolveAvoidance({ program: [wall], hosts: HOSTS }, ['program', 'hosts'], { lean: ['hosts'] });
  assert.equal(hosts.parts, undefined);
  assert.ok(hosts.dy !== 0 || hosts.dx !== 0);
  assert.ok(HOSTS.every((h) => !overlap(moved(h, hosts), wall)));
});



test('when the row has no room, an earlier host pair falls back to the later module moving', () => {
  const wall = { x: 400, y: 730, w: 1200, h: 350 };
  const { hosts, program } = resolveAvoidance({ hosts: HOSTS, program: [wall] }, ['hosts', 'program'], { lean: ['hosts'] });
  assert.deepEqual(hosts, { dx: 0, dy: 0 });
  assert.ok(program.dx !== 0 || program.dy !== 0);
});

test('a fading-out obstacle passed as fixed keeps the hosts leaned until it is gone', () => {
  const held = resolveAvoidance({ hosts: HOSTS }, ['hosts'], { lean: ['hosts'], fixed: [CARD] });
  assert.ok(held.hosts.parts[1].dx < 0);
  assert.deepEqual(resolveAvoidance({ hosts: HOSTS }, ['hosts'], { lean: ['hosts'] }).hosts, { dx: 0, dy: 0 });
});

const lean = (boxes, order) => resolveAvoidance(boxes, order, { lean: ['hosts'] });
const placedHosts = (o, hosts = HOSTS) => hosts.map((h, i) => moved(h, o.hosts.parts[i]));
const ROOMY = [{ x: 400, y: 933, w: 499, h: 93 }, { x: 1100, y: 933, w: 497, h: 93 }];

test('the whole host pair slides left together, keeping its spacing, 96px clear of the card', () => {
  assert.equal(LEAN_GAP, 96);
  const card = { x: 1500, y: 730, w: 420, h: 350 };
  const o = lean({ program: [card], hosts: ROOMY }, ['program', 'hosts']);
  const [l, r] = placedHosts(o, ROOMY);
  assert.deepEqual(o.hosts.parts.map((p) => p.dy), [0, 0], 'stays on its own row');
  assert.equal(o.hosts.parts[0].dx, o.hosts.parts[1].dx, 'both move by the same amount');
  assert.equal(card.x - (r.x + r.w), 96);
  assert.equal(r.x - (l.x + l.w), ROOMY[1].x - (ROOMY[0].x + ROOMY[0].w), 'original spacing kept');
});

test('when the pair would cross the safe area, the left caption stops at the edge and the spacing shrinks', () => {
  const o = lean({ program: [CARD], hosts: HOSTS }, ['hosts', 'program']);
  const [l, r] = placedHosts(o);
  assert.deepEqual(o.program, { dx: 0, dy: 0 }, 'the card stays put even though it appeared later');
  assert.equal(l.x, SAFE_X);
  assert.equal(CARD.x - (r.x + r.w), 96);
  assert.ok(r.x - (l.x + l.w) >= 24);
});

test('the card gap shrinks toward 48px only when 96px does not fit', () => {
  const card = { x: 1180, y: 730, w: 740, h: 350 };
  const o = lean({ program: [card], hosts: HOSTS }, ['program', 'hosts']);
  const [l, r] = placedHosts(o);
  const gap = card.x - (r.x + r.w);
  assert.ok(gap >= LEAN_MIN_GAP && gap < 96, `gap ${gap}`);
  assert.equal(l.x, SAFE_X);
  assert.ok(r.x - (l.x + l.w) >= 24);
});

test('a left-side obstacle mirrors the lean to the right', () => {
  const card = { x: 0, y: 730, w: 450, h: 350 };
  const o = lean({ program: [card], hosts: ROOMY }, ['program', 'hosts']);
  const [l] = placedHosts(o, ROOMY);
  assert.ok(o.hosts.parts[0].dx > 0);
  assert.equal(o.hosts.parts[0].dx, o.hosts.parts[1].dx);
  assert.equal(l.x - (card.x + card.w), 96);
});
