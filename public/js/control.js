import { bindStageControls } from './stage/stage-controls.js';
import { createLogoRenderer } from './render/logo-renderer.js';
import { createHostsRenderer } from './render/hosts-renderer.js';
import { createProgramRenderer } from './render/program-renderer.js';
import { createLyricsRenderer } from './render/lyrics-renderer.js';
import { createLyricsClock, timecode } from './lyrics/lyrics-clock.js';
import { createAvoidance } from './stage/stage-avoidance.js';
import { createSpeechRenderer } from './render/speech-renderer.js';
import { bindAsrControls } from './asr/asr-controls.js';

import { initThemedSelects } from './core/themed-select.js';

const $ = (id) => document.getElementById(id);
initThemedSelects();
const MODULE_ORDER = ['logo', 'hosts', 'program', 'lyrics', 'speech'];
const lyricsClock = createLyricsClock();
const ANIMATION_OPTIONS = [
  ['none', '无动画'],
  ['fade', '淡入淡出'],
  ['fade-up', '上浮'],
  ['fade-down', '下沉'],
  ['slide-left', '左滑'],
  ['slide-right', '右滑'],
  ['scale-in', '缩放'],
];
const DEFAULT_ANIMATION = { enter: 'fade-up', exit: 'fade-down', duration: 600 };
const GEOMETRY_KEYS = new Set(['x', 'y', 'scale']);
const NO_CLAMP_KEYS = new Set(['x', 'y', 'scale', 'opacity', 'visible', 'autoHideAfterTear', 'animation', 'color', 'textColor', 'accentColor', 'queue']);

const MODULES = {
  speech: {
    name: '主持人语音字幕',
    create: createSpeechRenderer,
    fields: [
      { key: 'textColor', id: 'speechTextColor', hexId: 'speechTextColorHex', kind: 'color' },
      { key: 'scale', id: 'speechScale', numberId: 'speechScaleNumber', kind: 'percent' },
      { key: 'opacity', id: 'speechOpacity', numberId: 'speechOpacityNumber', kind: 'opacity' },
    ],
    position: { x: 'speechX', xRange: 'speechXRange', xMax: 'speechXMax', y: 'speechY', yRange: 'speechYRange', yMax: 'speechYMax' },
    animation: { enter: 'speechEnter', exit: 'speechExit', duration: 'speechDuration', durationNumber: 'speechDurationNumber' },
    summary() { return '主持人语音字幕'; },
  },
  logo: {
    name: 'Logo 挂角',
    create: createLogoRenderer,
    fields: [
      { key: 'title', id: 'logoTitle', kind: 'text' },
      { key: 'subtitle', id: 'logoSubtitle', kind: 'text' },
      { key: 'showMark', id: 'logoShowMark', kind: 'boolean' },
      { key: 'textColor', id: 'logoTextColor', hexId: 'logoTextColorHex', kind: 'color' },
      { key: 'weight', id: 'logoWeight', numberId: 'logoWeightNumber', kind: 'weight' },
      { key: 'scale', id: 'logoScale', numberId: 'logoScaleNumber', kind: 'percent' },
      { key: 'opacity', id: 'logoOpacity', numberId: 'logoOpacityNumber', kind: 'opacity' },
    ],
    position: { x: 'logoX', xRange: 'logoXRange', xMax: 'logoXMax', y: 'logoY', yRange: 'logoYRange', yMax: 'logoYMax' },
    animation: { enter: 'logoEnter', exit: 'logoExit', duration: 'logoDuration', durationNumber: 'logoDurationNumber' },
    summary(module) { return module.title || 'Logo 挂角'; },
  },
  hosts: {
    name: '人物信息条',
    create: createHostsRenderer,
    fields: [
      { key: 'label', id: 'hostsLabel', kind: 'text' },
      { key: 'slotCount', id: 'hostsSlotCount', numberId: 'hostsSlotCountNumber', kind: 'raw' },
      { key: 'scale', id: 'hostsScale', numberId: 'hostsScaleNumber', kind: 'percent' },
      { key: 'opacity', id: 'hostsOpacity', numberId: 'hostsOpacityNumber', kind: 'opacity' },
    ],
    position: { x: 'hostsX', xRange: 'hostsXRange', xMax: 'hostsXMax', y: 'hostsY', yRange: 'hostsYRange', yMax: 'hostsYMax' },
    animation: { enter: 'hostsEnter', exit: 'hostsExit', duration: 'hostsDuration', durationNumber: 'hostsDurationNumber' },
    summary(module) {
      const people = module.people ?? [];
      return [module.label, ...(module.slots ?? []).slice(0, module.slotCount)
        .filter((slot) => !slot.hidden).map((slot) => people.find((p) => p.id === slot.personId)?.name)]
        .filter(Boolean).join(' · ') || '人物信息条';
    },
  },
  program: {
    name: '节目单',
    create: createProgramRenderer,
    fields: [
      { key: 'label', id: 'programLabel', kind: 'text' },
      { key: 'nextLabel', id: 'programNextLabel', kind: 'text' },
      { key: 'autoHideAfterTear', id: 'programAutoHideAfterTear', kind: 'boolean' },
      { key: 'scale', id: 'programScale', numberId: 'programScaleNumber', kind: 'percent' },
      { key: 'opacity', id: 'programOpacity', numberId: 'programOpacityNumber', kind: 'opacity' },
    ],
    position: { x: 'programX', xRange: 'programXRange', xMax: 'programXMax', y: 'programY', yRange: 'programYRange', yMax: 'programYMax' },
    animation: { enter: 'programEnter', exit: 'programExit', duration: 'programDuration', durationNumber: 'programDurationNumber' },
    summary(module) { return [module.label, module.current].filter(Boolean).join(' · ') || '节目单'; },
  },
  lyrics: {
    name: '歌词字幕',
    create: createLyricsRenderer,
    fields: [
      { key: 'accentColor', id: 'lyricsAccent', hexId: 'lyricsAccentHex', kind: 'color' },
      { key: 'textColor', id: 'lyricsTextColor', hexId: 'lyricsTextColorHex', kind: 'color' },
      { key: 'scale', id: 'lyricsScale', numberId: 'lyricsScaleNumber', kind: 'percent' },
      { key: 'opacity', id: 'lyricsOpacity', numberId: 'lyricsOpacityNumber', kind: 'opacity' },
    ],
    position: { x: 'lyricsX', xRange: 'lyricsXRange', xMax: 'lyricsXMax', y: 'lyricsY', yRange: 'lyricsYRange', yMax: 'lyricsYMax' },
    animation: { enter: 'lyricsEnter', exit: 'lyricsExit', duration: 'lyricsDuration', durationNumber: 'lyricsDurationNumber' },
    summary() { return '歌词字幕'; },
  },
};

