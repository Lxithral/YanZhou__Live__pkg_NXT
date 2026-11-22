import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLyricDocument, documentEnd, parseLrc, timelineIndex, validateDocument } from '../public/js/lyrics/lyrics-model.js';

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
  const { doc, errors, translations } = buildLyricDocument(entries);
  assert.deepEqual([...translations].map((entry) => entry.number), [4, 6, 8]);
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
  const { doc, errors, translations } = buildLyricDocument(entries);
  assert.equal(translations.size, 0);
  assert.equal(doc.length, 1);
  assert.equal(doc[0].text, '第一句');
  assert.equal(Object.hasOwn(doc[0], 'translation'), false);
  assert.equal(errors.length, 2);
  assert.deepEqual(errors.map((error) => error.message), ['与另一行的开始时间重复', '与另一行的开始时间重复']);
});

test('skipping, restoring, editing and removing a translation rebuilds the playout document', () => {
  const entries = parseLrc(BILINGUAL);
  const translation = entries[1];
  translation.skip = true;
  assert.equal(buildLyricDocument(entries).doc[0].translation, undefined);
  translation.skip = false;
  assert.equal(buildLyricDocument(entries).doc[0].translation, '我心中燃起一把火');
  translation.lines = parseLrc('[00:00.00]这是校对后的译文')[0].lines;
  assert.equal(buildLyricDocument(entries).doc[0].translation, '这是校对后的译文');
  assert.equal(buildLyricDocument(entries.filter((entry) => entry !== translation)).doc[0].translation, undefined);
});

test('an LRC offset shifts all line and word timestamps, preserving the cue and word progress at zero', () => {
  const entries = parseLrc('[00:00.00]更早的歌句\n[00:00.25]<00:00.250>烟<00:00.750>洲\n[00:02.0]第三句\n[offset:+500]');
  const { doc, errors, beforeStart } = buildLyricDocument(entries);
  assert.deepEqual(errors, []);
  assert.equal(beforeStart.size, 1);
  assert.deepEqual(doc.map((line) => line.start), [0, 1500]);
  assert.deepEqual(doc[0].tokens.map((token) => token.start), [0, 250]);
  assert.deepEqual(validateDocument(doc), doc);
  const delayed = buildLyricDocument(parseLrc('[offset:-250]\n[00:01][00:03]<00:01>测试')).doc;
  assert.deepEqual(delayed.map((line) => line.tokens[0].start), [1250, 3250]);
  assert.match(parseLrc('[offset:错误]')[0].error, /毫秒整数/);
});

test('explicit LRC and operator end times persist on the final cue and must follow its last word', () => {
  const entries = parseLrc('[length:00:21.5]\n[00:04.00]首句\n[00:10.00]<00:10>末<00:11.5>句');
  const natural = buildLyricDocument(entries);
  assert.equal(natural.endError, '');
  assert.equal(documentEnd(natural.doc), 21500);
  const explicit = buildLyricDocument(entries, { endTime: '00:25.250' });
  assert.equal(documentEnd(validateDocument(explicit.doc)), 25250);
  assert.equal(timelineIndex(explicit.doc, 25249), 1);
  assert.equal(timelineIndex(explicit.doc, 25250), 2);
  assert.match(buildLyricDocument(entries, { endTime: '00:11.500' }).endError, /最后时间戳/);
  assert.throws(() => validateDocument([{ ...natural.doc[0], end: 9000 }, natural.doc[1]]), /第 1 行/);
});

test('an ordinary LRC retains its final line using the surrounding cue spacing', () => {
  const { doc } = buildLyricDocument(parseLrc('[00:04]首句\n[00:10]末句'));
  assert.equal(timelineIndex(doc, 10800), 1);
  assert.equal(documentEnd(doc), 16000);
  const sparse = buildLyricDocument(parseLrc('[00:10]末句')).doc;
  assert.equal(documentEnd(sparse), 13000);
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
