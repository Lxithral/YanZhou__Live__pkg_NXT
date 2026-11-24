import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAvoidance, AVOID_GAP } from '../public/js/stage/stage-avoidance.js';

const origin = { dx: 0, dy: 0 };
const rect = (x, y, w, h) => ({ x, y, w, h });
const moved = (r, o) => ({ ...r, x: r.x + o.dx, y: r.y + o.dy });
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('keeps all saved positions when there is no collision, even in the upper half', () => {
  const boxes = { logo: [rect(72, 64, 300, 80)], program: [rect(1144, 64, 680, 350)] };
  assert.deepEqual(resolveAvoidance(boxes, ['logo', 'program']), { logo: origin, program: origin });
});

test('keeps both corner marks fixed regardless of their show order', () => {
  const name = rect(200, 320, 240, 80);
  const logo = rect(80, 300, 320, 100);
  const eventMark = rect(1404, 936, 420, 84);
  const lyrics = rect(260, 859, 1440, 152);
  const result = resolveAvoidance({ hosts: [name], logo: [logo], eventMark: [eventMark], lyrics: [lyrics] },
    ['hosts', 'lyrics', 'eventMark', 'logo']);

  assert.deepEqual(result.logo, origin);
  assert.deepEqual(result.eventMark, origin);
  assert.ok(moved(name, result.hosts).y >= 540);
  assert.equal(result.lyrics.dx, 0, 'the full caption cannot fit beside the event mark');
  assert.equal(lyrics.y + result.lyrics.dy + lyrics.h, eventMark.y - AVOID_GAP);
});

for (const captionId of ['lyrics', 'speech']) {
  test(captionId + ' gets its saved position before a program that appeared earlier', () => {
    const program = rect(1120, 850, 300, 140);
    const caption = rect(280, 790, 1000, 122);
    const result = resolveAvoidance({ program: [program], [captionId]: [caption] }, ['program', captionId]);

    assert.deepEqual(result[captionId], origin);
    assert.deepEqual(result.program, { dx: 176, dy: 0 }, 'second choice of a shorter vertical shift does not win');
  });
}

test('moves a colliding nameplate sideways as a whole', () => {
  const name = rect(1251, 933, 497, 93);
  const program = rect(1240, 730, 680, 350);
  const result = resolveAvoidance({ hosts: [name], program: [program] }, ['program', 'hosts']);
  assert.deepEqual(result.program, origin);
  assert.deepEqual(result.hosts, { dx: -539.5, dy: 0 });
  assert.ok(!overlaps(moved(name, result.hosts), program));
});

test('uses a horizontal space that just fits before going vertical', () => {
  const caption = rect(0, 800, 1100, 90);
  const program = rect(1000, 800, 820, 90);
  const { program: offset } = resolveAvoidance({ lyrics: [caption], program: [program] });
  assert.deepEqual(offset, { dx: 100, dy: 0 });
});

test('keeps the whole module below the midline when making a vertical move', () => {
  const name = rect(400, 540, 1300, 100);
  const program = rect(0, 520, 1920, 100);
  const { hosts } = resolveAvoidance({ program: [program], hosts: [name] }, ['program', 'hosts']);
  assert.deepEqual(hosts, { dx: 0, dy: 96 });
});

test('places an oversized module against the bottom without resizing it', () => {
  const caption = rect(0, 750, 500, 220);
  const program = rect(170, 430, 400, 600);
  const { program: offset } = resolveAvoidance({ program: [program], speech: [caption] });
  const placed = moved(program, offset);
  assert.equal(placed.h, 600);
  assert.equal(placed.y + placed.h, 1080);
  assert.ok(!overlaps(placed, caption));
});

