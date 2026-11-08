import { buildLyricDocument, LYRIC_BYTES, jsonBytes, parseLrc, RATES, timelineIndex } from './lyrics-model.js';
import { createLyricsClock } from './lyrics-clock.js';
import { createLyricsRenderer } from './lyrics-renderer.js';

const $ = (id) => document.getElementById(id);
const clock = createLyricsClock();
const preview = createLyricsRenderer($('mini-canvas'));
const liveControls = [...document.querySelectorAll('[data-live]')];
const pending = new Map();
const instance = crypto.randomUUID();
const dialog = $('import-dialog');
let socket;
let ready = false;
let reconnectDelay = 500;
let requestNumber = 0;
let revision = 0;
let savedRevision = 0;
let saveError = '';
let lyricsVisible = true;
let draftDirty = false;
let entries = [];
let importDoc = [];
let importFits = true;
let renderFrame;
let timelineRow = -2;
let manualRow = null;
let timelineTokens = [];

for (const rate of RATES) $('rate').add(new Option(`${rate.toFixed(2)}×`, rate));

function message(text = '') {
  $('message').textContent = text;
}

function updateControls() {
  for (const control of liveControls) control.disabled = !ready;
  for (const id of ['play', 'back', 'forward', 'rate']) $(id).disabled = !ready || !clock.doc.length;
  $('load').disabled = !ready || !importDoc.length || !importFits;
  for (const button of document.querySelectorAll('.lyric-list button')) button.disabled = !ready;
  $('save-status').textContent = saveError || (savedRevision < revision ? '保存中' : '已保存');
}

function send(type, payload, onAccepted) {
  if (!ready || socket.readyState !== WebSocket.OPEN) return;
  const id = `${instance}-${++requestNumber}`;
  if (onAccepted) pending.set(id, onAccepted);
  socket.send(JSON.stringify({ type, id, payload }));
}

const transport = (action, value = null) => send('lyrics:transport', { action, value });
const manual = (action, value = null, accepted) => send('lyrics:manual', { action, value }, accepted);
const push = (source) => send('lyrics:onair', { source });

function timecode(position) {
  const ms = Math.floor(position);
  return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

function renderList(id, lines, display, select) {
  const list = $(id);
  list.replaceChildren(...lines.map((line, index) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    const count = document.createElement('time');
    count.textContent = typeof line === 'string' ? String(index + 1) : timecode(line.start);
    const text = document.createElement('span');
    text.textContent = display(line);
    button.append(count, text);
    button.onclick = () => select(line, index);
    item.append(button);
    return item;
  }));
}

function markRow(id, oldIndex, newIndex, follow = false) {
  const children = $(id).children;
  children[oldIndex]?.firstChild.removeAttribute('aria-current');
  const active = children[newIndex];
  active?.firstChild.setAttribute('aria-current', 'true');
  if (follow && active && !$(id).contains(document.activeElement)) active.scrollIntoView({ block: 'nearest' });
}

function drawTimeline(position, state) {
  const index = timelineIndex(clock.doc, position, state.transport.end);
  const line = clock.doc[index];
  if (index !== timelineRow) {
    markRow('timeline-list', timelineRow, index, true);
    timelineRow = index;
    timelineTokens = [];
    const view = $('timeline-preview');
    view.replaceChildren();
    if (line?.tokens.length && !line.credit) {
      timelineTokens = line.tokens.map((token) => {
        const span = document.createElement('span');
        span.textContent = token.text;
        return span;
      });
      view.append(...timelineTokens);
    } else {
      const span = document.createElement('span');
      span.className = 'is-line-level';
      span.textContent = line?.text ?? (clock.doc.length ? '等待当前句' : '等待载入歌词');
      view.append(span);
    }
  }
  const lineEnd = clock.doc[index + 1]?.start ?? state.transport.end;
  for (const [tokenIndex, span] of timelineTokens.entries()) {
    const start = line.tokens[tokenIndex].start;
    const end = line.tokens[tokenIndex + 1]?.start ?? lineEnd;
    const fill = position < start ? 0 : position >= end ? 100 : (position - start) / (end - start) * 100;
    const css = `${fill.toFixed(1)}%`;
    if (span.style.getPropertyValue('--fill') !== css) span.style.setProperty('--fill', css);
  }
}

