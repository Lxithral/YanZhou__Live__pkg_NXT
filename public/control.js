import { createLogoRenderer } from './logo-renderer.js';
import { createHostsRenderer } from './hosts-renderer.js';
import { createProgramRenderer } from './program-renderer.js';
import { createLyricsRenderer } from './lyrics-renderer.js';
import { createLyricsClock } from './lyrics-clock.js';

const $ = (id) => document.getElementById(id);
const MODULE_ORDER = ['logo', 'hosts', 'program', 'lyrics'];
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
const NO_CLAMP_KEYS = new Set(['x', 'y', 'scale', 'opacity', 'visible', 'animation']);

const MODULES = {
  logo: {
    name: 'Logo 挂角',
    create: createLogoRenderer,
    fields: [
      { key: 'title', id: 'logoTitle', kind: 'text' },
      { key: 'subtitle', id: 'logoSubtitle', kind: 'text' },
      { key: 'showMark', id: 'logoShowMark', kind: 'boolean' },
      { key: 'color', id: 'logoColor', hexId: 'logoColorHex', kind: 'color' },
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
    name: '主持字幕',
    create: createHostsRenderer,
    fields: [
      { key: 'label', id: 'hostsLabel', kind: 'text' },
      { key: 'names', id: 'hostsNames', kind: 'textarea' },
      { key: 'slotCount', id: 'hostsSlotCount', numberId: 'hostsSlotCountNumber', kind: 'raw' },
      { key: 'accentColor', id: 'hostsAccent', hexId: 'hostsAccentHex', kind: 'color' },
      { key: 'textColor', id: 'hostsTextColor', hexId: 'hostsTextColorHex', kind: 'color' },
      { key: 'scale', id: 'hostsScale', numberId: 'hostsScaleNumber', kind: 'percent' },
      { key: 'opacity', id: 'hostsOpacity', numberId: 'hostsOpacityNumber', kind: 'opacity' },
    ],
    position: { x: 'hostsX', xRange: 'hostsXRange', xMax: 'hostsXMax', y: 'hostsY', yRange: 'hostsYRange', yMax: 'hostsYMax' },
    animation: { enter: 'hostsEnter', exit: 'hostsExit', duration: 'hostsDuration', durationNumber: 'hostsDurationNumber' },
    summary(module) {
      const names = String(module.names || '').split(/\r?\n/).map((line) => line.split(/[｜|]/)[0].trim()).filter(Boolean).join('  ');
      return [module.label, names].filter(Boolean).join(' · ') || '主持字幕';
    },
  },
  program: {
    name: '节目单',
    create: createProgramRenderer,
    fields: [
      { key: 'label', id: 'programLabel', kind: 'text' },
      { key: 'current', id: 'programCurrent', kind: 'text' },
      { key: 'nextLabel', id: 'programNextLabel', kind: 'text' },
      { key: 'next', id: 'programNext', kind: 'text' },
      { key: 'accentColor', id: 'programAccent', hexId: 'programAccentHex', kind: 'color' },
      { key: 'textColor', id: 'programTextColor', hexId: 'programTextColorHex', kind: 'color' },
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
    logo: { visible: true, showMark: true, title: '中山市烟洲中学', subtitle: 'YANZHOU · LIVE', color: '#D4AB78', textColor: '#F4F0E8', x: 72, y: 64, scale: 1, opacity: 100, animation: { ...DEFAULT_ANIMATION } },
    hosts: { visible: false, label: '主持人', names: '张三\n李四', accentColor: '#D4AB78', textColor: '#F4F0E8', x: 96, y: 912, scale: 1, opacity: 100, animation: { ...DEFAULT_ANIMATION } },
    program: { visible: false, label: '正在演出', current: '节目名称', nextLabel: '接下来', next: '下一个节目', accentColor: '#D4AB78', textColor: '#F4F0E8', x: 1376, y: 912, scale: 1, opacity: 100, animation: { ...DEFAULT_ANIMATION } },
    lyrics: { visible: true, accentColor: '#D4AB78', textColor: '#F4F0E8', x: 240, y: 850, scale: 1, opacity: 100, animation: { enter: 'none', exit: 'none', duration: 200 } },
  },
};

let settings = structuredClone(FALLBACK_SETTINGS);
let socket;
let ready = false;
let revision = 0;
let savedRevision = -1;
let savedAt = null;
let saveError = '';
let reconnectTimer;
let reconnectDelay = 700;
let flushFrame = 0;
let toastTimer;
let previewZoom = 1;
let activeModule = 'logo';
const pendingPatches = new Map();
const localIntent = new Map();
const sentPatches = new Map();
const previewRenderers = {};
for (const moduleId of MODULE_ORDER) previewRenderers[moduleId] = MODULES[moduleId].create($('previewCanvas'));
let focusRenderer = null;

const outputUrl = new URL('/overlay.html', location.href).href;
$('obsAddress').textContent = outputUrl;

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
  const renderer = previewRenderers[moduleId];
  const prospective = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'animation') prospective.animation = { ...current.animation, ...value };
    else prospective[key] = value;
  }
  renderer.update(prospective);
  const bounds = renderer.getBounds();
  renderer.update(current);

  const maxX = Math.max(0, Math.floor(settings.canvas.width - bounds.width));
  const maxY = Math.max(0, Math.floor(settings.canvas.height - bounds.height));
  if (patch.x !== undefined) patch.x = Math.round(Math.min(maxX, Math.max(0, patch.x)));
  if (patch.y !== undefined) patch.y = Math.round(Math.min(maxY, Math.max(0, patch.y)));
  if (patch.scale !== undefined || touchesContent) {
    if (current.x > maxX) patch.x = maxX;
    if (current.y > maxY) patch.y = maxY;
  }
  return patch;
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