const FALLBACK_SETTINGS = {
  version: 2,
  canvas: { width: 1920, height: 1080 },
  modules: {
    speech: { visible: false, textColor: '#F4F0E8', x: 240, y: 848, scale: 1, opacity: 100, animation: { enter: 'fade', exit: 'fade', duration: 200 } },
    logo: { visible: true, showMark: true, title: '中山市烟洲中学', subtitle: 'YANZHOU · LIVE', textColor: '#F4F0E8', weight: 500, x: 112, y: 70, scale: 1, opacity: 100, animation: { ...DEFAULT_ANIMATION } },
    hosts: { visible: false, label: '主持人', names: '张三\n李四', slotCount: 2, style: 'h', customColors: false, accentColor: '#71C4DE', textColor: '#2C2C2E', x: 96, y: 912, scale: 1, opacity: 100, animation: { ...DEFAULT_ANIMATION } },
    program: { visible: false, autoHideAfterTear: false, label: '正在演出', current: '节目名称', nextLabel: '接下来', next: '下一个节目', accentColor: '#A69AF5', textColor: '#F4F0E8', x: 1280, y: 770, scale: 1, opacity: 100, animation: { ...DEFAULT_ANIMATION } },
    lyrics: { visible: true, accentColor: '#F4F0E8', textColor: '#F4F0E8', x: 240, y: 678, scale: 1, opacity: 100, animation: { enter: 'none', exit: 'none', duration: 200 } },
  },
};

let settings = structuredClone(FALLBACK_SETTINGS);
let socket;
let ready = false;
let revision = 0;
let savedRevision = -1;
let saveError = '';
let reconnectTimer;
let reconnectDelay = 700;
let flushFrame = 0;
let toastTimer;
let previewZoom = 1;
let activeModule = 'logo';
const stageControls = bindStageControls({
  send: (message) => socket.send(JSON.stringify(message)),
  edit, toast,
});
const pendingPatches = new Map();
const localIntent = new Map();
const sentPatches = new Map();
const previewRenderers = {};
const measureRenderers = new Map();
const measureStage = document.createElement('div');
measureStage.className = 'measure-stage';
measureStage.setAttribute('aria-hidden', 'true');
document.body.append(measureStage);
for (const moduleId of MODULE_ORDER) previewRenderers[moduleId] = MODULES[moduleId].create($('previewCanvas'));
// 上屏先后顺序由服务端维护（只在内存里），预览与 OBS 输出用同一顺序计算自动避让。
let showOrder = null;
let ticketState;
let pendingTicketId;
const programTear = $('programTear');
programTear.onclick = () => {
  if (programTear.disabled || socket?.readyState !== WebSocket.OPEN) return;
  flush();
  if (socket.readyState !== WebSocket.OPEN) return;
  pendingTicketId = `ticket-${crypto.randomUUID()}`;
  socket.send(JSON.stringify({
    type: 'program:ticket-set', id: pendingTicketId, cycle: ticketState.cycle, torn: ticketState.tornAt === null,
  }));
  renderTicketControl();
};
const avoidance = createAvoidance(previewRenderers, () => ({ settings, showOrder }));
let renderFrame = 0;
function scheduleRender() {
  if (!renderFrame) renderFrame = requestAnimationFrame(() => { renderFrame = 0; render(); });
}
let focusRenderer = null;
let lyricsProgressTimer;
let playlistRequest = 0;
let speechState;
let sharedAsr;
const speechAsr = bindAsrControls({ prefix: 'speech-', owner: 'speech', timecode,
  command: (type, options) => { if (ready) socket.send(JSON.stringify({ type, options })); },
});
$('speech-clear').onclick = () => { if (ready) socket.send(JSON.stringify({ type: 'speech:clear' })); };

function setInput(id, value) {
  const input = $(id);
  if (document.activeElement !== input && input.value !== String(value)) input.value = value;
}

function setSelectValue(id, value) {
  const select = $(id);
  if (document.activeElement !== select && select.value !== value) select.value = value;
}

function updateRange(id, value) {
  const input = $(id);
  input.value = value;
  const span = Number(input.max) - Number(input.min);
  const percent = span > 0 ? (Number(input.value) - Number(input.min)) / span * 100 : 0;
  input.style.setProperty('--range-progress', percent + '%');
}

function readValue(moduleId, key) {
  const module = settings.modules[moduleId];
  if (key.includes('.')) {
    const [head, sub] = key.split('.');
    return module?.[head]?.[sub];
  }
  return module?.[key];
}

function writeValue(moduleId, key, value) {
  const module = settings.modules[moduleId];
  if (key.includes('.')) {
    const [head, sub] = key.split('.');
    module[head] = { ...module[head], [sub]: value };
  } else {
    module[key] = value;
  }
}

function addPending(moduleId, key, value) {
  const bag = pendingPatches.get(moduleId) ?? {};
  if (key.startsWith('animation.')) {
    const sub = key.slice('animation.'.length);
    bag.animation = { ...(bag.animation ?? {}), [sub]: value };
  } else {
    bag[key] = value;
  }
  pendingPatches.set(moduleId, bag);
}

function hasPendingChanges() {
  for (const bag of pendingPatches.values()) if (Object.keys(bag).length) return true;
  return false;
}

function setOne(moduleId, key, value) {
  if (readValue(moduleId, key) === value) return false;
  writeValue(moduleId, key, value);
  localIntent.set(`${moduleId}.${key}`, { module: moduleId, key, value });
  addPending(moduleId, key, value);
  return true;
}

function clampPosition(moduleId, patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return patch;
  const touchesGeometry = keys.some((key) => GEOMETRY_KEYS.has(key));
  const touchesContent = keys.some((key) => !NO_CLAMP_KEYS.has(key));
  if (!touchesGeometry && !touchesContent) return patch;

  const current = settings.modules[moduleId];
  let renderer = previewRenderers[moduleId];
  if (touchesContent || patch.scale !== undefined) {
    if (!measureRenderers.has(moduleId)) {
      measureRenderers.set(moduleId, MODULES[moduleId].create(measureStage));
    }
    renderer = measureRenderers.get(moduleId);
    renderer.update({ ...current, ...patch, visible: true, animation: current.animation }, { animate: false, constrain: false });
  }

  const { minX, maxX, minY, maxY } = positionLimits(renderer);
  if (patch.x !== undefined) patch.x = Math.round(Math.min(maxX, Math.max(minX, patch.x)));
  if (patch.y !== undefined) patch.y = Math.round(Math.min(maxY, Math.max(minY, patch.y)));
  if (patch.scale !== undefined || touchesContent) {
    if (current.x > maxX || current.x < minX) patch.x = Math.min(maxX, Math.max(minX, current.x));
    if (current.y > maxY || current.y < minY) patch.y = Math.min(maxY, Math.max(minY, current.y));
  }
  return patch;
}

function positionLimits(renderer) {
  if (renderer.getPositionLimits) return renderer.getPositionLimits();
  const bounds = renderer.getBounds();
  return {
    minX: 0, maxX: Math.max(0, Math.floor(settings.canvas.width - bounds.width)),
    minY: 0, maxY: Math.max(0, Math.floor(settings.canvas.height - bounds.height)),
  };
}

