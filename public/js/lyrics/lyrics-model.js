export const LYRIC_BYTES = 200 * 1024;
export const MAX_TIME = 24 * 60 * 60 * 1000;
export const MAX_LINE = 500;
export const RATES = Array.from({ length: 11 }, (_, index) => (90 + index * 2) / 100);

const STAMP = '(\\d{1,4}):([0-5]\\d)(?:\\.(\\d{2,3}))?';
const LINE_STAMP = new RegExp('^\\[' + STAMP + '\\]');
const WORD_STAMP = new RegExp('<' + STAMP + '>', 'g');
const METADATA = /^\[(?:ar|al|ti|by|re|ve|length|offset):[^\]]*\]$/i;
const CREDIT = /^(?:作[词曲]|词|曲|编曲|演唱|歌手|原唱|制作|混音|录音|监制|credits?|lyrics|music|arrang(?:er|ement)|vocal(?:s)?)\s*[:：]/iu;
const HAN = /\p{Script=Han}/u;
const TEXT = /^[^\u0000-\u001F\u007F]*$/u;
const TOKEN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|\s+/gu;

export const jsonBytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
export const isTime = (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME;
export const isLine = (value) => typeof value === 'string' && value.length <= MAX_LINE && TEXT.test(value);

function stampMs(match) {
  return Number(match[1]) * 60_000 + Number(match[2]) * 1000 + Number((match[3] || '').padEnd(3, '0'));
}

function appendChunk(tokens, chunk, start, end) {
  const parts = chunk.match(TOKEN) ?? [];
  const words = parts.filter((part) => part.trim()).length;
  let word = 0;
  for (const text of parts) {
    tokens.push({ text, start: start + Math.floor((end - start) * word / Math.max(1, words)) });
    if (text.trim()) word += 1;
  }
}

function parseLine(raw) {
  let remaining = raw.trim();
  const starts = [];
  let match;
  while ((match = LINE_STAMP.exec(remaining))) {
    starts.push(stampMs(match));
    remaining = remaining.slice(match[0].length);
  }
  if (!starts.length) throw new Error('缺少有效的行时间戳');
  remaining = remaining.trim();
  if (!remaining) return [];
  const tags = [...remaining.matchAll(WORD_STAMP)];
  const text = remaining.replace(WORD_STAMP, '');
  if (!text.trim()) return [];
  if (/<\d+:/.test(text)) throw new Error('字时间戳无效');
  return starts.map((start) => {
    const tokens = [];
    const offset = start - starts[0];
    if (tags.length && tags[0].index > 0) {
      appendChunk(tokens, remaining.slice(0, tags[0].index), start, Math.max(start, stampMs(tags[0]) + offset));
    }
    for (const [index, tag] of tags.entries()) {
      const next = tags[index + 1];
      const time = stampMs(tag) + offset;
      const chunk = remaining.slice(tag.index + tag[0].length, next?.index);
      appendChunk(tokens, chunk, time, next ? Math.max(time, stampMs(next) + offset) : time);
    }
    if (tags.some((tag, index) => stampMs(tag) < (index ? stampMs(tags[index - 1]) : starts[0]))) {
      throw new Error('字时间早于行起点或顺序颠倒');
    }
    const line = { start, text, tokens, credit: false };
    if (!validLine(line)) throw new Error('歌词文字或时间超出范围');
    return line;
  });
}

export function parseLrc(source) {
  const entries = [];
  for (const [index, raw] of source.replace(/^\uFEFF/, '').split(/\r\n?|\n/u).entries()) {
    if (!raw.trim() || METADATA.test(raw.trim())) continue;
    try {
      const lines = parseLine(raw);
      if (lines.length) entries.push({ number: index + 1, raw, lines, error: '' });
    } catch (error) {
      entries.push({ number: index + 1, raw, lines: [], error: error.message });
    }
  }
  const ordered = entries.flatMap((entry) => entry.lines).sort((a, b) => a.start - b.start);
  if (ordered[0]?.start === 0 && CREDIT.test(ordered[0].text)) ordered[0].credit = true;
  pairTranslations(entries);
  return entries;
}

// 双语 LRC 的常见写法：原文行与译文行使用同一个时间戳相邻排列。
// 把相邻同time、且只有一方含汉字的行合成一句，译文挂在原文行的 translation 上。
function isTranslationPair(first, second) {
  if (first.skip || second.skip || first.lines.length !== 1 || second.lines.length !== 1) return false;
  const [left, right] = [first.lines[0], second.lines[0]];
  if (left.start !== right.start || left.credit || right.credit) return false;
  return HAN.test(left.text) !== HAN.test(right.text);
}

// 三行挤在同一个时间戳时无法判断谁是译文，保持原样，交给重复时间戳的校验去报告。
function pairTranslations(entries) {
  let index = 0;
  while (index < entries.length) {
    const start = entries[index].lines[0]?.start;
    let end = index + 1;
    while (start !== undefined && end < entries.length &&
        entries[end].lines.length === 1 && entries[end].lines[0].start === start) end += 1;
    if (end - index === 2 && isTranslationPair(entries[index], entries[index + 1])) {
      // LRC 里原文在前、译文在后，所以先出现的那一行保持主行。
      const [primary, secondary] = [entries[index], entries[index + 1]];
      primary.lines[0].translation = secondary.lines[0].text;
      secondary.lines = [];
      secondary.translation = true;
    }
    index = Math.max(end, index + 1);
  }
}

export function buildLyricDocument(entries) {
  const lines = entries.filter((entry) => !entry.skip).flatMap((entry) => entry.lines)
    .sort((a, b) => a.start - b.start);
  const errors = [];
  const unique = lines.filter((line, index) => {
    if (lines[index - 1]?.start === line.start) {
      errors.push({ line, message: '与另一行的开始时间重复' });
      return false;
    }
    return true;
  });
  const doc = unique.filter((line, index) => {
    const next = unique[index + 1];
    if (next && line.tokens.at(-1)?.start >= next.start) {
      errors.push({ line, message: '字时间延伸到下一行' });
      return false;
    }
    return true;
  });
  return { doc, errors };
}

function hasFields(value, fields) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every((key) => Object.hasOwn(value, key));
}