function updateSaveStatus() {
  const status = $('saveStatus');
  status.classList.remove('saving', 'offline', 'error');
  if (saveError) {
    status.classList.add('error');
    $('saveText').textContent = '设置保存失败';
    $('saveDetail').textContent = saveError;
  } else if (!ready) {
    status.classList.add('offline');
    $('saveText').textContent = localIntent.size ? '连接断开 · 改动待同步' : '正在连接本地服务';
    $('saveDetail').textContent = localIntent.size ? '保留当前改动，连接恢复后自动同步' : '设置由本地服务保存到 settings.json';
  } else if (localIntent.size || hasPendingChanges() || savedRevision < revision) {
    status.classList.add('saving');
    $('saveText').textContent = '正在保存设置';
    $('saveDetail').textContent = '画面已更新，正在写入 settings.json';
  } else {
    $('saveText').textContent = '所有设置已保存';
    const date = savedAt ? new Date(savedAt) : null;
    const time = date && Number.isFinite(date.getTime()) ? date.toLocaleTimeString('zh-CN', { hour12: false }) : '';
    $('saveDetail').textContent = 'settings.json' + (time ? ' · ' + time : ' · 下次启动自动恢复');
  }
}

function updateConnection(state) {
  $('connectionStatus').className = 'connection-status ' + state;
  $('connectionText').textContent = state === 'connected' ? '服务已连接' : state === 'disconnected' ? '连接已断开' : '正在连接';
  $('previewOffline').hidden = state === 'connected';
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
    button.setAttribute('aria-selected', String(active));
  }
  for (const panel of document.querySelectorAll('[data-module-panel]')) {
    panel.hidden = panel.dataset.modulePanel !== activeModule;
  }
}

function updatePositionControls(moduleId) {
  const module = settings.modules[moduleId];
  const position = MODULES[moduleId].position;
  const bounds = previewRenderers[moduleId].getBounds();
  const limits = {
    x: Math.max(0, Math.floor(settings.canvas.width - bounds.width)),
    y: Math.max(0, Math.floor(settings.canvas.height - bounds.height)),
  };
  for (const axis of ['x', 'y']) {
    const max = limits[axis];
    const range = $(axis === 'x' ? position.xRange : position.yRange);
    const number = $(axis === 'x' ? position.x : position.y);
    range.max = String(max);
    range.disabled = max === 0;
    number.max = String(max);
    updateRange(range.id, module[axis]);
    setInput(number.id, module[axis]);
    $(axis === 'x' ? position.xMax : position.yMax).textContent = `${max} px · ${axis === 'x' ? '右' : '下'}`;
  }
}