function edit(moduleId, patch) {
  patch = clampPosition(moduleId, { ...patch });
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'animation') {
      for (const [subKey, subValue] of Object.entries(value)) {
        if (setOne(moduleId, `animation.${subKey}`, subValue)) changed = true;
      }
    } else if (setOne(moduleId, key, value)) {
      changed = true;
    }
  }
  if (!changed) return;
  saveError = '';
  render();
  queueFlush();
}

function queueFlush() {
  if (flushFrame) return;
  flushFrame = requestAnimationFrame(() => {
    flushFrame = 0;
    flush();
  });
}

function flush() {
  if (!ready || !socket || socket.readyState !== WebSocket.OPEN) return;
  for (const [moduleId, values] of pendingPatches) {
    if (!Object.keys(values).length) continue;
    const id = crypto.randomUUID();
    try {
      socket.send(JSON.stringify({ type: 'patch', id, patch: { modules: { [moduleId]: values } } }));
    } catch {
      ready = false;
      updateConnection('disconnected');
      return;
    }
    pendingPatches.delete(moduleId);
    sentPatches.set(id, { module: moduleId, values });
    if (sentPatches.size > 100) sentPatches.delete(sentPatches.keys().next().value);
  }
}

let saveStatusTimer;
let saveStatusSince = 0;
function updateSaveStatus(deferred = false) {
  clearTimeout(saveStatusTimer);
  const busy = localIntent.size || hasPendingChanges() || savedRevision < revision;
  if (!deferred && ready && !saveError && !busy && saveStatusSince && performance.now() - saveStatusSince < 250) {
    saveStatusTimer = setTimeout(() => updateSaveStatus(true), 250 - (performance.now() - saveStatusSince));
    return;
  }
  const status = $('saveStatus');
  status.classList.remove('saving', 'offline', 'error');
  if (saveError) {
    status.classList.add('error');
    $('saveText').textContent = '设置保存失败';
    $('saveDetail').textContent = saveError;
  } else if (!ready) {
    status.classList.add('offline');
    $('saveText').textContent = localIntent.size ? '连接断开 · 改动待同步' : '正在连接本地服务';
    $('saveDetail').textContent = '';
  } else if (localIntent.size || hasPendingChanges() || savedRevision < revision) {
    if (!saveStatusSince) saveStatusSince = performance.now();
    status.classList.add('saving');
    $('saveText').textContent = '正在保存设置';
    $('saveDetail').textContent = '';
  } else {
    saveStatusSince = 0;
    $('saveText').textContent = '已保存';
    $('saveDetail').textContent = '';
  }
}

function updateConnection(state) {
  $('connectionStatus').className = 'connection-status ' + state;
  $('connectionText').textContent = state === 'connected' ? '服务已连接' : state === 'disconnected' ? '连接已断开' : '正在连接';
  $('previewOffline').hidden = state === 'connected';
  stageControls.render(settings, ready);
  updateSaveStatus();
}

function updateActiveUI() {
  const meta = MODULES[activeModule];
  $('activeModuleTag').textContent = meta.name;
  $('propertiesTitle').textContent = `${meta.name}设置`;
  $('focusTitle').textContent = `${meta.name} · 局部放大`;
  for (const button of document.querySelectorAll('[data-module-button]')) {
    const active = button.dataset.moduleButton === activeModule;
    button.classList.toggle('active', active);
    button.closest('.module-card').classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  }
  for (const panel of document.querySelectorAll('[data-module-panel]')) {
    panel.hidden = panel.dataset.modulePanel !== activeModule;
  }
}

function updatePositionControls(moduleId) {
  const module = settings.modules[moduleId];
  const position = MODULES[moduleId].position;
  const limits = positionLimits(previewRenderers[moduleId]);
  for (const axis of ['x', 'y']) {
    const min = limits[axis === 'x' ? 'minX' : 'minY'];
    const max = limits[axis === 'x' ? 'maxX' : 'maxY'];
    const range = $(axis === 'x' ? position.xRange : position.yRange);
    const number = $(axis === 'x' ? position.x : position.y);
    range.max = String(max);
    range.min = String(min);
    range.disabled = max === min;
    number.max = String(max);
    number.min = String(min);
    updateRange(range.id, module[axis]);
    setInput(number.id, module[axis]);
    range.nextElementSibling.firstElementChild.textContent = `${min} px · ${axis === 'x' ? '左' : '上'}`;
    $(axis === 'x' ? position.xMax : position.yMax).textContent = `${max} px · ${axis === 'x' ? '右' : '下'}`;
  }
}

function renderModuleCard(moduleId, knownBounds) {
  const module = settings.modules[moduleId];
  const mapRect = document.querySelector(`[data-module-map="${moduleId}"]`);
  if (mapRect) {
    const { width: canvasWidth, height: canvasHeight } = settings.canvas;
    const bounds = knownBounds ?? previewRenderers[moduleId].getBounds();
    mapRect.style.left = `${module.x / canvasWidth * 100}%`;
    mapRect.style.top = `${module.y / canvasHeight * 100}%`;
    mapRect.style.width = `${Math.min(100, bounds.width / canvasWidth * 100)}%`;
    mapRect.style.height = `${Math.min(100, bounds.height / canvasHeight * 100)}%`;
  }
  const detail = document.querySelector(`[data-module-detail="${moduleId}"]`);
  if (detail) {
    const label = (value) => ANIMATION_OPTIONS.find(([key]) => key === value)?.[1] ?? value;
    detail.replaceChildren(
      ...[['X', module.x], ['Y', module.y], ['', `${Math.round(module.scale * 100)}%`]].map(([key, value]) => {
        const item = document.createElement('span');
        const b = document.createElement('b');
        item.textContent = key ? `${key} ` : '';
        b.textContent = value;
        item.append(b);
        return item;
      }),
      Object.assign(document.createElement('span'), {
        className: 'module-detail-anim',
        textContent: `${label(module.animation.enter)}/${label(module.animation.exit)} ${module.animation.duration}ms`,
        title: `出场 ${label(module.animation.enter)} · 退场 ${label(module.animation.exit)} · ${module.animation.duration} ms`,
      }),
    );
  }
}