test('tries another lower row for a displaced caption when the first row leaves no room for the ticket', () => {
  const boxes = {
    eventMark: [rect(1404, 936, 420, 84)],
    hosts: [rect(771, 866, 378, 119)],
    program: [rect(127, 698, 719, 288)],
    lyrics: [rect(260, 859, 1440, 152)],
  };
  const result = resolveAvoidance(boxes, ['hosts', 'program', 'lyrics', 'eventMark']);
  const stage = Object.keys(boxes).map((id) => moved(boxes[id][0], result[id]));
  assert.deepEqual(result.eventMark, origin);
  assert.ok(stage.every((part) => part.y >= 540 && part.y + part.h <= 1080));
  assert.ok(stage.every((part, i) => stage.slice(i + 1).every((other) => !overlaps(part, other))));
  assert.ok(stage[3].y + stage[3].h + AVOID_GAP <= stage[2].y);
});

test('when space is exhausted, protects captions before other overlap', () => {
  const caption = rect(0, 300, 250, 300);
  const eventMark = rect(250, 300, 350, 300);
  const program = rect(40, 400, 180, 160);
  const { program: offset } = resolveAvoidance({ lyrics: [caption], eventMark: [eventMark], program: [program] },
    ['program', 'lyrics', 'eventMark'], { width: 600, height: 600 });
  const placed = moved(program, offset);
  assert.ok(!overlaps(placed, caption));
  assert.ok(overlaps(placed, eventMark));
  assert.ok(placed.y >= 300 && placed.y + placed.h <= 600);
});

test('finds the smallest remaining overlap within the lower half', () => {
  const fixed = [rect(0, 300, 275, 300), rect(325, 300, 275, 300)];
  const program = rect(0, 350, 200, 100);
  const { program: offset } = resolveAvoidance({ program: [program] }, [], { width: 600, height: 600, fixed });
  assert.deepEqual(offset, { dx: 125, dy: 0 });
});

test('releases the original position as soon as a fading obstacle is gone', () => {
  const name = rect(100, 800, 200, 90);
  const fixed = [rect(100, 800, 300, 100)];
  const boxes = { hosts: [name], lyrics: [] };
  const colliding = resolveAvoidance(boxes, ['hosts'], { fixed });
  assert.equal(colliding.hosts.dy, 0);
  assert.ok(!overlaps(moved(name, colliding.hosts), fixed[0]));
  assert.deepEqual(colliding.lyrics, origin);
  assert.deepEqual(resolveAvoidance(boxes).hosts, origin);
});

test('a completely occupied canvas stays solvable and a moved box remains below the midline', () => {
  const program = rect(50, 250, 100, 100);
  const fixed = [rect(0, 0, 1920, 1080)];
  const { program: offset } = resolveAvoidance({ program: [program] }, [], { fixed });
  assert.deepEqual(offset, { dx: 0, dy: 290 });
});

test('uses the safe area and keeps the program card within its animation allowance', () => {
  const block = rect(495, 760, 1329, 266);
  const card = rect(400, 810, 380, 180);
  const area = { left: 96, top: 54, right: 1824, bottom: 1026 };
  const programArea = { ...area, left: 115, bottom: 994 };
  const { program } = resolveAvoidance({ lyrics: [block], program: [card] }, ['lyrics', 'program'],
    { area, areas: { program: programArea } });
  assert.deepEqual(moved(card, program), rect(115, 810, 380, 180));
});

test('allows other modules in the transparent corners between caption rows', () => {
  const lyrics = [rect(480, 700, 640, 48), rect(700, 756, 200, 32)];
  const card = rect(465, 750, 200, 80);
  const { program } = resolveAvoidance({ lyrics, program: [card] });
  assert.deepEqual(program, origin);
});

test('moves a colliding nameplate toward the horizontal center when there is room', () => {
  const eventMark = rect(1460, 940, 420, 84);
  const name = rect(1370, 936, 310, 90);
  const { hosts } = resolveAvoidance({ eventMark: [eventMark], hosts: [name] });
  assert.equal(hosts.dy, 0);
  assert.equal(name.x + hosts.dx + name.w / 2, 960);
});
