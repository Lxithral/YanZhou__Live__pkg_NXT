import { performance } from 'node:perf_hooks';
import { documentEnd, isLine, jsonBytes, RATES, validateDocument } from './public/lyrics-model.js';

export const LYRIC_COMMANDS = ['lyrics:load', 'lyrics:transport', 'lyrics:manual', 'lyrics:onair'];
const SOURCES = ['timeline', 'manual'];
const AUTO_SECONDS = [0, 5, 10];
const MANUAL_BYTES = 15 * 1024;

export const DEFAULT_LYRICS = {
  source: 'timeline',
  doc: [],
  transport: { position: 0, rate: 1 },
  manual: { lines: [], index: null, current: '', autoSeconds: 0 },
};

function requireFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== fields.length || !fields.every((key) => Object.hasOwn(value, key))) {
    throw new Error('歌词消息或设置格式无效。');
  }
}

function validateLines(lines) {
  if (!Array.isArray(lines) || lines.some((line) => !isLine(line) || !line.trim()) ||
      jsonBytes(lines) > MANUAL_BYTES) throw new Error('手动歌词列表无效或超过 15 KiB。');
}

function validateIndex(index, lines) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= lines.length) throw new Error('选句位置无效。');
}

export function validateLyricSettings({ source, doc, transport, manual }) {
  if (!SOURCES.includes(source)) throw new Error('歌词输出源无效。');
  validateDocument(doc, { allowEmpty: true });
  requireFields(transport, ['position', 'rate']);
  if (!Number.isSafeInteger(transport.position) || transport.position < 0 ||
      transport.position > documentEnd(doc) || !RATES.includes(transport.rate)) {
    throw new Error('歌词播放位置或速率无效。');
  }
  requireFields(manual, ['lines', 'index', 'current', 'autoSeconds']);
  if (manual.lines !== null) validateLines(manual.lines);
  if (manual.index !== null) validateIndex(manual.index, manual.lines ?? doc);
  if (!isLine(manual.current) || !AUTO_SECONDS.includes(manual.autoSeconds)) throw new Error('手动字幕设置无效。');
  return { source, doc, transport, manual };
}

export function createLyricsSession(initial, onChange) {
  let { source, doc, transport, manual } = initial;
  let documentLines = doc.map((line) => line.text);
  if (documentLines.length && manual.lines?.length === 0) {
    manual = { ...manual, lines: null };
  }
  let end = documentEnd(doc);
  let startedAt = null;
  let armed = false;
  let deadline = null;
  let autoTimer;

  function position(now) {
    const elapsed = startedAt === null ? 0 : (now - startedAt) * transport.rate;
    return Math.min(end, Math.round(transport.position + elapsed));
  }

  function manualLines() {
    return manual.lines ?? documentLines;
  }

  function nextLine() {
    return manual.index === null ? '' : manualLines()[manual.index + 1] ?? '';
  }

  function selectLine(index) {
    manual = { ...manual, index, current: manualLines()[index] };
  }

  function scheduleAuto() {
    clearTimeout(autoTimer);
    deadline = null;
    if (!manual.autoSeconds || !nextLine()) return;
    const delay = manual.autoSeconds * 1000;
    deadline = performance.now() + delay;
    autoTimer = setTimeout(() => {
      selectLine(manual.index + 1);
      scheduleAuto();
      onChange();
    }, delay);
    autoTimer.unref();
  }

  function applyTransport(action, value) {
    const now = performance.now();
    let nextPosition = position(now);
    let playing = startedAt !== null && nextPosition < end;
    let rate = transport.rate;
    switch (action) {
      case 'play':
        if (!doc.length) throw new Error('请先导入歌词。');
        if (nextPosition === end) nextPosition = 0;
        playing = true;
        break;
      case 'pause':
        playing = false;
        break;
      case 'seek':
        if (!Number.isSafeInteger(value) || value < 0 || value > end) throw new Error('跳转时间无效。');
        nextPosition = value;
        break;
      case 'nudge':
        if (value !== 500 && value !== -500) throw new Error('微调幅度必须为 ±0.5 秒。');
        nextPosition = Math.min(end, Math.max(0, nextPosition + value));
        break;
      case 'rate':
        if (!RATES.includes(value)) throw new Error('播放速率无效。');
        rate = value;
        break;
      default:
        throw new Error('走表操作无效。');
    }
    transport = { position: nextPosition, rate };
    startedAt = playing && nextPosition < end ? now : null;
  }

  function applyManual(action, value) {
    switch (action) {
      case 'load':
        validateLines(value);
        if (!value.length) throw new Error('请先输入至少一句字幕。');
        manual = { ...manual, lines: value, index: 0, current: value[0] };
        break;
      case 'select':
        validateIndex(value, manualLines());
        selectLine(value);
        break;
      case 'step': {
        if (value !== -1 && value !== 1) throw new Error('切句方向无效。');
        const index = manual.index === null ? 0 : manual.index + value;
        if (index < 0 || index >= manualLines().length) return;
        selectLine(index);
        break;
      }
      case 'commit':
        if (!isLine(value)) throw new Error('当前句格式无效或过长。');
        manual = { ...manual, current: value };
        break;
      case 'clear':
        manual = { ...manual, index: null, current: '' };
        break;
      case 'auto':
        if (!AUTO_SECONDS.includes(value)) throw new Error('自动切句间隔无效。');
        manual = { ...manual, autoSeconds: value };
        break;
      default:
        throw new Error('手动字幕操作无效。');
    }
    scheduleAuto();
  }

  return {
    apply(type, payload) {
      switch (type) {
        case 'lyrics:load':
          requireFields(payload, ['doc']);
          doc = validateDocument(payload.doc);
          documentLines = doc.map((line) => line.text);
          end = documentEnd(doc);
          transport = { ...transport, position: 0 };
          startedAt = null;
          if (armed && source === 'manual') manual = { ...manual, lines: null, index: null };
          else manual = { ...manual, lines: null, index: 0, current: documentLines[0] };
          clearTimeout(autoTimer);
          deadline = null;
          return { doc: true, lines: true };
        case 'lyrics:transport':
          requireFields(payload, ['action', 'value']);
          applyTransport(payload.action, payload.value);
          return {};
        case 'lyrics:manual':
          requireFields(payload, ['action', 'value']);
          applyManual(payload.action, payload.value);
          return { lines: payload.action === 'load' };
        case 'lyrics:onair':
          requireFields(payload, ['source']);
          if (!SOURCES.includes(payload.source)) throw new Error('该歌词输出源不可用。');
          source = payload.source;
          armed = true;
          return {};
      }
    },
    snapshot({ doc: includeDoc, lines: includeLines } = {}) {
      const now = performance.now();
      const head = position(now);
      return {
        source, armed, serverTime: Date.now(),
        transport: { position: head, rate: transport.rate, playing: startedAt !== null && head < end, end },
        manual: {
          index: manual.index, current: manual.current, next: nextLine(), autoSeconds: manual.autoSeconds,
          remaining: deadline === null ? null : Math.max(0, Math.round(deadline - now)),
          ...(includeLines && { lines: manual.lines }),
        },
        ...(includeDoc && { doc }),
      };
    },
    persisted() {
      return { source, doc, transport: { ...transport, position: position(performance.now()) }, manual };
    },
    checkpointNeeded() {
      if (startedAt === null) return false;
      if (position(performance.now()) === end) {
        transport = { ...transport, position: end };
        startedAt = null;
      }
      return true;
    },
    close() { clearTimeout(autoTimer); },
  };
}