function renderControls() {
  for (const moduleId of MODULE_ORDER) {
    const module = settings.modules[moduleId];
    for (const field of MODULES[moduleId].fields) {
      if (field.kind === 'color') {
        $(field.id).style.background = module[field.key];
        setInput(field.hexId, module[field.key].toUpperCase());
        if (field.enabledBy) {
          const enabled = Boolean(module[field.enabledBy]);
          $(field.id).disabled = !enabled;
          $(field.hexId).disabled = !enabled;
          $(field.id).closest('.field').classList.toggle('is-disabled', !enabled);
        }
      } else if (field.kind === 'boolean') {
        $(field.id).checked = Boolean(module[field.key]);
      } else if (field.kind === 'percent') {
        const percent = Math.round(module[field.key] * 100);
        updateRange(field.id, percent);
        setInput(field.numberId, percent);
      } else if (field.kind === 'choice') {
        const value = module[field.key] ?? field.fallback;
        for (const button of $(field.id).querySelectorAll('button')) {
          const checked = button.dataset.value === value;
          button.setAttribute('aria-checked', String(checked));
          button.tabIndex = checked ? 0 : -1;
        }
        if (field.hintId) $(field.hintId).textContent = field.options.find(({ id }) => id === value)?.hint ?? '';
      } else if (field.kind === 'opacity' || field.kind === 'weight' || field.kind === 'raw') {
        updateRange(field.id, module[field.key]);
        setInput(field.numberId, module[field.key]);
      } else {
        setInput(field.id, module[field.key] ?? '');
      }
    }
    const animation = MODULES[moduleId].animation;
    setSelectValue(animation.enter, module.animation.enter);
    setSelectValue(animation.exit, module.animation.exit);
    updateRange(animation.duration, module.animation.duration);
    setInput(animation.durationNumber, module.animation.duration);
    updatePositionControls(moduleId);
    const toggle = document.querySelector(`[data-module-visibility="${moduleId}"]`);
    toggle.textContent = module.visible ? '隐藏' : '显示';
    toggle.setAttribute('aria-label', `${module.visible ? '隐藏' : '显示'}${MODULES[moduleId].name}`);
    toggle.setAttribute('aria-pressed', String(module.visible));
    document.querySelector(`[data-module-button="${moduleId}"]`)?.classList.toggle('is-off', !module.visible);
    toggle.closest('.module-card')?.classList.toggle('is-live', Boolean(module.visible));
    const state = document.querySelector(`[data-module-state="${moduleId}"]`);
    if (state) state.textContent = module.visible ? '画面中' : '未显示';
    const summary = document.querySelector(`[data-module-summary="${moduleId}"]`);
    if (summary && moduleId !== 'lyrics') summary.textContent = MODULES[moduleId].summary(module);
    renderModuleCard(moduleId);
  }
  const liveCount = MODULE_ORDER.filter((moduleId) => settings.modules[moduleId].visible).length;
  $('liveCount').textContent = `画面中 ${liveCount} / ${MODULE_ORDER.length}`;
  const active = settings.modules[activeModule];
  $('moduleVisible').checked = active.visible;
  $('moduleVisible').setAttribute('aria-label', `显示 ${MODULES[activeModule].name}`);
  $('visibilityTitle').textContent = `显示 ${MODULES[activeModule].name}`;
  $('visibilityHint').textContent = active.visible ? '显示中 · 关闭后按退场动画离开画面' : '已隐藏 · 打开后按出场动画进入画面';
  document.querySelector('.visibility-row').classList.toggle('is-live', Boolean(active.visible));
}

function updateSummary() {
  const module = settings.modules[activeModule];
  $('summaryTitle').textContent = MODULES[activeModule].summary(module);
  $('summaryX').textContent = module.x;
  $('summaryY').textContent = module.y;
  $('summaryScale').textContent = Math.round(module.scale * 100) + '%';
  $('visibilitySummary').textContent = module.visible ? '显示中' : '已隐藏';
  $('visibilitySummary').classList.toggle('hidden-state', !module.visible);
}

function updateSelection() {
  for (const moduleId of MODULE_ORDER) {
    const selected = moduleId === activeModule && settings.modules[moduleId].visible;
    previewRenderers[moduleId].element.classList.toggle('is-selected', selected);
  }
}

function fitFocus() {
  if (!focusRenderer) return;
  const stage = $('focusStage');
  const canvas = $('focusCanvas');
  const module = settings.modules[activeModule];
  focusRenderer.update({ ...module, x: 0, y: 0, visible: true, opacity: 100 }, { constrain: false });
  const bounds = focusRenderer.getBounds();
  const limits = activeModule === 'program' ? focusRenderer.getTearClearance() : { right: 0, bottom: 0 };
  const zoom = Math.max(0.01, Math.min(
    (stage.clientWidth - 64) / Math.max(bounds.width + limits.right, 1),
    (stage.clientHeight - 40) / Math.max(bounds.height + limits.bottom, 1),
  ));
  canvas.style.width = `${bounds.width}px`;
  canvas.style.height = `${bounds.height}px`;
  canvas.style.transform = `scale(${zoom})`;
  canvas.style.left = `${Math.max(0, (stage.clientWidth - (bounds.width + limits.right) * zoom) / 2)}px`;
  canvas.style.top = `${Math.max(0, (stage.clientHeight - (bounds.height + limits.bottom) * zoom) / 2)}px`;
  $('focusScale').textContent = `${Math.round(zoom * 100)}% 查看`;
}

function rebuildFocus() {
  focusRenderer?.dispose?.();
  $('focusCanvas').replaceChildren();
  focusRenderer = MODULES[activeModule].create($('focusCanvas'), { sample: ['lyrics', 'speech'].includes(activeModule) });
  focusRenderer.updateTicket?.(ticketState);
  focusRenderer.updateLyrics?.(lyricsClock);
  if (speechState) focusRenderer.updateSpeech?.(speechState);
  fitFocus();
}

function render() {
  stageControls.render(settings, ready);
  renderTicketControl();
  speechAsr.update(sharedAsr, ready);
  $('speech-clear').disabled = !ready;
  for (const moduleId of MODULE_ORDER) previewRenderers[moduleId].update(settings.modules[moduleId]);
  updateActiveUI();
  renderControls();
  updateSummary();
  updateSelection();
  fitFocus();
  updateSaveStatus();
  $('autoAvoidToggle').checked = settings.layout?.autoAvoid !== false;
  avoidance.schedule();
}

function selectModule(moduleId) {
  if (!MODULES[moduleId] || moduleId === activeModule) return;
  activeModule = moduleId;
  document.body.dataset.module = moduleId;
  closePicker();
  rebuildFocus();
  render();
}

function applyTicket(next, animate = false) {
  ticketState = next;
  previewRenderers.program.updateTicket(next, { animate });
  focusRenderer?.updateTicket?.(next, { animate });
}