function drawClock() {
  const state = clock.state;
  if (!state) return;
  const position = clock.position();
  const code = timecode(position);
  if ($('position').value !== code) $('position').value = code;
  drawTimeline(position, state);
  const playing = state.transport.playing && position < state.transport.end;
  $('play').textContent = playing ? '暂停' : '播放';
  const remaining = ready ? clock.remaining() : null;
  $('countdown').hidden = remaining === null;
  if (remaining !== null) {
    $('countdown').firstElementChild.textContent = Math.ceil(remaining / 1000);
    $('countdown').style.setProperty('--remaining', `${remaining / (state.manual.autoSeconds * 10)}%`);
  }
  if (playing || remaining > 0) renderFrame = requestAnimationFrame(drawClock);
}

function updateOutput() {
  const selected = clock.state?.armed ? clock.state.source : '';
  $('output-source').value = selected;
  for (const source of ['timeline', 'manual']) $(`${source}-air`).hidden = selected !== source || !lyricsVisible || !ready;
  $('output-status').textContent = !ready ? 'OBS 状态未确认' : !lyricsVisible ? 'OBS 歌词模块已隐藏' :
    selected ? `OBS · ${selected === 'timeline' ? '时间轴' : '手动'}` : 'OBS 待推送';
}

function renderState(state) {
  if (state.doc) {
    renderList('timeline-list', clock.doc, (line) => line.text + (line.credit ? ' · 署名' : ''), (line) => transport('seek', line.start));
    timelineRow = -2;
  }
  if (state.manual.lines) {
    renderList('manual-list', clock.lines, (line) => line, (_line, index) => manual('select', index));
    manualRow = null;
  }
  markRow('manual-list', manualRow, state.manual.index, true);
  manualRow = state.manual.index;
  if (!draftDirty) $('draft').value = state.manual.current;
  $('manual-current').textContent = state.manual.current || '—';
  $('manual-next').textContent = state.manual.next || '—';
  $('rate').value = state.transport.rate;
  $('auto').value = state.manual.autoSeconds;
  updateOutput();
  updateControls();
  cancelAnimationFrame(renderFrame);
  drawClock();
}

function connect() {
  socket = new WebSocket(new URL('/ws', location.href.replace(/^http/, 'ws')));
  socket.addEventListener('message', ({ data }) => {
    const state = JSON.parse(data);
    if (state.type === 'state') {
      const module = state.settings.modules.lyrics;
      if (!module) return;
      lyricsVisible = module.visible;
      preview.update(module);
      revision = state.revision;
      savedRevision = state.savedRevision;
      updateOutput();
      updateControls();
    } else if (state.type === 'lyrics:state') {
      if (!ready && !state.doc) return;
      if (!ready) {
        ready = true;
        reconnectDelay = 500;
        saveError = '';
        $('connection').textContent = '服务已连接';
      }
      revision = state.revision;
      savedRevision = state.savedRevision;
      clock.apply(state);
      preview.updateLyrics(clock);
      if (pending.has(state.id)) {
        pending.get(state.id)();
        pending.delete(state.id);
      }
      renderState(state);
    } else if (state.type === 'saved') {
      savedRevision = state.revision;
      saveError = '';
      updateControls();
    } else if (state.type === 'error') {
      pending.delete(state.id);
      if (state.scope === 'save') saveError = state.message;
      else if (state.id?.startsWith(instance)) message(state.message);
      updateControls();
    }
  });
  socket.addEventListener('close', () => {
    ready = false;
    if (pending.size) message('部分操作未收到确认。重连后请核对当前状态。');
    pending.clear();
    $('connection').textContent = '已断线 · 正在重连';
    updateControls();
    updateOutput();
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 5000);
  });
  socket.addEventListener('error', () => socket.close());
}

function syncImport() {
  const result = buildLyricDocument(entries);
  importDoc = result.doc;
  importFits = jsonBytes(importDoc) <= LYRIC_BYTES;
  const errors = new Map(result.errors.map(({ line, message: detail }) => [line, detail]));
  let invalid = 0;
  for (const entry of entries) {
    const error = entry.skip ? '' : entry.error || entry.lines.map((line) => errors.get(line)).find(Boolean);
    if (error) invalid += 1;
    entry.status.textContent = entry.skip ? '已跳过' : error || (entry.lines.some((line) => line.credit) ? '署名 · 仅显示' : '有效');
    entry.status.classList.toggle('invalid', Boolean(error));
  }
  $('import-result').textContent = !importFits ? '歌词文档超过 200 KiB，请删减后再载入。' :
    `${importDoc.length} 句可载入 · ${invalid} 行有问题`;
  updateControls();
}

