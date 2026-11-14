import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { indexLyrics, matchLyric } from '../server/asr-match.js';
import { createLyricsSession, DEFAULT_LYRICS } from '../server/lyrics-session.js';
import { createLyricsClock } from '../public/lyrics-clock.js';

const line = (start, text) => ({
  start, text, credit: false,
  tokens: [...text].map((text, index) => ({ start: start + index * 100, text })),
});

test('lyric matching normalizes punctuation and traditional characters and allows phonetic substitutions', () => {
  const index = indexLyrics([line(1000, '风吹过烟洲长廊')]);
  const match = matchLyric(index, '風吹過，煙洲長郎！', 200);
  assert.equal(match.position, 1600);
  assert.equal(match.confidence, 1);
});

test('lyric matching suppresses ambiguous repeated choruses and very short/noisy results', () => {
  const index = indexLyrics([line(1000, '照亮我的青春'), line(3300, '照亮我的青春')]);
  assert.equal(matchLyric(index, '照亮我的青春', 2100), null);
  assert.equal(matchLyric(index, '青春', 2100), null);
  assert.equal(matchLyric(index, '哈哈哈哈哈', 2100), null);
});

function running(start) {
  const session = createLyricsSession(DEFAULT_LYRICS, () => {});
  session.apply('lyrics:load', { doc: [line(start, '照亮我的青春'), line(8000, '我们一起唱歌')] });
  session.apply('lyrics:onair', { source: 'timeline' });
  session.apply('lyrics:correct', { enabled: true });
  session.apply('lyrics:transport', { action: 'play', value: null });
  return session;
}

test('a two-second lag jumps back into alignment and subsequent evidence respects cooldown', () => {
  const session = running(1500);
  const wall = Date.now();
  assert.equal(session.correct({ text: '照亮我的青春', at: wall, estimated: false }, wall), true);
  const [adjusted] = session.correction().history;
  assert.equal(adjusted.smooth, false);
  assert.ok(adjusted.to - adjusted.from >= 1950 && adjusted.to - adjusted.from <= 2000);
  assert.equal(session.correct({ text: '我们一起唱歌', at: wall + 1, estimated: false }, wall + 1), false);
  assert.equal(session.correction().history.length, 1);
});

test('medium offsets are interpolated and small or ineligible offsets do not move the playhead', () => {
  const medium = running(500);
  const wall = Date.now();
  assert.equal(medium.correct({ text: '照亮我的青春', at: wall, estimated: true }, wall), true);
  assert.equal(medium.correction().history[0].smooth, true);
  const state = medium.snapshot();
  const clock = createLyricsClock();
  clock.apply(state);
  const now = performance.now();
  const start = clock.position(now);
  const half = clock.position(now + 250);
  assert.ok(half - start > 700 && half - start < 800);

  const small = running(150);
  assert.equal(small.correct({ text: '照亮我的青春', at: wall, estimated: false }, wall), false);
  small.apply('lyrics:onair', { source: 'manual' });
  assert.equal(small.correct({ text: '照亮我的青春', at: wall + 1, estimated: false }, wall + 1), false);
  assert.deepEqual(small.correction().history, []);
});

test('audio worklet downmixes and streams 40 ms PCM frames from common browser rates', async () => {
  const worklet = await readFile(new URL('../public/asr-audio-worklet.js', import.meta.url), 'utf8');
  for (const sampleRate of [44100, 48000]) {
    const packets = [];
    let Processor;
    runInNewContext(worklet, {
      sampleRate,
      AudioWorkletProcessor: class { port = { postMessage: (buffer) => packets.push(buffer) }; },
      registerProcessor(_name, implementation) { Processor = implementation; },
    });
    const processor = new Processor();
    const total = sampleRate * .08;
    for (let index = 0; index < total; index += 128) {
      const samples = Math.min(128, total - index);
      processor.process([[new Float32Array(samples).fill(.5), new Float32Array(samples).fill(.25)]]);
    }
    assert.equal(packets.length, 2);
    assert.equal(packets[0].byteLength, 1280);
    assert.equal(new DataView(packets[0]).getInt16(0, true), 12288);
  }
});