function renderTicketControl() {
  const active = activeModule === 'program';
  const program = settings.modules.program;
  const hint = $('programTearHint');
  const torn = program.visible && Number.isFinite(ticketState?.tornAt);
  const supportsAutoHide = typeof program.autoHideAfterTear === 'boolean';
  $('programTicketControls').hidden = !active;
  $('programAutoHideAfterTear').disabled = !ready || !supportsAutoHide;
  programTear.disabled = !ready || !ticketState || Boolean(pendingTicketId) ||
    !program.visible || !(program.current || program.next);
  programTear.textContent = torn ? '恢复票根' : '撕开票根';
  hint.textContent = !ready ? '等待连接本机服务。' : !ticketState ? '请更新并重启包装服务。' :
    !program.visible ? '打开「显示 节目单」后即可撕票。' :
    torn ? (program.autoHideAfterTear ? '撕票动画结束后自动隐藏，可点恢复取消。' : '票根已撕开，可恢复后再撕。') :
    program.autoHideAfterTear ? '撕票动画结束后自动隐藏节目单。' :
    supportsAutoHide ? '撕开和恢复都会同步到 OBS。' : '自动隐藏需重启包装服务后启用。';
}

function applyServerState(message) {
  if (!message.settings?.modules || !message.settings?.canvas) return;
  settings = structuredClone(message.settings);
  if (Array.isArray(message.stage?.showOrder)) showOrder = message.stage.showOrder;
  applyTicket(message.stage?.ticket);
  settings.modules.lyrics ??= structuredClone(FALLBACK_SETTINGS.modules.lyrics);
  settings.modules.speech ??= structuredClone(FALLBACK_SETTINGS.modules.speech);
  if (message.id) sentPatches.delete(message.id);
  for (const [path, intent] of localIntent) {
    if (readValue(intent.module, intent.key) === intent.value) localIntent.delete(path);
    else writeValue(intent.module, intent.key, intent.value);
  }
  revision = message.revision ?? revision;
  savedRevision = message.savedRevision ?? savedRevision;
  ready = true;
  reconnectDelay = 700;
  saveError = '';
  updateConnection('connected');
  // 拖动中收到的回执只更新数据，松手后统一重绘；平时也合并到下一帧，一帧最多重绘一次。
  if (drag?.moved) return;
  scheduleRender();
  edit('hosts', { x: settings.modules.hosts.x, y: settings.modules.hosts.y });
  queueFlush();
}

const SKIP_NOTICE_KEY = 'yanzhou.skipNoticeDismissed';
function renderSkipNotice(skipped) {
  const box = document.getElementById('skip-notice');
  if (!box) return;
  let dismissed = '';
  try { dismissed = sessionStorage.getItem(SKIP_NOTICE_KEY) || ''; } catch {}
  box.hidden = !skipped || dismissed === skipped.id;
  if (!skipped) return;
  document.getElementById('skip-notice-text').textContent = skipped.message;
  document.getElementById('skip-notice-close').onclick = () => {
    try { sessionStorage.setItem(SKIP_NOTICE_KEY, skipped.id); } catch {}
    box.hidden = true;
  };
}

function renderLyricsPlaylist({ songs, activeId, skipped }) {
  const activeSong = songs.find((song) => song.id === activeId);
  const lyricsSummary = document.querySelector('[data-module-summary="lyrics"]');
  if (lyricsSummary) lyricsSummary.textContent = activeSong ? `《${activeSong.title}》${activeSong.artist ? ` · ${activeSong.artist}` : ''}` : (skipped ? '未载入歌曲 · 上次的歌已跳过' : '未载入歌曲');
  const list = $('lyricsPlaylist');
  const focused = list.contains(document.activeElement) ? document.activeElement.dataset : undefined;
  let focusTarget;
  list.replaceChildren(...songs.map((song, index) => {
    const item = document.createElement('li');
    if (song.id === activeId) item.setAttribute('aria-current', 'true');
    const name = document.createElement('span');
    name.textContent = `${song.title}${song.artist ? ` · ${song.artist}` : ''}`;
    item.append(name);
    for (const direction of [-1, 1]) {
      const button = document.createElement('button');
      const label = direction < 0 ? '上移' : '下移';
      button.type = 'button';
      button.textContent = direction < 0 ? '↑' : '↓';
      button.setAttribute('aria-label', `${label}《${song.title}》`);
      button.dataset.songId = song.id;
      button.dataset.direction = direction;
      button.disabled = !songs[index + direction];
      button.onclick = () => {
        if (!ready || socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({
          type: 'lyrics:move-song',
          id: `playlist-${++playlistRequest}`,
          payload: { id: song.id, direction },
        }));
      };
      if (focused?.songId === song.id && !button.disabled &&
          (!focusTarget || Number(focused.direction) === direction)) focusTarget = button;
      item.append(button);
    }
    return item;
  }));
  if (!songs.length) {
    const empty = document.createElement('li');
    empty.textContent = '曲库暂无歌曲';
    list.append(empty);
  }
  focusTarget?.focus({ preventScroll: true });
}

function updateLyricsProgress() {
  clearTimeout(lyricsProgressTimer);
  const transport = lyricsClock.state?.transport;
  const end = transport?.end ?? 0;
  const position = lyricsClock.position();
  $('lyricsProgress').max = end || 1;
  $('lyricsProgress').value = position;
  $('lyricsProgressTime').value = end ? `${timecode(position).slice(0, -4)} / ${timecode(end).slice(0, -4)}` : '—';
  if (ready && transport?.playing && position < end) lyricsProgressTimer = setTimeout(updateLyricsProgress, 200);
}

function connect() {
  clearTimeout(reconnectTimer);
  updateConnection('connecting');
  socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'state') {
      applyServerState(message);
    } else if (message.type === 'program:ticket') {
      if (message.id === pendingTicketId) pendingTicketId = undefined;
      applyTicket(message.ticket, true);
      renderTicketControl();
    } else if (message.type === 'lyrics:state') {
      lyricsClock.apply(message);
      previewRenderers.lyrics.updateLyrics(lyricsClock);
      focusRenderer?.updateLyrics?.(lyricsClock);
      updateLyricsProgress();
      revision = message.revision ?? revision;
      updateSaveStatus();
    } else if (message.type === 'lyrics:songs') {
      renderLyricsPlaylist(message);
      renderSkipNotice(message.skipped);
    } else if (message.type === 'speech:state') {
      speechState = message;
      previewRenderers.speech.updateSpeech(message);
      focusRenderer?.updateSpeech?.(message);
      $('speech-caption-status').textContent = !message.text ? '字幕待推送' :
        message.partial ? '临时识别 · 随语音更新' : '已确认 · 保留到清屏';
      avoidance.schedule();
    } else if (message.type === 'lyrics:asr') {
      sharedAsr = message;
      speechAsr.update(message, ready);
    } else if (message.type === 'asr:config') {
      speechAsr.configResult(message);
    } else if (message.type === 'management:result') {
      stageControls.result(message);
    } else if (message.type === 'saved') {
      savedRevision = Math.max(savedRevision, message.revision ?? 0);
      saveError = '';
      updateSaveStatus();
    } else if (message.type === 'error') {
      if (stageControls.result(message)) return;
      if (pendingTicketId && message.id === pendingTicketId) {
        pendingTicketId = undefined;
        renderTicketControl();
        toast(message.message);
        return;
      }
      if (message.id?.startsWith('playlist-')) {
        toast(message.message);
        return;
      }
      const rejected = sentPatches.get(message.id);
      if (rejected) {
        for (const [key, value] of Object.entries(rejected.values)) {
          if (key === 'animation') {
            for (const [subKey, subValue] of Object.entries(value)) {
              const path = `${rejected.module}.animation.${subKey}`;
              if (localIntent.get(path)?.value === subValue) localIntent.delete(path);
            }
          } else {
            const path = `${rejected.module}.${key}`;
            if (localIntent.get(path)?.value === value) localIntent.delete(path);
          }
        }
        sentPatches.delete(message.id);
      }
      saveError = message.message || '请检查本地设置文件是否可写';
      updateSaveStatus();
      toast(saveError);
    }
  });
  socket.addEventListener('close', () => {
    ready = false;
    pendingTicketId = undefined;
    renderTicketControl();
    stageControls.disconnected();
    speechAsr.update(sharedAsr, false);
    previewRenderers.speech.updateSpeech({ text: '' });
    focusRenderer?.updateSpeech?.({ text: '' });
    clearTimeout(lyricsProgressTimer);
    for (const intent of localIntent.values()) addPending(intent.module, intent.key, intent.value);
    updateConnection('disconnected');
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.6, 5000);
  });
  socket.addEventListener('error', () => socket.close());
}

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3000);
}