function renderControls() {
  for (const moduleId of MODULE_ORDER) {
    const module = settings.modules[moduleId];
    for (const field of MODULES[moduleId].fields) {
      if (field.kind === 'color') {
        $(field.id).style.background = module[field.key];
        setInput(field.hexId, module[field.key].toUpperCase());
      } else if (field.kind === 'boolean') {
        $(field.id).checked = Boolean(module[field.key]);
      } else if (field.kind === 'percent') {
        const percent = Math.round(module[field.key] * 100);
        updateRange(field.id, percent);
        setInput(field.numberId, percent);
      } else if (field.kind === 'opacity' || field.kind === 'weight' || field.kind === 'raw') {
        updateRange(field.id, module[field.key]);
        setInput(field.numberId, module[field.key]);
      } else {
        setInput(field.id, module[field.key]);
      }
    }
    const animation = MODULES[moduleId].animation;
    setSelectValue(animation.enter, module.animation.enter);
    setSelectValue(animation.exit, module.animation.exit);
    updateRange(animation.duration, module.animation.duration);
    setInput(animation.durationNumber, module.animation.duration);
    updatePositionControls(moduleId);
    const flag = document.querySelector(`[data-module-flag="${moduleId}"]`);
    if (flag) flag.hidden = module.visible;
    document.querySelector(`[data-module-button="${moduleId}"]`)?.classList.toggle('is-off', !module.visible);
  }
  const active = settings.modules[activeModule];
  $('moduleVisible').checked = active.visible;
  $('moduleVisible').setAttribute('aria-label', `显示 ${MODULES[activeModule].name}`);
  $('visibilityTitle').textContent = `显示 ${MODULES[activeModule].name}`;
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
  focusRenderer.update({ ...module, x: 0, y: 0, visible: true, opacity: 100 });
  const bounds = focusRenderer.getBounds();
  const zoom = Math.max(0.01, Math.min(
    (stage.clientWidth - 64) / Math.max(bounds.width, 1),
    (stage.clientHeight - 40) / Math.max(bounds.height, 1),
  ));
  canvas.style.width = `${bounds.width}px`;
  canvas.style.height = `${bounds.height}px`;
  canvas.style.transform = `scale(${zoom})`;
  canvas.style.left = `${Math.max(0, (stage.clientWidth - bounds.width * zoom) / 2)}px`;
  canvas.style.top = `${Math.max(0, (stage.clientHeight - bounds.height * zoom) / 2)}px`;
  $('focusScale').textContent = `${Math.round(zoom * 100)}% 查看`;
}

function rebuildFocus() {
  $('focusCanvas').replaceChildren();
  focusRenderer = MODULES[activeModule].create($('focusCanvas'), { sample: activeModule === 'lyrics' });
  fitFocus();
}

function render() {
  for (const moduleId of MODULE_ORDER) previewRenderers[moduleId].update(settings.modules[moduleId]);
  updateActiveUI();
  renderControls();
  updateSummary();
  updateSelection();
  fitFocus();
  updateSaveStatus();
}

function selectModule(moduleId) {
  if (!MODULES[moduleId] || moduleId === activeModule) return;
  activeModule = moduleId;
  rebuildFocus();
  render();
}

