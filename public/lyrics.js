import { buildLyricDocument, LYRIC_BYTES, jsonBytes, parseLrc, RATES, timelineIndex } from './lyrics-model.js';
import { createLyricsClock, timecode } from './lyrics-clock.js';
import { createLyricsRenderer } from './lyrics-renderer.js';
import { highlightLyrics, clearLyricHighlight, LYRIC_HIGHLIGHT_CSS } from './lyrics-highlight.js';
import { bindAsrControls } from './asr-controls.js';

const $ = (id) => document.getElementById(id);
const highlightStyle = document.createElement('style');
highlightStyle.textContent = LYRIC_HIGHLIGHT_CSS;
document.head.append(highlightStyle);
let highlightedElements = [];
const clock = createLyricsClock();
const preview = createLyricsRenderer($('mini-canvas'));
const asr = bindAsrControls({ correct: (enabled) => send('lyrics:correct', { enabled }), timecode });
const liveControls = [...document.querySelectorAll('[data-live]')];
const playButtons = [...document.querySelectorAll('[data-play]')];
const pending = new Map();
const instance = crypto.randomUUID();
const dialog = $('import-dialog');
const nextColumn = $('up-next');
const columns = nextColumn.parentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const NEXT_LEAD_MS = 15_000;
let socket;
let ready = false;
let reconnectDelay = 500;
let requestNumber = 0;
let revision = 0;
let savedRevision = 0;
let saveError = '';
let lyricsVisible = true;
let entries = [];
let importDoc = [];
let importFits = true;
let importRequest;
let importKey;
let suggestedTitle = '';
let suggestedArtist = '';
let songCatalog = [];
let selectedSong = null;
let nextSong;
let nextSongPreview;
let nextColumnOpen = false;
let renderFrame;
let timelineRow = -2;
let manualRow = null;
let manualSelection;
let manualFollowsTimeline = false;
let timelineFollowTimer;

for (const rate of RATES) $('rate').add(new Option(`${rate.toFixed(2)}×`, rate));

function message(text = '') {
  $('message').textContent = text;
}

function updateControls() {
  for (const control of liveControls) control.disabled = !ready;
  for (const id of ['play', 'manual-play', 'back', 'forward', 'rate']) $(id).disabled = !ready || !clock.doc.length;
  $('load').disabled = !ready || !importDoc.length || !importFits || !$('song-title').value.trim() || Boolean(importRequest);
  $('song-select').disabled = !ready || !songCatalog.length;
  $('song-load').disabled = !ready || !$('song-select').value;
  $('load-next').disabled = !ready || !nextSong;
  for (const button of document.querySelectorAll('.lyric-list button')) button.disabled = !ready;
  $('save-status').textContent = saveError || (savedRevision < revision ? '保存中' : '已保存');
}

function send(type, payload, onAccepted) {
  if (!ready || socket.readyState !== WebSocket.OPEN) return;
  const id = `${instance}-${++requestNumber}`;
  if (onAccepted) pending.set(id, onAccepted);
  socket.send(JSON.stringify({ type, id, payload }));
  return id;
}

const transport = (action, value = null) => send('lyrics:transport', { action, value });
const manual = (action, value = null) => {
  if (action !== 'auto') manualFollowsTimeline = false;
  return send('lyrics:manual', { action, value });
};
const push = (source) => send('lyrics:onair', { source });

function renderList(id, lines, display, select) {
  const list = $(id);
  list.replaceChildren(...lines.map((line, index) => {
    const item = document.createElement('li');
    const row = document.createElement(select ? 'button' : 'div');
    row.className = 'lyric-row';
    const count = document.createElement('time');
    count.textContent = typeof line === 'string' ? String(index + 1) : timecode(line.start);
    const text = document.createElement('span');
    text.className = 'lyric-line-text';
    text.textContent = display(line);
    row.append(count, text);
    if (select) row.onclick = () => select(line, index);
    item.append(row);
    return item;
  }));
  if (!lines.length) {
    const empty = document.createElement('li');
    empty.className = 'lyrics-empty';
    empty.textContent = '等待导入歌词';
    list.append(empty);
  }
}

