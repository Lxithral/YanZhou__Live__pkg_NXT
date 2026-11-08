import { pinyin } from 'pinyin-pro';
import { Converter } from 'opencc-js';

const simplify = Converter({ from: 'hk', to: 'cn' });
const HAN = /\p{Script=Han}/u;
const SYLLABLE = /^[a-zü]+$/u;
const phonetics = new Map();

function characters(text) {
  return [...simplify(text.normalize('NFKC').toLowerCase()).replace(/[^\p{L}\p{N}]/gu, '')];
}

function sound(char) {
  if (!HAN.test(char)) return '';
  if (!phonetics.has(char)) {
    const syllable = pinyin(char, { toneType: 'none' });
    phonetics.set(char, SYLLABLE.test(syllable) ? syllable.replace(/^(zh|ch|sh)/u, (value) => value[0]) : '');
  }
  return phonetics.get(char);
}

function equivalent(a, b) {
  return a === b || Boolean(sound(a) && sound(a) === sound(b));
}

export function indexLyrics(doc) {
  return doc.flatMap((line, index) => {
    if (line.credit) return [];
    if (line.tokens.length) return line.tokens.flatMap(({ text, start }) =>
      characters(text).map((char) => ({ char, start, line: index })));
    const chars = characters(line.text);
    const duration = Math.min(4000, (doc[index + 1]?.start ?? line.start + 800) - line.start);
    return chars.map((char, offset) => ({
      char, start: line.start + Math.round(duration * offset / chars.length), line: index,
    }));
  });
}

function lowerBound(index, time) {
  let low = 0;
  let high = index.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (index[middle].start < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

function lcs(left, right, equal) {
  const counts = new Uint8Array(right.length + 1);
  for (const letter of left) {
    let diagonal = 0;
    for (let index = 1; index <= right.length; index += 1) {
      const previous = counts[index];
      counts[index] = equal(letter, right[index - 1]) ? diagonal + 1 : Math.max(previous, counts[index - 1]);
      diagonal = previous;
    }
  }
  return counts.at(-1);
}

export function matchLyric(index, text, head) {
  const heard = characters(text).slice(-16);
  if (heard.length < 4 || new Set(heard).size < 3 || !index.length) return null;
  const middle = lowerBound(index, head);
  const start = Math.max(0, Math.min(middle - 20, lowerBound(index, head - 3000)));
  const end = Math.min(index.length, Math.max(middle + 21, lowerBound(index, head + 3001)));
  const matches = [];
  for (let last = start; last < end; last += 1) {
    const target = index[last];
    if (!equivalent(heard.at(-1), target.char)) continue;
    let best;
    for (let count = Math.max(4, heard.length - 2); count <= heard.length + 2; count += 1) {
      const first = last + 1 - count;
      if (first < 0) continue;
      const written = index.slice(first, last + 1);
      if (target.start - written[0].start > 9000) continue;
      const letters = written.map(({ char }) => char);
      const denominator = Math.max(letters.length, heard.length);
      const confidence = lcs(heard, letters, equivalent) / denominator;
      if (confidence < .6) continue;
      const exact = lcs(heard, letters, (a, b) => a === b) / denominator;
      const score = confidence * .8 + exact * .2;
      if (!best || score > best.score) best = { ...target, confidence, score };
    }
    if (best) matches.push(best);
  }
  matches.sort((a, b) => b.score - a.score || Math.abs(a.start - head) - Math.abs(b.start - head));
  const best = matches[0];
  if (!best) return null;
  // An equally plausible repeated refrain must never move the output.
  if (matches.some((match) => Math.abs(match.start - best.start) >= 700 && best.score - match.score < .07)) return null;
  return { position: best.start, confidence: best.confidence, line: best.line };
}
