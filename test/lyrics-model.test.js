import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLyricDocument, parseLrc, validateDocument } from '../public/js/lyrics/lyrics-model.js';

const BILINGUAL = [
  '[ti:Rolling in the Deep]',
  '[ar:Adele]',
  '[00:00.00]There is a fire starting in my heart',
  '[00:00.00]我心中燃起一把火',
  '[00:04.20]Reaching a fever pitch',
  '[00:04.20]到达了沸点',
  '[00:08.00]Finally I can see you crystal clear',
  '[00:08.00]终于我看清了你',
].join('\n');

test('line and word timestamps accept a single fractional digit as tenths of a second', () => {
  const { doc, errors } = buildLyricDocument(parseLrc(
    '[03:50.0]当我背对星空\n[03:51.5]<03:51.5>你<03:51.75>好',
  ));
  assert.deepEqual(errors, []);
  assert.deepEqual(doc.map(({ start }) => start), [230000, 231500]);
  assert.deepEqual(doc[1].tokens.map(({ start }) => start), [231500, 231750]);
});

test('the same timestamp pairs an English line with its Chinese translation', () => {
  const entries = parseLrc(BILINGUAL);
  const translation = entries.filter((entry) => entry.translation);
  assert.equal(translation.length, 3);
  assert.deepEqual(translation.map((entry) => entry.lines.length), [0, 0, 0]);
  const { doc, errors } = buildLyricDocument(entries);
  assert.deepEqual(errors, []);
  assert.equal(doc.length, 3);
  assert.deepEqual(doc.map((line) => line.text), [
    'There is a fire starting in my heart',
    'Reaching a fever pitch',
    'Finally I can see you crystal clear',
  ]);
  assert.deepEqual(doc.map((line) => line.translation), [
    '我心中燃起一把火',
    '到达了沸点',
    '终于我看清了你',
  ]);
});

test('a Chinese line keeps its own text and carries the English original as the translation', () => {
  const source = ['[00:01.00]是谁在敲打我窗', '[00:01.00]Who is knocking on my window'].join('\n');
  const { doc } = buildLyricDocument(parseLrc(source));
  assert.equal(doc.length, 1);
  assert.equal(doc[0].text, '是谁在敲打我窗');
  assert.equal(doc[0].translation, 'Who is knocking on my window');
});

test('three lines sharing one timestamp are never merged and stay reported', () => {
  const repeated = ['[00:01.00]第一句', '[00:01.00]第二句', '[00:01.00]third line'].join('\n');
  const entries = parseLrc(repeated);
  assert.equal(entries.filter((entry) => entry.translation).length, 0);
  const { doc, errors } = buildLyricDocument(entries);
  assert.equal(doc.length, 1);
  assert.equal(doc[0].text, '第一句');
  assert.equal(Object.hasOwn(doc[0], 'translation'), false);
  assert.equal(errors.length, 2);
  assert.deepEqual(errors.map((error) => error.message), ['与另一行的开始时间重复', '与另一行的开始时间重复']);
});

test('validateDocument accepts a translated line and rejects a blank translation', () => {
  const { doc } = buildLyricDocument(parseLrc(BILINGUAL));
  assert.deepEqual(validateDocument(doc), doc);
  const broken = [{ ...doc[0], translation: '   ' }];
  assert.throws(() => validateDocument(broken), /歌词格式无效/);
  const untouched = [{ ...doc[1] }];
  delete untouched[0].translation;
  assert.deepEqual(validateDocument(untouched), untouched);
});