function markRow(id, oldIndex, newIndex, follow = false) {
  const list = $(id);
  const children = list.children;
  if (Number.isInteger(oldIndex) && oldIndex >= 0) {
    for (let index = oldIndex - 2; index <= oldIndex + 2; index += 1) {
      const row = children[index]?.firstElementChild;
      row?.removeAttribute('aria-current');
      row?.removeAttribute('data-distance');
    }
  }
  const active = children[newIndex]?.querySelector('.lyric-row');
  list.classList.toggle('has-active', Boolean(active));
  if (!active) return;
  active.setAttribute('aria-current', 'true');
  for (let index = newIndex - 2; index <= newIndex + 2; index += 1) {
    const row = children[index]?.firstElementChild;
    if (row) row.dataset.distance = Math.abs(index - newIndex);
  }
  if (follow && !list.contains(document.activeElement)) {
    centerRow(list, newIndex);
  }
}

function centerRow(list, index) {
  const target = list.children[index];
  if (!target) return;
  const top = target.offsetTop - (list.clientHeight - target.offsetHeight) / 2;
  list.scrollTo({ top, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
}

function pauseTimelineFollow() {
  clearTimeout(timelineFollowTimer);
  timelineFollowTimer = setTimeout(() => {
    timelineFollowTimer = undefined;
    centerRow($('timeline-list'), timelineRow);
  }, 3000);
}

const timelineList = $('timeline-list');
timelineList.addEventListener('wheel', pauseTimelineFollow, { passive: true });
timelineList.addEventListener('touchmove', pauseTimelineFollow, { passive: true });
timelineList.addEventListener('pointerdown', (event) => {
  if (event.target === timelineList && event.clientX >= timelineList.getBoundingClientRect().left + timelineList.clientWidth) {
    pauseTimelineFollow();
  }
});
timelineList.addEventListener('keydown', (event) => {
  if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) pauseTimelineFollow();
});

columns.addEventListener('transitionend', (event) => {
  if (event.target !== columns || event.propertyName !== 'grid-template-columns') return;
  if (!timelineFollowTimer) centerRow(timelineList, timelineRow);
  if (manualFollowsTimeline) centerRow($('manual-list'), manualRow);
  centerRow($('reference-list'), timelineRow);
});

function drawTimeline(position, state, playing) {
  const index = Math.min(clock.doc.length - 1, timelineIndex(clock.doc, position, state.transport.end));
  if (index !== timelineRow) {
    markRow('timeline-list', timelineRow, index);
    markRow('reference-list', timelineRow, index, true);
    timelineRow = index;
    if (!timelineFollowTimer) centerRow(timelineList, index);
  }
  if (playing && clock.usesDocument) manualFollowsTimeline = true;
  const manualIndex = manualFollowsTimeline ? index : state.manual.index;
  if (manualRow !== manualIndex) {
    markRow('manual-list', manualRow, manualIndex, !manualFollowsTimeline);
    if (manualFollowsTimeline) centerRow($('manual-list'), manualIndex);
    manualRow = manualIndex;
  }
  const line = clock.doc[index];
  const lists = ['timeline-list', 'reference-list'];
  if (manualFollowsTimeline && clock.usesDocument) lists.push('manual-list');
  const elements = line ? lists.map((id) => $(id).children[index]?.querySelector('.lyric-line-text')).filter(Boolean) : [];
  for (const previous of highlightedElements) {
    if (!elements.includes(previous)) clearLyricHighlight(previous, previous.textContent);
  }
  for (const element of elements) {
    highlightLyrics(element, line, position, clock.doc[index + 1]?.start ?? state.transport.end);
  }
  highlightedElements = elements;
}

function drawClock() {
  const state = clock.state;
  if (!state) return;
  const position = clock.position();
  const code = timecode(position);
  if ($('position').value !== code) $('position').value = code;
  const playing = state.transport.playing && position < state.transport.end;
  updateNextColumn(position);
  drawTimeline(position, state, playing);
  for (const button of playButtons) {
    const label = playing ? '暂停' : '播放';
    if (button.textContent !== label) button.textContent = label;
  }
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
  const outputSource = $('output-source');
  outputSource.value = selected;
  outputSource.options[0].textContent = selected ? '停止推送' : '待推送';
  const asrLive = ready && clock.asr?.phase === 'listening';
  $('asr-push').disabled = !asrLive;
  $('asr-option').disabled = !asrLive;
  for (const source of ['timeline', 'manual', 'asr']) {
    $(`${source}-air`).hidden = selected !== source || !lyricsVisible || !ready || (source === 'asr' && !asrLive);
  }
  const names = { timeline: '时间轴', manual: '手动', asr: asrLive ? '语音识别' : '语音识别已停止' };
  $('output-status').textContent = !ready ? 'OBS 状态未确认' : !lyricsVisible ? 'OBS 歌词模块已隐藏' :
    selected ? `OBS · ${names[selected]}` : 'OBS 待推送';
}

function renderState(state) {
  if (state.doc) {
    clearTimeout(timelineFollowTimer);
    timelineFollowTimer = undefined;
    renderList('timeline-list', clock.doc, (line) => line.text + (line.credit ? ' · 署名' : ''), (line) => transport('seek', line.start));
    renderList('reference-list', clock.doc, (line) => line.text + (line.credit ? ' · 署名' : ''));
    timelineRow = -2;
    manualFollowsTimeline = false;
  }
  if (Object.hasOwn(state.manual, 'lines')) {
    renderList('manual-list', clock.lines, (line) => line, (_line, index) => manual('select', index));
    manualRow = undefined;
    if (!clock.usesDocument) manualFollowsTimeline = false;
  }
  if (manualSelection !== state.manual.index) {
    manualSelection = state.manual.index;
    manualFollowsTimeline = false;
  }
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
    } else if (state.type === 'lyrics:songs') {
      songCatalog = state.songs;
      selectedSong = state.activeId;
      renderSongs();
    } else if (state.type === 'lyrics:asr') {
      clock.applyAsr(state);
      asr.update(state, ready);
      preview.updateLyrics(clock);
      updateOutput();
    } else if (state.type === 'saved') {
      savedRevision = state.revision;
      saveError = '';
      updateControls();
    } else if (state.type === 'error') {
      pending.delete(state.id);
      if (state.id && state.id === importRequest) {
        importRequest = undefined;
        $('import-result').textContent = state.message;
      }
      if (state.scope === 'save') saveError = state.message;
      else if (state.id?.startsWith(instance)) message(state.message);
      updateControls();
    }
  });
  socket.addEventListener('close', () => {
    ready = false;
    asr.update(undefined, false);
    if (pending.size) message('部分操作未收到确认。重连后请核对当前状态。');
    pending.clear();
    if (importRequest) {
      importRequest = undefined;
      $('import-result').textContent = '连接中断。重连后可以重试保存。';
    }
    $('connection').textContent = '已断线 · 正在重连';
    updateControls();
    updateOutput();
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 5000);
  });
  socket.addEventListener('error', () => socket.close());
}