function validLine(line) {
  if (line === null || typeof line !== 'object' || Array.isArray(line)) return false;
  const translated = Object.hasOwn(line, 'translation');
  const fields = translated ? ['start', 'text', 'tokens', 'credit', 'translation'] : ['start', 'text', 'tokens', 'credit'];
  if (!hasFields(line, fields) || !isTime(line.start) ||
      !isLine(line.text) || !line.text.trim() || typeof line.credit !== 'boolean' ||
      !Array.isArray(line.tokens) || line.tokens.length > MAX_LINE) return false;
  if (translated && (!isLine(line.translation) || !line.translation.trim())) return false;
  let start = line.start;
  for (const token of line.tokens) {
    if (!hasFields(token, ['start', 'text']) || !isTime(token.start) || token.start < start ||
        !isLine(token.text) || !token.text) return false;
    start = token.start;
  }
  return !line.tokens.length || line.tokens.map((token) => token.text).join('') === line.text;
}

export function validateDocument(doc, { allowEmpty = false } = {}) {
  if (!Array.isArray(doc) || (!allowEmpty && !doc.length)) throw new Error('没有可载入的歌词。');
  if (jsonBytes(doc) > LYRIC_BYTES) throw new Error('歌词文档超过 200 KiB。');
  for (const [index, line] of doc.entries()) {
    if (!validLine(line)) throw new Error(`第 ${index + 1} 行歌词格式无效。`);
    const previous = doc[index - 1];
    if (previous && (previous.start >= line.start || previous.tokens.at(-1)?.start >= line.start)) {
      throw new Error(`第 ${index + 1} 行歌词时间重叠或顺序无效。`);
    }
  }
  return doc;
}

export function documentEnd(doc) {
  const last = doc.at(-1);
  return last ? (last.tokens.at(-1)?.start ?? last.start) + 800 : 0;
}

export function timelineIndex(doc, position, end = documentEnd(doc)) {
  if (position >= end) return doc.length;
  let low = 0;
  let high = doc.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (doc[middle].start <= position) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}