function prepareImport() {
  const source = $('lrc-input').value;
  if (new TextEncoder().encode(source).length > LYRIC_BYTES) {
    invalidateImport();
    $('import-result').textContent = '输入文件超过 200 KiB。';
    return;
  }
  entries = parseLrc(source);
  $('import-list').replaceChildren(...entries.map((entry) => {
    const item = document.createElement('li');
    item.value = entry.number;
    const row = document.createElement('div');
    row.className = 'import-entry';
    const input = document.createElement('input');
    input.value = entry.raw;
    input.setAttribute('aria-label', `编辑第 ${entry.number} 行`);
    input.addEventListener('input', () => {
      const edited = parseLrc(input.value)[0];
      entry.lines = edited?.lines ?? [];
      entry.error = edited?.error || (entry.lines.length ? '' : '空白或元数据行');
      syncImport();
    });
    const skip = document.createElement('button');
    skip.textContent = '跳过';
    skip.onclick = () => {
      entry.skip = !entry.skip;
      skip.textContent = entry.skip ? '恢复' : '跳过';
      syncImport();
    };
    const remove = document.createElement('button');
    remove.textContent = '删除';
    remove.onclick = () => {
      entries = entries.filter((other) => other !== entry);
      item.remove();
      syncImport();
    };
    entry.status = document.createElement('small');
    row.append(input, skip, remove, entry.status);
    item.append(row);
    return item;
  }));
  syncImport();
}

function invalidateImport() {
  entries = [];
  $('import-list').replaceChildren();
  syncImport();
  $('import-result').textContent = '文本已更改，请重新解析预览。';
}

document.querySelectorAll('[data-push]').forEach((button) => {
  button.onclick = () => push(button.dataset.push);
});
$('output-source').onchange = (event) => {
  const source = event.target.value;
  updateOutput();
  if (source) push(source);
};
$('play').onclick = () => transport(clock.state.transport.playing && clock.position() < clock.state.transport.end ? 'pause' : 'play');
$('back').onclick = () => transport('nudge', -500);
$('forward').onclick = () => transport('nudge', 500);
$('rate').onchange = ({ target }) => transport('rate', Number(target.value));
$('draft').oninput = () => { draftDirty = true; };
$('commit').onclick = () => {
  const submitted = $('draft').value;
  manual('commit', submitted, () => {
    if ($('draft').value === submitted) draftDirty = false;
    message('当前句已更新');
  });
};
$('previous').onclick = () => manual('step', -1);
$('next').onclick = () => manual('step', 1);
$('clear').onclick = () => manual('clear');
$('auto').onchange = ({ target }) => manual('auto', Number(target.value));
$('manual-import').onclick = () => {
  const lines = $('manual-paste').value.split(/\r\n?|\n/).map((line) => line.trim()).filter(Boolean);
  if (jsonBytes(lines) > 15 * 1024) return message('手动列表超过 15 KiB，请删减后再载入。');
  manual('load', lines, () => message(`已载入 ${lines.length} 句手动字幕`));
};
$('manual-column').addEventListener('keydown', (event) => {
  if (!ready || event.isComposing || event.keyCode === 229 || event.repeat ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.target !== $('manual-hotkeys') && !event.target.closest('#manual-list button')) return;
  const action = { Enter: 1, ArrowRight: 1, ' ': 1, ArrowLeft: -1, Escape: 0 }[event.key];
  if (action === undefined) return;
  event.preventDefault();
  if (action) manual('step', action);
  else manual('clear');
});
$('open-import').onclick = () => dialog.showModal();
$('close-import').onclick = () => dialog.close();
$('lrc-input').oninput = invalidateImport;
$('parse').onclick = prepareImport;
$('lrc-file').onchange = async ({ target }) => {
  const file = target.files[0];
  if (!file) return;
  if (file.size > LYRIC_BYTES) {
    invalidateImport();
    $('import-result').textContent = '输入文件超过 200 KiB。';
    return;
  }
  try {
    $('lrc-input').value = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    prepareImport();
  } catch {
    invalidateImport();
    $('import-result').textContent = '无法读取文件，请选择 UTF-8 编码的 LRC。';
  }
};
$('load').onclick = () => send('lyrics:load', { doc: importDoc }, () => {
  dialog.close();
  message(`已载入 ${importDoc.length} 句时间轴歌词`);
});
connect();