const songNameKey = (name) => name.normalize('NFKC').trim().toLowerCase();
const songVersionLabel = (song) => `${new Date(song.updatedAt).toLocaleString()} · ${song.id.slice(0, 6)}`;

function renderReplaceChoices() {
  const select = $('replace-song');
  const previous = select.value;
  const name = songNameKey($('song-title').value);
  const matches = songCatalog.filter((song) => songNameKey(song.title) === name);
  $('replace-song-field').hidden = !matches.length;
  select.replaceChildren(new Option('保留已有版本，新建', ''), ...matches.map((song) =>
    new Option(`替换 ${songVersionLabel(song)}`, song.id)));
  if (matches.some((song) => song.id === previous)) select.value = previous;
}

function renderSongs() {
  const counts = new Map();
  for (const song of songCatalog) {
    const name = songNameKey(song.title);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const select = $('song-select');
  select.replaceChildren(new Option(songCatalog.length ? '选择歌曲' : '曲库暂无歌曲', ''),
    ...songCatalog.map((song) => new Option(counts.get(songNameKey(song.title)) > 1
      ? `${song.title} · ${songVersionLabel(song)}` : song.title, song.id)));
  select.value = selectedSong ?? '';
  const activeIndex = songCatalog.findIndex((song) => song.id === selectedSong);
  const current = songCatalog[activeIndex];
  $('current-song').textContent = current?.title ?? '尚未载入歌曲';
  $('current-artist').textContent = current ? current.artist || '歌手未填写' : '';
  nextSong = current ? songCatalog[activeIndex + 1] : undefined;
  if (!nextSong || nextSongPreview?.id !== nextSong.id || nextSongPreview.updatedAt !== nextSong.updatedAt) {
    nextSongPreview = undefined;
  }
  updateNextColumn();
  renderReplaceChoices();
  updateControls();
}

function updateNextColumn(position = clock.position()) {
  const state = clock.state;
  const visible = Boolean(state?.songId === selectedSong && clock.doc.length &&
    state.transport.end - position <= NEXT_LEAD_MS);
  if (visible !== nextColumnOpen) {
    nextColumnOpen = visible;
    if (!visible && nextColumn.contains(document.activeElement)) $('play').focus({ preventScroll: true });
    nextColumn.inert = !visible;
    nextColumn.setAttribute('aria-hidden', String(!visible));
    columns.classList.toggle('has-next', visible);
  }
  if (!visible) return;
  if (!nextSong) {
    if ($('next-song').textContent !== '暂无下一首') {
      $('next-song').textContent = '暂无下一首';
      $('next-artist').textContent = '';
      $('up-next-list').replaceChildren();
    }
    return;
  }
  if (nextSongPreview) return;
  $('next-song').textContent = nextSong.title;
  $('next-artist').textContent = nextSong.artist || '歌手未填写';
  const request = nextSongPreview = { id: nextSong.id, updatedAt: nextSong.updatedAt };
  $('up-next-list').textContent = '正在读取歌词…';
  fetch(`/api/lyrics/song?${new URLSearchParams({ id: request.id })}`)
    .then((response) => {
      if (!response.ok) throw new Error('无法读取下一首歌词。');
      return response.json();
    })
    .then((lines) => {
      if (nextSongPreview === request) renderList('up-next-list', lines, (line) => line);
    })
    .catch(() => {
      if (nextSongPreview === request) $('up-next-list').textContent = '无法读取下一首歌词。';
    });
}

function syncImport() {
  importKey = undefined;
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

function prepareImport(filename = '') {
  const source = $('lrc-input').value;
  if (new TextEncoder().encode(source).length > LYRIC_BYTES) {
    invalidateImport();
    $('import-result').textContent = '输入文件超过 200 KiB。';
    return;
  }
  const fromMetadata = /^\s*\[ti:([^\]\r\n]+)\]/imu.exec(source)?.[1].trim();
  const title = $('song-title');
  if (!title.value.trim() || title.value === suggestedTitle) {
    suggestedTitle = (fromMetadata || filename.replace(/\.[^.]+$/u, '')).slice(0, 100);
    title.value = suggestedTitle;
    renderReplaceChoices();
  }
  const artist = $('song-artist');
  if (!artist.value.trim() || artist.value === suggestedArtist) {
    suggestedArtist = (/^\s*\[ar:([^\]\r\n]+)\]/imu.exec(source)?.[1].trim() ?? '').slice(0, 100);
    artist.value = suggestedArtist;
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
  const source = event.target.value || null;
  updateOutput();
  push(source);
};
for (const button of playButtons) {
  button.onclick = () => transport(clock.state.transport.playing && clock.position() < clock.state.transport.end ? 'pause' : 'play');
}
$('back').onclick = () => transport('nudge', -500);
$('forward').onclick = () => transport('nudge', 500);
$('rate').onchange = ({ target }) => transport('rate', Number(target.value));
$('previous').onclick = () => manual('step', -1);
$('next').onclick = () => manual('step', 1);
$('clear').onclick = () => manual('clear');
$('auto').onchange = ({ target }) => manual('auto', Number(target.value));
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
$('song-title').oninput = () => {
  importKey = undefined;
  renderReplaceChoices();
  updateControls();
};
$('song-artist').oninput = () => { importKey = undefined; };
$('replace-song').onchange = () => { importKey = undefined; };
$('song-select').onchange = updateControls;
function loadSong(id) {
  send('lyrics:select-song', { id }, () => {
    message(`已载入《${songCatalog.find((song) => song.id === selectedSong)?.title ?? '歌曲'}》`);
  });
}
$('song-load').onclick = () => loadSong($('song-select').value);
$('load-next').onclick = () => loadSong(nextSong.id);
$('parse').onclick = () => prepareImport();
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
    prepareImport(file.name);
  } catch {
    invalidateImport();
    $('import-result').textContent = '无法读取文件，请选择 UTF-8 编码的 LRC。';
  }
};
$('load').onclick = () => {
  const title = $('song-title').value.trim();
  const artist = $('song-artist').value.trim();
  const replaceId = $('replace-song').value;
  const count = importDoc.length;
  importKey ??= crypto.randomUUID().replaceAll('-', '');
  importRequest = send('lyrics:load', { doc: importDoc, title, artist, saveKey: importKey, ...(replaceId && { replaceId }) }, () => {
    importRequest = undefined;
    dialog.close();
    message(`已保存并载入《${title}》 · ${count} 句`);
    $('song-title').value = '';
    $('song-artist').value = '';
    $('lrc-input').value = '';
    $('lrc-file').value = '';
    suggestedTitle = '';
    suggestedArtist = '';
    invalidateImport();
    renderReplaceChoices();
  });
  updateControls();
};
connect();