function fitCanvas() {
  const stage = $('previewStage');
  previewZoom = Math.min(stage.clientWidth / settings.canvas.width, stage.clientHeight / settings.canvas.height);
  $('previewCanvas').style.transform = 'scale(' + previewZoom + ')';
  $('previewCanvas').style.left = (stage.clientWidth - settings.canvas.width * previewZoom) / 2 + 'px';
  $('previewCanvas').style.top = (stage.clientHeight - settings.canvas.height * previewZoom) / 2 + 'px';
  $('previewScale').textContent = Math.round(previewZoom * 100) + '%';
}

function sizePreviewToViewport() {
  const stage = $('previewStage');
  stage.style.height = '';
  stage.style.aspectRatio = '';
  fitCanvas();
  fitFocus();
}

function populateAnimationSelects() {
  for (const moduleId of MODULE_ORDER) {
    const animation = MODULES[moduleId].animation;
    for (const kind of ['enter', 'exit']) {
      const select = $(animation[kind]);
      select.replaceChildren(...select.querySelectorAll(':scope > button'));
      for (const [value, label] of ANIMATION_OPTIONS) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
      }
    }
  }
}

function bindColorField(moduleId, field) {
  const swatch = $(field.id);
  const hex = $(field.hexId);
  swatch.addEventListener('click', () => openPicker(moduleId, field));
  hex.addEventListener('input', (event) => {
    const value = event.target.value.trim();
    const valid = /^#[0-9a-f]{6}$/i.test(value);
    event.target.setAttribute('aria-invalid', String(!valid));
    if (valid) edit(moduleId, { [field.key]: value.toUpperCase() });
  });
  hex.addEventListener('blur', () => {
    hex.removeAttribute('aria-invalid');
    hex.value = settings.modules[moduleId][field.key].toUpperCase();
  });
}

const PICKER_PRESETS = ['#FFFFFF', '#F4F0E8', '#10151D', '#2C2C2E', '#772B2C', '#D4AB78', '#E23A2E', '#71C4DE', '#379C72', '#2E6FE2'];
const picker = $('colorPicker');
let pickerTarget = null;
let pickerHsv = { h: 0, s: 0, v: 1 };

function hsvToHex(h, s, v) {
  const channel = (n) => {
    const k = (n + h / 60) % 6;
    const x = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(x * 255).toString(16).padStart(2, '0');
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`.toUpperCase();
}

function hexToHsv(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

function renderPicker() {
  const { h, s, v } = pickerHsv;
  $('pickerArea').style.background = `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(${h}, 100%, 50%))`;
  $('pickerDot').style.left = `${s * 100}%`;
  $('pickerDot').style.top = `${(1 - v) * 100}%`;
  $('pickerHueDot').style.left = `${(h / 360) * 100}%`;
  $('pickerHex').textContent = hsvToHex(h, s, v);
}

function commitPicker() {
  if (!pickerTarget) return;
  edit(pickerTarget.moduleId, { [pickerTarget.field.key]: hsvToHex(pickerHsv.h, pickerHsv.s, pickerHsv.v) });
}

function openPicker(moduleId, field) {
  pickerTarget = { moduleId, field };
  pickerHsv = hexToHsv(settings.modules[moduleId][field.key]);
  renderPicker();
  picker.hidden = false;
  const swatch = $(field.id);
  const anchor = swatch.getBoundingClientRect();
  const width = picker.offsetWidth;
  const height = picker.offsetHeight;
  picker.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, anchor.left))}px`;
  picker.style.top = `${anchor.bottom + height + 8 > window.innerHeight - 8 ? Math.max(8, anchor.top - height - 8) : anchor.bottom + 8}px`;
}

function closePicker() {
  picker.hidden = true;
  pickerTarget = null;
}

function bindPicker() {
  for (const preset of PICKER_PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.preset = preset;
    button.style.background = preset;
    button.setAttribute('aria-label', `使用颜色 ${preset}`);
    $('pickerPresets').appendChild(button);
  }
  const dragOn = (element, onMove) => {
    element.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      onMove(event);
      const move = (e) => onMove(e);
      const stop = () => {
        element.removeEventListener('pointermove', move);
        element.removeEventListener('pointerup', stop);
        element.removeEventListener('pointercancel', stop);
      };
      element.addEventListener('pointermove', move);
      element.addEventListener('pointerup', stop);
      element.addEventListener('pointercancel', stop);
    });
  };
  const area = $('pickerArea');
  const hue = $('pickerHue');
  dragOn(area, (event) => {
    const r = area.getBoundingClientRect();
    pickerHsv.s = Math.min(1, Math.max(0, (event.clientX - r.left) / r.width));
    pickerHsv.v = 1 - Math.min(1, Math.max(0, (event.clientY - r.top) / r.height));
    renderPicker();
    commitPicker();
  });
  dragOn(hue, (event) => {
    const r = hue.getBoundingClientRect();
    pickerHsv.h = Math.min(360, Math.max(0, ((event.clientX - r.left) / r.width) * 360));
    renderPicker();
    commitPicker();
  });
  $('pickerPresets').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-preset]');
    if (!button) return;
    pickerHsv = hexToHsv(button.dataset.preset);
    renderPicker();
    commitPicker();
  });
  document.addEventListener('pointerdown', (event) => {
    if (picker.hidden) return;
    if (event.target.closest('.color-picker') || event.target.closest('.color-control')) return;
    closePicker();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !picker.hidden) closePicker();
  });
}

