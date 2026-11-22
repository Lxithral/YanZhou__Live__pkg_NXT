import { performance } from 'node:perf_hooks';
import { documentEnd, isLine, jsonBytes, RATES, validateDocument } from '../public/js/lyrics/lyrics-model.js';
import { indexLyrics, matchLyric } from './asr-match.js';

export const LYRIC_COMMANDS = ['lyrics:load', 'lyrics:transport', 'lyrics:manual', 'lyrics:onair', 'lyrics:correct', 'lyrics:clear-correction-log'];
const SOURCES = ['timeline', 'manual'];
const AUTO_SECONDS = [0, 5, 10];
const MANUAL_BYTES = 15 * 1024;

export const DEFAULT_LYRICS = {
  source: 'timeline',
  armed: false,
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

export function validateLyricSettings({ source, doc, transport, manual, armed }) {
  // Older settings may have selected direct ASR output. Preserve their
  // playhead and lyrics but wait for the operator to push the timeline.
  const legacyAsr = source === 'asr';
  if (!legacyAsr && !SOURCES.includes(source)) throw new Error('歌词输出源无效。');
  if (armed !== undefined && typeof armed !== 'boolean') throw new Error('歌词推送状态无效。');
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
  return { source: legacyAsr ? 'timeline' : source, doc, transport, manual, armed: !legacyAsr && armed === true };
}

export function createLyricsSession(initial, onChange) {
  let { source, doc, transport, manual, armed = false } = initial;
  if (manual.autoSeconds) manual = { ...manual, autoSeconds: 0 };
  let documentLines = doc.map((line) => line.text);
  if (documentLines.length && manual.lines?.length === 0) {
    manual = { ...manual, lines: null };
  }
  let end = documentEnd(doc);
  let startedAt = null;
  let deadline = null;
  let autoTimer;
  let adjustment;
  let lyricIndex;
  let lastAdjustment = -Infinity;
  let lastObservation = -Infinity;
  let correction = { enabled: false, offset: null, confidence: null, estimated: false, history: [] };

  function position(now) {
    const elapsed = startedAt === null ? 0 : (now - startedAt) * transport.rate;
    const progress = adjustment ? Math.min(1, Math.max(0, (now - adjustment.start) / 500)) : 0;
    return Math.min(end, Math.max(0, Math.round(transport.position + elapsed + (adjustment?.delta ?? 0) * progress)));
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
    if (!manual.autoSeconds) return;
    if (!nextLine()) {
      manual = { ...manual, autoSeconds: 0 };
      return;
    }
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
        if (startedAt === null) return false;
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
    adjustment = undefined;
    return true;
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
          adjustment = undefined;
          lyricIndex = undefined;
          correction = { ...correction, offset: null, confidence: null, history: [] };
          if (armed && source === 'manual') manual = { ...manual, lines: null, index: null };
          else manual = { ...manual, lines: null, index: 0, current: documentLines[0] };
          manual = { ...manual, autoSeconds: 0 };
          scheduleAuto();
          return { doc: true, lines: true };
        case 'lyrics:transport':
          requireFields(payload, ['action', 'value']);
          return applyTransport(payload.action, payload.value) ? {} : null;
        case 'lyrics:manual':
          requireFields(payload, ['action', 'value']);
          applyManual(payload.action, payload.value);
          return { lines: payload.action === 'load' };
        case 'lyrics:onair':
          requireFields(payload, ['source']);
          if (payload.source === null) {
            armed = false;
            return {};
          }
          if (!SOURCES.includes(payload.source)) throw new Error('该歌词输出源不可用。');
          source = payload.source;
          armed = true;
          return {};
        case 'lyrics:correct':
          requireFields(payload, ['enabled']);
          if (typeof payload.enabled !== 'boolean') throw new Error('纠偏开关无效。');
          correction = { ...correction, enabled: payload.enabled, offset: null, confidence: null };
          return {};
        case 'lyrics:clear-correction-log':
          requireFields(payload, []);
          correction = { ...correction, history: [] };
          return {};
      }
    },
    correction() { return correction; },
    correct(event, wall = Date.now(), now = performance.now()) {
      if (!correction.enabled || !armed || source !== 'timeline' || startedAt === null || !doc.length) return false;
      const age = wall - event.at;
      if (age < 0 || age > 2500 || now - age < startedAt || event.at <= lastObservation) return false;
      lastObservation = event.at;
      const from = position(now);
      if (from >= end) return false;
      lyricIndex ??= indexLyrics(doc);
      const observed = position(now - age);
      const match = matchLyric(lyricIndex, event.text, observed);
      const delta = match ? match.position - observed : null;
      correction = { ...correction, offset: delta, confidence: match?.confidence ?? null, estimated: event.estimated };
      if (!match || Math.abs(delta) < 800 || now - lastAdjustment < 3000) return false;
      const to = Math.max(0, Math.min(end, from + delta));
      if (from === to) return false;
      const smooth = Math.abs(delta) <= 1500;
      lastAdjustment = now;
      startedAt = now;
      transport = { ...transport, position: smooth ? from : to };
      adjustment = smooth ? { start: now, delta: to - from } : undefined;
      correction = {
        ...correction,
        history: [{ at: wall, from, to, smooth, confidence: match.confidence, estimated: event.estimated },
          ...correction.history].slice(0, 12),
      };
      return true;
    },
    snapshot({ doc: includeDoc, lines: includeLines } = {}) {
      const now = performance.now();
      const head = position(now);
      const duration = adjustment ? Math.max(0, 500 - (now - adjustment.start)) : 0;
      return {
        source, armed, serverTime: Date.now(),
        transport: {
          position: head, rate: transport.rate, playing: startedAt !== null && head < end, end,
          ...(duration > 0 && { adjustment: { duration, delta: adjustment.delta * duration / 500 } }),
        },
        manual: {
          index: manual.index, current: manual.current, next: nextLine(), autoSeconds: manual.autoSeconds,
          remaining: deadline === null ? null : Math.max(0, Math.round(deadline - now)),
          ...(includeLines && { lines: manual.lines }),
        },
        ...(includeDoc && { doc }),
      };
    },
    persisted() {
      return { source, armed, doc, transport: { ...transport, position: position(performance.now()) }, manual };
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