function applyServerState(message) {
  if (!message.settings?.modules || !message.settings?.canvas) return;
  settings = structuredClone(message.settings);
  settings.modules.lyrics ??= structuredClone(FALLBACK_SETTINGS.modules.lyrics);
  if (message.id) sentPatches.delete(message.id);
  for (const [path, intent] of localIntent) {
    if (readValue(intent.module, intent.key) === intent.value) localIntent.delete(path);
    else writeValue(intent.module, intent.key, intent.value);
  }
  revision = message.revision ?? revision;
  savedRevision = message.savedRevision ?? savedRevision;
  savedAt = message.savedAt ?? savedAt;
  ready = true;
  reconnectDelay = 700;
  saveError = '';
  updateConnection('connected');
  render();
  queueFlush();
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
    } else if (message.type === 'lyrics:state') {
      lyricsClock.apply(message);
      previewRenderers.lyrics.updateLyrics(lyricsClock);
      revision = message.revision ?? revision;
      updateSaveStatus();
    } else if (message.type === 'saved') {
      savedRevision = Math.max(savedRevision, message.revision ?? 0);
      savedAt = message.savedAt ?? savedAt;
      saveError = '';
      updateSaveStatus();
    } else if (message.type === 'error') {
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
      select.replaceChildren();
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

const PICKER_PRESETS = ['#FFFFFF', '#10151D', '#772B2C', '#D4AB78', '#FFAA00', '#E23A2E', '#E86A17', '#28A745', '#2E6FE2', '#7A4FD4'];
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

const THEME_KEY = 'yzb-theme';
const systemLightQuery = matchMedia('(prefers-color-scheme: light)');

function applyTheme() {
  const pref = localStorage.getItem(THEME_KEY) || 'auto';
  const light = pref === 'light' || (pref === 'auto' && systemLightQuery.matches);
  document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
  document.documentElement.style.colorScheme = light ? 'light' : 'dark';
  for (const button of document.querySelectorAll('[data-theme-option]')) {
    const active = button.dataset.themeOption === pref;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function initThemeSwitch() {
  for (const button of document.querySelectorAll('[data-theme-option]')) {
    button.addEventListener('click', () => {
      localStorage.setItem(THEME_KEY, button.dataset.themeOption);
      applyTheme();
    });
  }
  systemLightQuery.addEventListener('change', applyTheme);
  applyTheme();
}

let drag = null;
function bindDrag() {
  for (const moduleId of MODULE_ORDER) {
    const element = previewRenderers[moduleId].element;
    element.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !settings.modules[moduleId].visible) return;
      event.preventDefault();
      selectModule(moduleId);
      $('previewStage').focus({ preventScroll: true });
      drag = {
        module: moduleId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: settings.modules[moduleId].x,
        y: settings.modules[moduleId].y,
        zoom: previewZoom,
      };
      element.setPointerCapture(event.pointerId);
      $('previewStage').classList.add('dragging');
    });
    element.addEventListener('pointermove', (event) => {
      if (!drag || drag.module !== moduleId || event.pointerId !== drag.pointerId) return;
      edit(moduleId, {
        x: drag.x + (event.clientX - drag.startX) / drag.zoom,
        y: drag.y + (event.clientY - drag.startY) / drag.zoom,
      });
    });
    const endDrag = () => {
      drag = null;
      $('previewStage').classList.remove('dragging');
      flush();
    };
    element.addEventListener('pointerup', endDrag);
    element.addEventListener('pointercancel', endDrag);
    element.addEventListener('lostpointercapture', endDrag);
  }
}

function bindGlobalControls() {
  for (const button of document.querySelectorAll('[data-module-button]')) {
    button.addEventListener('click', () => selectModule(button.dataset.moduleButton));
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
  for (const button of document.querySelectorAll('[data-background]')) {
    if (button.tagName !== 'BUTTON') continue;
    button.addEventListener('click', () => {
      $('previewStage').dataset.background = button.dataset.background;
      $('focusStage').dataset.background = button.dataset.background;
      for (const other of document.querySelectorAll('button[data-background]')) {
        const selected = button === other;
        other.classList.toggle('active', selected);
        other.setAttribute('aria-pressed', String(selected));
      }
    });
  }
  $('safeAreaToggle').addEventListener('change', (event) => { $('safeArea').hidden = !event.target.checked; });
  $('copyAddress').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(outputUrl);
      toast('OBS 浏览器来源地址已复制');
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents($('obsAddress'));
      selection.removeAllRanges();
      selection.addRange(range);
      toast('已选中地址，请按 Ctrl + C 复制');
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  window.addEventListener('pagehide', flush);
  window.addEventListener('resize', sizePreviewToViewport);
  new ResizeObserver(fitCanvas).observe($('previewStage'));
  new ResizeObserver(fitFocus).observe($('focusStage'));
  document.fonts.ready.then(() => { render(); sizePreviewToViewport(); });
}

populateAnimationSelects();
initThemeSwitch();
bindPicker();
bindFields();
bindDrag();
bindGlobalControls();
rebuildFocus();
render();
sizePreviewToViewport();
connect();