function bindRangeField(moduleId, field, divisor) {
  const range = $(field.id);
  const number = $(field.numberId);
  for (const element of [range, number]) {
    element.addEventListener('input', (event) => {
      const value = event.target.valueAsNumber;
      if (!Number.isFinite(value)) return;
      const clamped = Math.max(Number(event.target.min), Math.min(Number(event.target.max), Math.round(value)));
      const stored = clamped / divisor;
      edit(moduleId, { [field.key]: stored });
      if (element === range) setInput(field.numberId, clamped);
      else updateRange(field.id, clamped);
    });
    element.addEventListener('blur', render);
    element.addEventListener('change', flush);
  }
}

function bindPositionFields(moduleId, position) {
  for (const axis of ['x', 'y']) {
    const numberId = axis === 'x' ? position.x : position.y;
    const rangeId = axis === 'x' ? position.xRange : position.yRange;
    for (const element of [$(numberId), $(rangeId)]) {
      element.addEventListener('input', (event) => {
        const value = event.target.valueAsNumber;
        if (!Number.isFinite(value)) return;
        edit(moduleId, { [axis]: value });
        element.value = settings.modules[moduleId][axis];
        updatePositionControls(moduleId);
      });
      element.addEventListener('blur', render);
      element.addEventListener('change', flush);
    }
  }
}

function bindAnimationFields(moduleId, animation) {
  for (const kind of ['enter', 'exit']) {
    $(animation[kind]).addEventListener('change', (event) => edit(moduleId, { animation: { [kind]: event.target.value } }));
  }
  for (const element of [$(animation.duration), $(animation.durationNumber)]) {
    element.addEventListener('input', (event) => {
      const value = event.target.valueAsNumber;
      if (!Number.isFinite(value)) return;
      const duration = Math.max(200, Math.min(2000, Math.round(value / 50) * 50));
      edit(moduleId, { animation: { duration } });
      if (element === $(animation.duration)) setInput(animation.durationNumber, duration);
      else updateRange(animation.duration, duration);
    });
    element.addEventListener('blur', render);
    element.addEventListener('change', flush);
  }
}

function bindChoiceField(moduleId, field) {
  const group = $(field.id);
  const buttons = field.options.map(({ id, name, hint }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.dataset.value = id;
    button.title = hint;
    // 缩略图直接用原项目的 presetPreview 渲染真实样式，再按按钮尺寸缩放。
    button.innerHTML = '<span class="style-thumb" aria-hidden="true"></span><span class="style-name"></span>';
    const HostAppearance = globalThis.HostAppearance;
    button.querySelector('.style-thumb').append(HostAppearance.presetPreview({ title: '主持人', names: '张三、李四', appearance: HostAppearance.template(id) }));
    button.querySelector('.style-name').textContent = name;
    button.addEventListener('click', () => {
      edit(moduleId, { [field.key]: id });
      flush();
    });
    return button;
  });
  group.replaceChildren(...buttons);
  const fitThumbs = () => {
    for (const thumb of group.querySelectorAll('.style-thumb')) {
      const visual = thumb.querySelector('.host-visual');
      if (!visual || !visual.offsetWidth || !thumb.clientWidth) continue;
      const scale = Math.min((thumb.clientWidth - 12) / visual.offsetWidth, (thumb.clientHeight - 8) / visual.offsetHeight);
      visual.style.transform = `translate(-50%, -50%) scale(${scale})`;
    }
  };
  new ResizeObserver(fitThumbs).observe(group);
  document.fonts?.ready.then(fitThumbs);
  group.addEventListener('keydown', (event) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement);
    const target = buttons[(Math.max(0, index) + step + buttons.length) % buttons.length];
    target.focus();
    target.click();
  });
}

function bindFields() {
  for (const moduleId of MODULE_ORDER) {
    const meta = MODULES[moduleId];
    for (const field of meta.fields) {
      if (field.kind === 'text' || field.kind === 'textarea') {
        $(field.id).addEventListener('input', (event) => edit(moduleId, { [field.key]: event.target.value }));
        $(field.id).addEventListener('blur', render);
      } else if (field.kind === 'boolean') {
        $(field.id).addEventListener('change', (event) => edit(moduleId, { [field.key]: event.target.checked }));
      } else if (field.kind === 'color') {
        bindColorField(moduleId, field);
      } else if (field.kind === 'choice') {
        bindChoiceField(moduleId, field);
      } else if (field.kind === 'percent') {
        bindRangeField(moduleId, field, 100);
      } else if (field.kind === 'opacity' || field.kind === 'weight' || field.kind === 'raw') {
        bindRangeField(moduleId, field, 1);
      }
    }
    bindPositionFields(moduleId, meta.position);
    bindAnimationFields(moduleId, meta.animation);
  }
}

let drag = null;
const DRAG_SEND_MS = 33;
let dragSendTimer = 0;
let lastDragSend = 0;

function sendDragPosition() {
  dragSendTimer = 0;
  lastDragSend = performance.now();
  flush();
}

/** 拖动的每一帧：只移动被拖的预览模块并更新坐标显示，不重绘整个控制台；网络约 30 帧/秒发送一次。 */
function dragFrame() {
  drag.frame = 0;
  const { module: moduleId, limits } = drag;
  const x = Math.round(Math.min(limits.maxX, Math.max(limits.minX, drag.x + (drag.clientX - drag.startX) / drag.zoom)));
  const y = Math.round(Math.min(limits.maxY, Math.max(limits.minY, drag.y + (drag.clientY - drag.startY) / drag.zoom)));
  const changedX = setOne(moduleId, 'x', x);
  const changedY = setOne(moduleId, 'y', y);
  if (!changedX && !changedY) return;
  saveError = '';
  const module = settings.modules[moduleId];
  const renderer = previewRenderers[moduleId];
  if (moduleId === 'hosts') {
    // 人物条的宽度随 X 变化，需要重新排版。
    renderer.update(module, { animate: false });
  } else {
    // 其余模块只改合成层位移（translate = 避让偏移 + 拖动距离），不触发重新排版；松手时再写回 left/top。
    renderer.element.style.translate = `${drag.offset.dx + x - drag.left}px ${drag.offset.dy + y - drag.top}px`;
  }
  const position = MODULES[moduleId].position;
  updateRange(position.xRange, x);
  setInput(position.x, x);
  updateRange(position.yRange, y);
  setInput(position.y, y);
  if (moduleId === activeModule) {
    $('summaryX').textContent = x;
    $('summaryY').textContent = y;
  }
  renderModuleCard(moduleId, drag.bounds);
  const wait = DRAG_SEND_MS - (performance.now() - lastDragSend);
  if (wait <= 0) sendDragPosition();
  else if (!dragSendTimer) dragSendTimer = setTimeout(sendDragPosition, wait);
}

