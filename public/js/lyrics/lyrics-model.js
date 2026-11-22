export const LYRIC_BYTES = 200 * 1024;
export const MAX_TIME = 24 * 60 * 60 * 1000;
export const MAX_LINE = 500;
export const RATES = Array.from({ length: 11 }, (_, index) => (90 + index * 2) / 100);

const STAMP = '(\\d{1,4}):([0-5]\\d)(?:\\.(\\d{1,3}))?';
const LINE_STAMP = new RegExp('^\\[' + STAMP + '\\]');
const WORD_STAMP = new RegExp('<' + STAMP + '>', 'g');
const METADATA = /^\[(?:ar|al|ti|by|re|ve):[^\]]*\]$/i;
const TIMING_TAG = /^\[(offset|length):([^\]]*)\]$/i;
const END_STAMP = new RegExp('^' + STAMP + '$');
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

function parseEndTime(value) {
  const stamp = END_STAMP.exec(value.trim());
  const time = stamp ? stampMs(stamp) : NaN;
  if (!isTime(time)) throw new Error('结束时间格式应为 分:秒，可带小数。');
  return time;
}

function lastTimestamp(line) {
  return line.tokens.at(-1)?.start ?? line.start;
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
      const tag = TIMING_TAG.exec(raw.trim());
      if (tag) {
        const kind = tag[1].toLowerCase();
        const text = tag[2].trim();
        const value = kind === 'length' ? parseEndTime(text) : Number(text);
        if (kind === 'offset' && (!/^[+-]?\d+$/u.test(text) || !isTime(Math.abs(value)))) {
          throw new Error('offset 必须是带可选正负号的毫秒整数。');
        }
        entries.push({ number: index + 1, raw, lines: [], error: '', timing: { kind, value } });
        continue;
      }
      const lines = parseLine(raw);
      if (lines.length) entries.push({ number: index + 1, raw, lines, error: '' });
    } catch (error) {
      entries.push({ number: index + 1, raw, lines: [], error: error.message });
    }
  }
  return entries;
}

// 只在当前保留的原文行上配对，避免跳过、删除或编辑译文后保留旧译文。
function pairTranslations(entries, credit) {
  const paired = new Map();
  const translations = new Set();
  let index = 0;
  while (index < entries.length) {
    const primary = entries[index].lines[0];
    let end = index + 1;
    while (primary && end < entries.length &&
        entries[end].lines.length === 1 && entries[end].lines[0].start === primary.start) end += 1;
    if (end - index === 2 && entries[index].lines.length === 1) {
      const secondary = entries[index + 1];
      const translation = secondary.lines[0];
      if (primary !== credit && translation !== credit && HAN.test(primary.text) !== HAN.test(translation.text)) {
        paired.set(primary, translation.text);
        translations.add(secondary);
      }
    }
    index = end;
  }
  return { paired, translations };
}

export function buildLyricDocument(entries, { endTime = '' } = {}) {
  const active = entries.filter((entry) => !entry.skip);
  let offset = 0;
  let end = null;
  for (const { timing } of active) {
    if (timing?.kind === 'offset') offset = timing.value;
    if (timing?.kind === 'length') end = timing.value;
  }
  const rows = active.filter((entry) => !entry.timing);
  const first = rows.flatMap((entry) => entry.lines).reduce((earliest, line) =>
    !earliest || line.start < earliest.start ? line : earliest, null);
  const credit = first?.start === 0 && CREDIT.test(first.text) ? first : null;
  const { paired, translations } = pairTranslations(rows, credit);
  const lines = rows.filter((entry) => !translations.has(entry)).flatMap((entry) => entry.lines)
    .sort((a, b) => a.start - b.start);
  const errors = [];
  const unique = lines.filter((line, index) => {
    if (lines[index - 1]?.start === line.start) {
      errors.push({ line, message: '与另一行的开始时间重复' });
      return false;
    }
    if (lastTimestamp(line) - offset > MAX_TIME) {
      errors.push({ line, message: '应用 offset 后时间超出范围' });
      return false;
    }
    return true;
  });
  const valid = unique.filter((line, index) => {
    const next = unique[index + 1];
    if (next && line.tokens.at(-1)?.start >= next.start) {
      errors.push({ line, message: '字时间延伸到下一行' });
      return false;
    }
    return true;
  });
  // 正 offset 提前显示。零点只保留当时正在显示的一句，逐字高亮从零点接续。
  const firstAtZero = Math.max(0, valid.findLastIndex((line) => line.start <= offset));
  const beforeStart = new Set(valid.slice(0, firstAtZero));
  const doc = valid.slice(firstAtZero).map((line) => ({
    ...line, start: Math.max(0, line.start - offset), credit: line === credit,
    tokens: offset ? line.tokens.map((token) => ({ ...token, start: Math.max(0, token.start - offset) })) : line.tokens,
    ...(paired.has(line) && { translation: paired.get(line) }),
  }));
  let endError = '';
  try {
    if (endTime.trim()) end = parseEndTime(endTime);
    const last = doc.at(-1);
    if (last && end !== null) {
      if (end <= lastTimestamp(last)) throw new Error('结束时间须晚于最后一句的最后时间戳。');
      last.end = end;
    }
  } catch (error) {
    endError = error.message;
  }
  return { doc, errors, translations, beforeStart, credit, endError };
}

function hasFields(value, fields) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every((key) => Object.hasOwn(value, key));
}

function validLine(line) {
  if (line === null || typeof line !== 'object' || Array.isArray(line)) return false;
  const translated = Object.hasOwn(line, 'translation');
  const timedEnd = Object.hasOwn(line, 'end');
  const fields = ['start', 'text', 'tokens', 'credit'];
  if (translated) fields.push('translation');
  if (timedEnd) fields.push('end');
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
  if (timedEnd && (!isTime(line.end) || line.end <= start)) return false;
  return !line.tokens.length || line.tokens.map((token) => token.text).join('') === line.text;
}

export function validateDocument(doc, { allowEmpty = false } = {}) {
  if (!Array.isArray(doc) || (!allowEmpty && !doc.length)) throw new Error('没有可载入的歌词。');
  if (jsonBytes(doc) > LYRIC_BYTES) throw new Error('歌词文档超过 200 KiB。');
  for (const [index, line] of doc.entries()) {
    if (!validLine(line) || (line.end !== undefined && index !== doc.length - 1)) {
      throw new Error(`第 ${index + 1} 行歌词格式无效。`);
    }
    const previous = doc[index - 1];
    if (previous && (previous.start >= line.start || previous.tokens.at(-1)?.start >= line.start)) {
      throw new Error(`第 ${index + 1} 行歌词时间重叠或顺序无效。`);
    }
  }
  return doc;
}

export function documentEnd(doc) {
  const last = doc.at(-1);
  if (!last) return 0;
  if (last.end !== undefined) return last.end;
  if (last.tokens.length) return lastTimestamp(last) + 800;
  const recent = doc.slice(-5).filter((line) => !line.credit);
  const gaps = recent.slice(1).map((line, index) => line.start - recent[index].start).sort((a, b) => a - b);
  const units = last.text.match(TOKEN)?.filter((part) => part.trim()).length ?? 0;
  const readingTime = Math.max(units * 350, gaps[Math.floor(gaps.length / 2)] ?? 0);
  return last.start + Math.max(3000, Math.min(10_000, readingTime));
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