function bindDrag() {
  for (const moduleId of MODULE_ORDER) {
    const element = previewRenderers[moduleId].element;
    element.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !settings.modules[moduleId].visible) return;
      if (['lyrics', 'speech'].includes(moduleId) && element.dataset.hasContent !== 'true') return;
      const wasSelected = activeModule === moduleId;
      event.preventDefault();
      selectModule(moduleId);
      if (!wasSelected) return;
      $('previewStage').focus({ preventScroll: true });
      const renderer = previewRenderers[moduleId];
      const limits = positionLimits(renderer);
      const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
      drag = {
        module: moduleId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        clientX: event.clientX,
        clientY: event.clientY,
        // 从画面上实际显示的位置开始拖（保存的位置可能超出当前尺寸允许的范围）。
        x: clamp(settings.modules[moduleId].x, limits.minX, limits.maxX),
        y: clamp(settings.modules[moduleId].y, limits.minY, limits.maxY),
        left: parseFloat(element.style.left) || 0,
        top: parseFloat(element.style.top) || 0,
        zoom: previewZoom,
        // 尺寸在拖动中不变，开始时量一次，之后每帧不再强制布局。
        limits,
        bounds: renderer.getBounds(),
        offset: { dx: 0, dy: 0, ...avoidance.offsets()[moduleId] },
        moved: false,
        frame: 0,
      };
      element.setPointerCapture(event.pointerId);
    });
    element.addEventListener('pointermove', (event) => {
      if (!drag || drag.module !== moduleId || event.pointerId !== drag.pointerId) return;
      if (!drag.moved) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
        drag.moved = true;
        $('previewStage').classList.add('dragging');
        // 拖动中各模块的避让偏移保持不动，被拖的模块不会跳；松手后再统一计算。
        avoidance.freeze(true);
      }
      drag.clientX = event.clientX;
      drag.clientY = event.clientY;
      if (!drag.frame) drag.frame = requestAnimationFrame(dragFrame);
    });
    const endDrag = () => {
      if (!drag || drag.module !== moduleId) return;
      const finished = drag;
      if (finished.frame) {
        cancelAnimationFrame(finished.frame);
        dragFrame();
      }
      clearTimeout(dragSendTimer);
      dragSendTimer = 0;
      drag = null;
      $('previewStage').classList.remove('dragging');
      flush();
      if (finished.moved) {
        const { dx, dy } = finished.offset;
        element.classList.add('avoid-still');
        element.style.translate = dx || dy ? `${Math.round(dx)}px ${Math.round(dy)}px` : '';
        render();
        void element.offsetWidth;
        element.classList.remove('avoid-still');
        avoidance.freeze(false);
      }
    };
    element.addEventListener('pointerup', endDrag);
    element.addEventListener('pointercancel', endDrag);
    element.addEventListener('lostpointercapture', endDrag);
  }
}

function bindGlobalControls() {
  for (const toggle of document.querySelectorAll('[data-module-visibility]')) {
    toggle.addEventListener('click', () => {
      const moduleId = toggle.dataset.moduleVisibility;
      edit(moduleId, { visible: !settings.modules[moduleId].visible });
    });
  }
  const tabs = [...document.querySelectorAll('[data-module-button]')];
  for (const [index, button] of tabs.entries()) {
    const name = button.dataset.moduleButton;
    const panel = document.querySelector(`[data-module-panel="${name}"]`);
    button.id = `module-tab-${name}`;
    panel.id = `module-panel-${name}`;
    button.setAttribute('aria-controls', panel.id);
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', button.id);
    button.addEventListener('click', () => selectModule(button.dataset.moduleButton));
    button.addEventListener('keydown', (event) => {
      const positions = { ArrowLeft: index - 1, ArrowRight: index + 1, ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: tabs.length - 1 };
      if (!Object.hasOwn(positions, event.key)) return;
      event.preventDefault();
      const target = tabs[(positions[event.key] + tabs.length) % tabs.length];
      selectModule(target.dataset.moduleButton);
      target.focus();
    });
  }
  $('moduleVisible').addEventListener('change', (event) => edit(activeModule, { visible: event.target.checked }));
  $('previewStage').addEventListener('keydown', (event) => {
    if (event.target !== $('previewStage') || !settings.modules[activeModule].visible) return;
    const amount = event.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: [-amount, 0], ArrowRight: [amount, 0], ArrowUp: [0, -amount], ArrowDown: [0, amount] };
    if (!moves[event.key]) return;
    event.preventDefault();
    edit(activeModule, {
      x: settings.modules[activeModule].x + moves[event.key][0],
      y: settings.modules[activeModule].y + moves[event.key][1],
    });
  });
  // 预览默认用中性灰棋盘格；手动选择单独保存在当前浏览器，不影响 OBS 输出。
  // 选回棋盘格时清除手动覆盖，恢复默认背景。
  const BACKGROUND_KEY = 'yzb-preview-background';
  const DEFAULT_BACKGROUND = 'checker';
  const readManualBackground = () => {
    try { return localStorage.getItem(BACKGROUND_KEY); } catch { return null; }
  };
  const applyBackground = () => {
    const manual = readManualBackground();
    const value = ['dark', 'light', 'checker'].includes(manual) ? manual : DEFAULT_BACKGROUND;
    $('previewStage').dataset.background = value;
    $('focusStage').dataset.background = value;
    for (const other of document.querySelectorAll('button[data-background]')) {
      const selected = other.dataset.background === value;
      other.classList.toggle('active', selected);
      other.setAttribute('aria-pressed', String(selected));
    }
  };
  for (const button of document.querySelectorAll('button[data-background]')) {
    button.addEventListener('click', () => {
      try {
        if (button.dataset.background === DEFAULT_BACKGROUND) localStorage.removeItem(BACKGROUND_KEY);
        else localStorage.setItem(BACKGROUND_KEY, button.dataset.background);
      } catch {}
      applyBackground();
    });
  }
  new MutationObserver(applyBackground).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  applyBackground();
  $('copyOutputUrl').addEventListener('click', async () => {
    const url = `${location.origin}/overlay.html`;
    try {
      await navigator.clipboard.writeText(url);
      toast(`已复制 ${url}`);
    } catch {
      toast(`OBS 浏览器来源地址：${url}`);
    }
  });
  $('safeAreaToggle').addEventListener('change', (event) => { $('safeArea').hidden = !event.target.checked; });
  $('autoAvoidToggle').addEventListener('change', (event) => {
    const autoAvoid = event.target.checked;
    settings.layout = { ...settings.layout, autoAvoid };
    avoidance.schedule();
    if (!ready || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'patch', id: crypto.randomUUID(), patch: { layout: { autoAvoid } } }));
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  window.addEventListener('pagehide', flush);
  window.addEventListener('resize', sizePreviewToViewport);
  new ResizeObserver(fitCanvas).observe($('previewStage'));
  new ResizeObserver(fitFocus).observe($('focusStage'));
  document.fonts.ready.then(() => { render(); sizePreviewToViewport(); });
}

populateAnimationSelects();
bindPicker();
bindFields();
bindDrag();
bindGlobalControls();
rebuildFocus();
render();
sizePreviewToViewport();
connect();
