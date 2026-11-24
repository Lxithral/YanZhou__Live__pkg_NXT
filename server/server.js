import http from 'node:http';
import { applyManagement, defaultManagement, validateManagement } from './stage-management.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants } from 'node:fs';
import { readFile, stat, mkdir, copyFile } from 'node:fs/promises';
import { WebSocket, WebSocketServer } from 'ws';
import { createLyricsSession, DEFAULT_LYRICS, LYRIC_COMMANDS, validateLyricSettings } from './lyrics-session.js';
import { createAsrCapture, readDashScopeConfig } from './asr-capture.js';
import { saveDashScopeConfig } from './asr-config.js';
import { createSpeechSession } from './speech-session.js';
import { atomicWrite, openLyricLibrary, validateSongReference } from './lyrics-library.js';

// 服务代码在 server/ 下；设置、public/、assets/ 都在项目根目录。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const MODULE_IDS = ['logo', 'hosts', 'program', 'lyrics', 'speech', 'eventMark'];
const ANIMATION_PRESETS = ['none', 'fade', 'fade-up', 'fade-down', 'slide-left', 'slide-right', 'scale-in'];
const DEFAULT_ANIMATION = { enter: 'fade-up', exit: 'fade-down', duration: 600 };
// 与 program-renderer.js 的撕开动画时长一致；撕完后才执行节目单退场。
const PROGRAM_TEAR_DURATION_MS = 1080;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u;

const FIELD_RULES = {
  visible: { kind: 'boolean', label: '显示状态' },
  variant: { kind: 'choice', values: ['school', 'rhythm'], label: '挂角样式' },
  showMark: { kind: 'boolean', label: '显示校徽' },
  title: { kind: 'text', max: 80, label: '主标题' },
  subtitle: { kind: 'text', max: 120, label: '副标题' },
  label: { kind: 'text', max: 40, label: '标签' },
  names: { kind: 'text', max: 240, label: '名单' },
  current: { kind: 'text', max: 80, label: '当前节目' },
  next: { kind: 'text', max: 80, label: '下一个节目' },
  nextLabel: { kind: 'text', max: 40, label: '下一个标签' },
  queue: { kind: 'text', max: 2000, label: '后续节目' },
  textColor: { kind: 'color', label: '文字颜色' },
  accentColor: { kind: 'color', label: '强调色' },
  x: { kind: 'number', min: 0, max: 1920, label: '水平 X' },
  y: { kind: 'number', min: 0, max: 1080, label: '垂直 Y' },
  scale: { kind: 'number', min: 0.25, max: 3, label: '大小' },
  opacity: { kind: 'number', min: 0, max: 100, label: '不透明度' },
  weight: { kind: 'number', min: 150, max: 700, label: '字重' },
  slotCount: { kind: 'number', min: 1, max: 4, label: '槽位数量' },
  style: { kind: 'choice', values: ['h', 'g', 'i'], label: '样式' },
  customColors: { kind: 'boolean', label: '自定义颜色' },
  autoHideAfterTear: { kind: 'boolean', label: '撕开票根后自动隐藏' },
  activeSlot: { kind: 'number', min: 0, max: 3, label: '当前主持人' },
};
// Fields that older settings files may lack; a missing value takes the default.
const OPTIONAL_DEFAULTS = { logo: { variant: 'school' }, hosts: { style: 'h', customColors: false, activeSlot: 0 }, program: { autoHideAfterTear: false } };

const MODULE_FIELDS = {
  logo: ['visible', 'variant', 'showMark', 'title', 'subtitle', 'textColor', 'weight', 'x', 'y', 'scale', 'opacity'],
  hosts: ['visible', 'label', 'names', 'slotCount', 'activeSlot', 'style', 'customColors', 'accentColor', 'textColor', 'x', 'y', 'scale', 'opacity'],
  program: ['visible', 'autoHideAfterTear', 'label', 'current', 'nextLabel', 'next', 'queue', 'accentColor', 'textColor', 'x', 'y', 'scale', 'opacity'],
  lyrics: ['visible', 'accentColor', 'textColor', 'x', 'y', 'scale', 'opacity'],
  speech: ['visible', 'textColor', 'x', 'y', 'scale', 'opacity'],
  eventMark: ['visible', 'x', 'y', 'scale', 'opacity'],
};

const clone = (value) => structuredClone(value);

export const DEFAULT_SETTINGS = {
  version: 5,
  canvas: { width: 1920, height: 1080 },
  modules: {
    logo: {
      visible: true,
      variant: 'school',
      showMark: true,
      title: '中山市烟洲中学',
      subtitle: 'YANZHOU · LIVE',
      textColor: '#772B2C',
      weight: 500,
      x: 112,
      y: 70,
      scale: 1,
      opacity: 100,
      animation: clone(DEFAULT_ANIMATION),
    },
    hosts: {
      visible: false,
      label: '主持人',
      names: '张三\n李四',
      slotCount: 2,
      activeSlot: 0,
      style: 'h',
      customColors: false,
      accentColor: '#71C4DE',
      textColor: '#2C2C2E',
      x: 96,
      y: 912,
      scale: 1,
      opacity: 100,
      animation: clone(DEFAULT_ANIMATION),
    },
    program: {
      visible: false,
      autoHideAfterTear: false,
      label: '正在演出',
      current: '节目名称',
      nextLabel: '接下来',
      next: '下一个节目',
      accentColor: '#A69AF5',
      textColor: '#F4F0E8',
      x: 1280,
      y: 770,
      scale: 1,
      opacity: 100,
      animation: clone(DEFAULT_ANIMATION),
    },
    lyrics: {
      visible: true, accentColor: '#F4F0E8', textColor: '#F4F0E8',
      x: 240, y: 678, scale: 1, opacity: 100,
      animation: { enter: 'none', exit: 'none', duration: 200 },
      ...clone(DEFAULT_LYRICS),
    },
    speech: {
      visible: false, textColor: '#F4F0E8',
      x: 240, y: 848, scale: 1, opacity: 100,
      animation: { enter: 'fade', exit: 'fade', duration: 200 },
    },
    eventMark: {
      visible: true, x: 1544, y: 940, scale: 1, opacity: 100,
      animation: { enter: 'none', exit: 'none', duration: 200 },
    },
  },
};

for (const kind of ['hosts', 'program']) Object.assign(DEFAULT_SETTINGS.modules[kind], defaultManagement(kind, DEFAULT_SETTINGS.modules[kind]));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateField(field, value) {
  const rule = FIELD_RULES[field];
  if (field === 'slotCount' && !Number.isInteger(value)) throw new Error('槽位数量必须是整数。');
  if (field === 'activeSlot' && !Number.isInteger(value)) throw new Error('当前主持人必须是整数。');
  if (rule.kind === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${rule.label}必须是布尔值。`);
    return value;
  }
  if (rule.kind === 'text') {
    if (typeof value !== 'string') throw new Error(`${rule.label}必须是文本。`);
    if ([...value].length > rule.max) throw new Error(`${rule.label}最多 ${rule.max} 个字符。`);
    if (CONTROL_CHARS.test(value)) throw new Error(`${rule.label}包含不支持的控制字符。`);
    if (field === 'queue' && value.split(/\r?\n/u).some((line) => [...line.trim()].length > FIELD_RULES.next.max)) {
      throw new Error('后续节目每行最多 80 个字符。');
    }
    return value;
  }
  if (rule.kind === 'choice') {
    if (!rule.values.includes(value)) throw new Error(`${rule.label}无效，可选：${rule.values.join(' / ')}。`);
    return value;
  }
  if (rule.kind === 'color') {
    if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) {
      throw new Error('颜色需要使用六位 HEX 格式，例如 #71C4DE。');
    }
    return value.toUpperCase();
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < rule.min || value > rule.max) {
    throw new Error(`${rule.label} 的有效范围是 ${rule.min}–${rule.max}。`);
  }
  return Math.round(value * 1000) / 1000;
}

function validateAnimationPreset(key, value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !ANIMATION_PRESETS.includes(value)) throw new Error('动画预设无效。');
  return value;
}

function validateAnimationDuration(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 100 || value > 3000) {
    throw new Error('动画时长应为 100–3000 毫秒。');
  }
  return Math.round(value);
}

function validateAnimationPatch(patch) {
  if (!isObject(patch) || Object.keys(patch).length === 0) throw new Error('动画设置不能为空。');
  const result = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'enter' || key === 'exit') result[key] = validateAnimationPreset(key, value);
    else if (key === 'duration') result.duration = validateAnimationDuration(value);
    else throw new Error(`不支持的动画设置项：${key}`);
  }
  return result;
}

function validateAnimation(animation) {
  if (!isObject(animation)) throw new Error('动画设置格式不正确。');
  for (const key of Object.keys(animation)) {
    if (!['enter', 'exit', 'duration'].includes(key)) throw new Error(`不支持的动画设置项：${key}`);
  }
  const enter = validateAnimationPreset('enter', animation.enter);
  const exit = validateAnimationPreset('exit', animation.exit);
  const duration = validateAnimationDuration(animation.duration);
  if (enter === undefined || exit === undefined || duration === undefined) {
    throw new Error('settings.json 缺少动画设置。');
  }
  return { enter, exit, duration };
}

function validateModulePatch(moduleId, patch) {
  if (!isObject(patch) || Object.keys(patch).length === 0) throw new Error('修改内容不能为空。');
  const allowed = new Set([...MODULE_FIELDS[moduleId], 'animation']);
  const result = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.has(key)) throw new Error(`不支持的设置项：${key}`);
    result[key] = key === 'animation' ? validateAnimationPatch(value) : validateField(key, value);
  }
  return result;
}

function validateModule(moduleId, module) {
  if (!isObject(module)) throw new Error(`settings.json 缺少模块：${moduleId}`);
  const allowed = new Set([...MODULE_FIELDS[moduleId], 'animation']);
  if (moduleId === 'hosts') ['people', 'slots'].forEach((key) => allowed.add(key));
  if (moduleId === 'logo') allowed.add('color');
  if (moduleId === 'program') ['items', 'selectedId'].forEach((key) => allowed.add(key));
  // v10 测试版曾保存 program.cardStyle（ticket / classic）；现在只有票根卡，读到时直接忽略。
  if (moduleId === 'program') allowed.add('cardStyle');
  if (moduleId === 'lyrics') {
    Object.keys(DEFAULT_LYRICS).forEach((key) => allowed.add(key));
    allowed.add('song');
    allowed.add('songOrder');
  }
  // v5 曾保存主持人字幕的停顿清屏秒数；现在不再自动清屏，读到时直接忽略。
  if (moduleId === 'speech') allowed.add('holdSeconds');
  for (const key of Object.keys(module)) {
    if (!allowed.has(key)) throw new Error(`不支持的设置项：${moduleId}.${key}`);
  }
  const result = {};
  for (const field of MODULE_FIELDS[moduleId]) {
    if (field === 'queue' && !Object.hasOwn(module, field)) continue;
    if (!Object.hasOwn(module, field) && Object.hasOwn(OPTIONAL_DEFAULTS[moduleId] ?? {}, field)) {
      result[field] = OPTIONAL_DEFAULTS[moduleId][field];
      continue;
    }
    // A style saved by an earlier version (or any unknown name) falls back to the default style.
    if (FIELD_RULES[field].kind === 'choice' && !FIELD_RULES[field].values.includes(module[field])) {
      result[field] = OPTIONAL_DEFAULTS[moduleId][field];
      continue;
    }
    if (!Object.hasOwn(module, field)) throw new Error(`settings.json 缺少设置项：${moduleId}.${field}`);
    result[field] = validateField(field, module[field]);
  }
  result.animation = validateAnimation(module.animation);
  if (moduleId !== 'lyrics') {
    if ((moduleId === 'hosts' && ('people' in module || 'slots' in module)) ||
        (moduleId === 'program' && ('items' in module || 'selectedId' in module))) {
      Object.assign(result, validateManagement(module, moduleId));
    }
    return result;
  }
  const { songOrder } = module;
  if (songOrder !== undefined && (!Array.isArray(songOrder) ||
      songOrder.some((id) => typeof id !== 'string' || !/^[0-9a-f]{32}$/u.test(id)) ||
      new Set(songOrder).size !== songOrder.length)) {
    throw new Error('歌曲播放顺序无效。');
  }
  return { ...result, ...validateLyricSettings(module), ...(module.song !== undefined && {
    song: validateSongReference(module.song),
  }), ...(songOrder !== undefined && { songOrder }) };
}

function validateSettings(settings) {
  if (!isObject(settings) || settings.version !== 5) {
    throw new Error('settings.json 格式不正确：版本应为 5。');
  }
  if (!isObject(settings.canvas) || settings.canvas.width !== 1920 || settings.canvas.height !== 1080) {
    throw new Error('settings.json 格式不正确，画布应为 1920 × 1080。');
  }
  if (!isObject(settings.modules)) throw new Error('settings.json 缺少包装模块设置。');
  for (const key of Object.keys(settings.modules)) {
    if (!MODULE_IDS.includes(key)) throw new Error(`settings.json 包含未知模块：${key}`);
  }
  const modules = {};
  for (const moduleId of MODULE_IDS) {
    const module = Object.hasOwn(settings.modules, moduleId) ? settings.modules[moduleId] : clone(DEFAULT_SETTINGS.modules[moduleId]);
    modules[moduleId] = validateModule(moduleId, module);
  }
  return { version: 5, canvas: { width: 1920, height: 1080 }, modules, ...(Object.hasOwn(settings, 'layout') && { layout: validateLayout(settings.layout) }) };
}

/** 画面整体设置（可选）：autoAvoid 自动避让，缺省视为开启，旧文件不需要补写。 */
function validateLayout(layout, partial = false) {
  if (!isObject(layout)) throw new Error('画面设置格式不正确。');
  for (const key of Object.keys(layout)) {
    if (key !== 'autoAvoid') throw new Error(`不支持的画面设置：${key}`);
  }
  if (!partial && !Object.hasOwn(layout, 'autoAvoid')) throw new Error('画面设置缺少 autoAvoid。');
  if (Object.hasOwn(layout, 'autoAvoid') && typeof layout.autoAvoid !== 'boolean') throw new Error('自动避让必须是开或关。');
  return { ...layout };
}

/** 人物条中实际上屏的槽位序号。 */
function shownSlots(hosts) {
  return (hosts.slots ?? []).flatMap((slot, index) => (index < hosts.slotCount && !slot.hidden && slot.personId ? [index] : []));
}

/** Upgrade older settings files stepwise to the current schema
 *  (v3 added logo.showMark, v4 logo.weight, v5 hosts.slotCount). */
export function migrateSettings(raw) {
  if (!isObject(raw)) return raw;
  let settings = raw;
  if (settings.version === 1 && isObject(settings.logo)) {
    const logo = clone(DEFAULT_SETTINGS.modules.logo);
    for (const field of MODULE_FIELDS.logo) {
      if (field === 'showMark' || field === 'weight') continue;
      if (Object.hasOwn(settings.logo, field)) logo[field] = settings.logo[field];
    }
    settings = {
      version: 2,
      canvas: { width: 1920, height: 1080 },
      modules: {
        logo,
        hosts: clone(DEFAULT_SETTINGS.modules.hosts),
        program: clone(DEFAULT_SETTINGS.modules.program),
      },
    };
  }
  if (settings.version === 2 && isObject(settings.modules)) {
    const modules = clone(settings.modules);
    if (isObject(modules.logo)) modules.logo = { showMark: true, ...modules.logo };
    settings = { ...settings, version: 3, modules };
  }
  if (settings.version === 3 && isObject(settings.modules)) {
    const modules = clone(settings.modules);
    if (isObject(modules.logo) && !Object.hasOwn(modules.logo, 'weight')) modules.logo.weight = 500;
    settings = { ...settings, version: 4, modules };
  }
  if (settings.version === 4 && isObject(settings.modules)) {
    const modules = clone(settings.modules);
    // The legacy caption bar is white: a name in the old default near-white
    // would be unreadable, so only untouched defaults move to the dark ink.
    if (isObject(modules.hosts)) {
      if (!Object.hasOwn(modules.hosts, 'slotCount')) modules.hosts.slotCount = 2;
      if (modules.hosts.textColor === '#F4F0E8') modules.hosts.textColor = '#2C2C2E';
    }
    settings = { ...settings, version: 5, modules };
  }
  return settings;
}

function settingsForDisk(settings) {
  const lyrics = settings.modules.lyrics;
  if (!lyrics.song) return settings;
  return { ...settings, modules: { ...settings.modules, lyrics: { ...lyrics, doc: [] } } };
}

export async function createPackagingServer({
  settingsPath = path.join(ROOT, 'settings.json'),
  saveDelayMs = 120,
  rootDir = ROOT,
  asr,
  asrConfigPath = path.join(path.dirname(settingsPath), '.env'),
} = {}) {
  let settings;
  let savedAt;
  let hasSettings = false;
  let skippedSong = null;
  const library = await openLyricLibrary(path.join(path.dirname(settingsPath), 'config', 'lyrics'));
  try {
    const contents = await readFile(settingsPath, 'utf8');
    hasSettings = true;
    const raw = JSON.parse(contents);
    const migrated = migrateSettings(raw);
    const previousLyrics = migrated?.modules?.lyrics;
    let updatedSong = false;
    if (previousLyrics?.song !== undefined &&
        !library.list().some((entry) => entry.id === validateSongReference(previousLyrics.song).id)) {
      // 曲库里没有设置中引用的歌（例如干净解压、config/lyrics 未随包拷贝）：按未选歌处理，其余设置不变。
      // 不主动改写 settings.json；下次保存设置时自然去掉这条引用。
      const { id } = validateSongReference(previousLyrics.song);
      skippedSong = {
        id,
        message: `曲库中找不到上次使用的歌曲（编号 ${id.slice(0, 8)}），已跳过。请从曲库重新选择，或在歌词台导入 LRC。`,
      };
      delete previousLyrics.song;
      previousLyrics.doc = [];
      previousLyrics.transport = { ...previousLyrics.transport, position: 0 };
      if (previousLyrics.manual?.lines === null) {
        previousLyrics.manual = { ...previousLyrics.manual, index: null, current: '' };
      }
      console.warn(`[提示] 曲库中找不到歌曲（编号 ${id}），已跳过，请在歌词台重新选择或导入。曲库目录：${path.join(path.dirname(settingsPath), 'config', 'lyrics')}`);
    }
    if (previousLyrics?.song !== undefined) {
      const reference = validateSongReference(previousLyrics.song);
      const song = await library.load(reference.id);
      previousLyrics.doc = song.doc;
      if (reference.version !== song.version) {
        previousLyrics.song = { id: song.id, version: song.version };
        previousLyrics.transport = { ...previousLyrics.transport, position: 0 };
        if (previousLyrics.manual?.lines === null) {
          previousLyrics.manual = { ...previousLyrics.manual, index: null, current: '' };
        }
        updatedSong = true;
      }
    }
    settings = validateSettings(migrated);
    const needsManagement = !settings.modules.hosts.people || !settings.modules.program.items;
    if (needsManagement) {
      try {
        await copyFile(settingsPath, `${settingsPath}.pre-management.bak`, constants.COPYFILE_EXCL);
      } catch (error) { if (error.code !== 'EEXIST') throw error; }
      for (const kind of ['hosts', 'program']) {
        const module = settings.modules[kind];
        if (!(kind === 'hosts' ? module.people : module.items)) Object.assign(module, defaultManagement(kind, module));
      }
    }
    const currentLyrics = settings.modules.lyrics;
    const legacyDoc = !currentLyrics.song && currentLyrics.doc.length > 0;
    if (legacyDoc) {
      const song = await library.migrate(currentLyrics.doc);
      currentLyrics.song = { id: song.id, version: song.version };
    }
    if (needsManagement || legacyDoc || updatedSong || migrated !== raw || !Object.hasOwn(raw.modules, 'lyrics')) {
      try {
        const backup = legacyDoc || updatedSong ? 'pre-library' : 'pre-lyrics';
        await copyFile(settingsPath, `${settingsPath}.${backup}.bak`, constants.COPYFILE_EXCL);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      await atomicWrite(settingsPath, settingsForDisk(settings));
    }
    savedAt = (await stat(settingsPath)).mtime.toISOString();
  } catch (error) {
    if (hasSettings || error.code !== 'ENOENT') throw new Error(`无法读取设置文件；原文件已保留。${error.message}`, { cause: error });
    settings = clone(DEFAULT_SETTINGS);
    await mkdir(path.dirname(settingsPath), { recursive: true });
    await atomicWrite(settingsPath, settings);
    savedAt = new Date().toISOString();
  }

  let revision = 0;
  let savedRevision = 0;
  let saveTimer;
  let writeQueue = Promise.resolve();
  let songQueue = Promise.resolve();
  let commandQueue = Promise.resolve();
  let closing = false;
  const clients = new Set();
  // 上屏先后顺序只保存在内存里（不写入 settings.json）：先出现的模块在前，自动避让时后出现的让开。
  let showOrder;
  let ticket = { cycle: 0, tornAt: null };
  let ticketHideTimer;
  let ticketHideGeneration = 0;
  const cancelTicketHide = () => {
    clearTimeout(ticketHideTimer);
    ticketHideTimer = undefined;
    ticketHideGeneration += 1;
  };
  const stageSnapshot = () => ({ showOrder: [...getShowOrder()], ticket: { ...ticket } });
  const getShowOrder = () => (showOrder ??= MODULE_IDS.filter((id) => settings.modules[id].visible));
  const trackShown = (previous, next) => {
    if ((!previous.program.visible && next.program.visible) || previous.program.selectedId !== next.program.selectedId ||
        (!next.program.current && !next.program.next && (previous.program.current || previous.program.next))) {
      ticket = { cycle: ticket.cycle + 1, tornAt: null };
      cancelTicketHide();
    }
    if (!next.program.visible || !next.program.autoHideAfterTear) cancelTicketHide();
    let order = getShowOrder();
    for (const id of MODULE_IDS) {
      const was = Boolean(previous[id]?.visible);
      const now = Boolean(next[id]?.visible);
      let bump = !was && now;
      if (id === 'hosts' && was && now) {
        const before = new Set(shownSlots(previous.hosts));
        bump = shownSlots(next.hosts).some((index) => !before.has(index));
      }
      if (!now) order = order.filter((entry) => entry !== id);
      else if (bump || !order.includes(id)) order = [...order.filter((entry) => entry !== id), id];
    }
    showOrder = order;
  };
  const getState = () => ({ type: 'state', settings: clone(settings), stage: stageSnapshot(), revision, savedRevision, savedAt });
  const getWireState = () => {
    const { doc, manual, songOrder, ...module } = settings.modules.lyrics;
    const { lines, ...manualState } = manual;
    return {
      type: 'state', revision, savedRevision, savedAt,
      stage: stageSnapshot(),
      settings: {
        ...settings,
        modules: {
          ...settings.modules,
          lyrics: { ...module, ...(!doc.length && { doc }), manual: lines?.length ? manualState : manual },
        },
      },
    };
  };
  const send = (client, message) => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
  };
  const broadcast = (message) => {
    for (const client of clients) send(client, message);
  };
  const scheduleTicketHide = () => {
    cancelTicketHide();
    if (!settings.modules.program.autoHideAfterTear || ticket.tornAt === null) return;
    const tornTicket = ticket;
    const generation = ticketHideGeneration;
    ticketHideTimer = setTimeout(() => {
      ticketHideTimer = undefined;
      // 与控制指令串行执行，避免资料库保存期间旧节目把新节目隐藏。
      const task = commandQueue.then(() => {
        const program = settings.modules.program;
        if (closing || generation !== ticketHideGeneration || ticket !== tornTicket || !program.visible || !program.autoHideAfterTear) return;
        const next = { ...settings, modules: { ...settings.modules, program: { ...program, visible: false } } };
        trackShown(settings.modules, next.modules);
        settings = next;
        revision += 1;
        broadcast(getWireState());
        scheduleSave();
      });
      commandQueue = task.catch(() => {});
    }, PROGRAM_TEAR_DURATION_MS);
    ticketHideTimer.unref();
  };
  const lyrics = createLyricsSession(settings.modules.lyrics, () => publishLyrics());
  const activeSongId = () => settings.modules.lyrics.song?.id ?? null;
  const lyricState = (include, id) => ({
    type: 'lyrics:state', ...lyrics.snapshot(include), songId: activeSongId(), revision, savedRevision, id,
  });
  function orderedSongs() {
    const songs = new Map(library.list().map((song) => [song.id, song]));
    const ordered = [];
    for (const id of settings.modules.lyrics.songOrder ?? []) {
      if (songs.has(id)) ordered.push(songs.get(id));
      songs.delete(id);
    }
    return [...ordered, ...songs.values()];
  }
  const songState = () => ({
    type: 'lyrics:songs', songs: orderedSongs(), activeId: activeSongId(),
    ...(skippedSong && { skipped: { ...skippedSong } }),
  });

  function moveSong(payload, id) {
    if (!isObject(payload) || Object.keys(payload).length !== 2 ||
        typeof payload.id !== 'string' || ![-1, 1].includes(payload.direction)) {
      throw new Error('歌曲排序操作无效。');
    }
    const order = orderedSongs().map((song) => song.id);
    const from = order.indexOf(payload.id);
    if (from < 0) throw new Error('曲库中找不到这首歌。');
    const to = from + payload.direction;
    if (to < 0 || to >= order.length) return;
    order.splice(from, 1);
    order.splice(to, 0, payload.id);
    settings.modules.lyrics.songOrder = order;
    broadcast(songState());
    publishLyrics(undefined, id);
  }

  async function changeSong(type, payload, id) {
    const keys = type === 'lyrics:load' ? ['doc', 'title', 'artist', 'replaceId', 'saveKey'] : ['id'];
    if (!isObject(payload) || Object.keys(payload).some((key) => !keys.includes(key)) ||
        (type === 'lyrics:load' && payload.replaceId !== undefined && typeof payload.title !== 'string')) {
      throw new Error('歌曲操作格式无效。');
    }
    const order = orderedSongs().map((song) => song.id);
    const song = type === 'lyrics:load'
      ? await library.save(payload.title === undefined ? '未命名歌曲' : payload.title, payload.doc, payload.replaceId, payload.saveKey, payload.artist)
      : await library.load(payload.id);
    const include = lyrics.apply('lyrics:load', { doc: song.doc });
    if (!order.includes(song.id)) {
      settings.modules.lyrics.songOrder = [...order, song.id];
    }
    settings.modules.lyrics.song = { id: song.id, version: song.version };
    skippedSong = null;
    broadcast(songState());
    publishLyrics(include, id);
    broadcast(asrState());
  }
  const speech = createSpeechSession({ onChange: broadcast });
  let recognition = { phase: 'idle', owner: null, resultOwner: null, message: '', partial: '', finals: [] };
  const capture = createAsrCapture({
    ...(asr ?? await readDashScopeConfig(asrConfigPath)),
    onService() {
      if (recognition.phase === 'error') recognition = { ...recognition, phase: 'idle', message: '' };
      broadcast(asrState());
    },
    onStatus(status) {
      recognition = {
        ...recognition, ...status, partial: '',
        ...(status.phase === 'loading' && { resultOwner: status.owner, finals: [] }),
      };
      if (status.phase !== 'listening') speech.clear();
      broadcast(asrState());
    },
    onResult(event) {
      const listening = recognition.phase === 'listening';
      if (listening && recognition.owner === 'speech') speech.accept(event);
      if (event.final) {
        recognition = {
          ...recognition, partial: '',
          finals: [...recognition.finals, { text: event.text, at: Date.now() }].slice(-20),
        };
      } else recognition = { ...recognition, partial: event.text };
      if (listening && recognition.owner === 'lyrics' && event.final &&
          Number.isFinite(event.at) && lyrics.correct(event)) {
        const { from, to } = lyrics.correction().history[0];
        publishLyrics(undefined, undefined, to - from);
      }
      broadcast(asrState());
    },
  });
  const asrState = () => ({
    type: 'lyrics:asr', ...recognition, configured: capture.configured, testing: capture.testing,
    credentialsEditable: true, workspaceId: capture.workspaceId,
    model: capture.model,
    serviceMessage: capture.message, correction: lyrics.correction(),
  });

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(queueSave, saveDelayMs);
  }

  function checkpointLyrics() {
    settings.modules.lyrics = { ...settings.modules.lyrics, ...lyrics.persisted() };
    revision += 1;
  }

  function publishLyrics(include, id, correctionDelta) {
    checkpointLyrics();
    broadcast({ ...lyricState(include, id), correctionDelta });
    scheduleSave();
  }

  const lyricHeartbeat = setInterval(() => broadcast(lyricState()), 2000);
  const lyricCheckpoint = setInterval(() => {
    if (lyrics.checkpointNeeded()) publishLyrics();
  }, 5000);
  lyricHeartbeat.unref();
  lyricCheckpoint.unref();

  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    const task = writeQueue.catch(() => {}).then(async () => {
      const snapshot = clone(settingsForDisk(settings));
      const targetRevision = revision;
      await atomicWrite(settingsPath, snapshot);
      savedRevision = targetRevision;
      savedAt = new Date().toISOString();
      broadcast({ type: 'saved', revision: savedRevision, savedAt });
    });
    writeQueue = task;
    task.catch((error) => {
      console.error('设置保存失败：', error.message);
      broadcast({ type: 'error', scope: 'save', message: '本地设置保存失败，请检查文件是否可写。当前画面仍保持最新状态。' });
    });
    return task;
  }

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end('Method not allowed');
      return;
    }
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      if (pathname === '/api/state' || pathname === '/health') {
        const body = JSON.stringify(pathname === '/health' ? { ok: true } : getState());
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }
      if (pathname === '/api/lyrics/song') {
        const lines = await library.preview(url.searchParams.get('id'));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify(lines));
        return;
      }
      if (pathname.includes('\\') || pathname.includes('\0')) throw new Error('Invalid path');
      const isAsset = pathname.startsWith('/assets/');
      const base = path.resolve(rootDir, isAsset ? 'assets' : 'public');
      const relative = isAsset ? pathname.slice('/assets/'.length) : (pathname === '/' ? 'control.html' : pathname.slice(1));
      const target = path.resolve(base, relative);
      if (!target.startsWith(`${base}${path.sep}`)) throw new Error('Invalid path');
      const metadata = await stat(target);
      if (!metadata.isFile()) throw new Error('Not a file');
      const body = req.method === 'HEAD' ? undefined : await readFile(target);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'Content-Length': metadata.size,
        'Cache-Control': isAsset ? 'public, max-age=3600' : 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : '文件不存在');
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const audio = url.pathname === '/asr';
      if ((!audio && url.pathname !== '/ws') || closing) {
        socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        return;
      }
      if (req.headers.origin || audio) {
        const origin = req.headers.origin ? new URL(req.headers.origin) : null;
        const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
        const currentPort = String(server.address()?.port);
        if (!origin || !allowedHosts.has(origin.hostname) || origin.port !== currentPort) {
          socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
          return;
        }
      }
      wss.handleUpgrade(req, socket, head, (client) => wss.emit('connection', client, url));
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (client, url) => {
    client.isAlive = true;
    client.on('pong', () => { client.isAlive = true; });
    client.on('error', () => {});
    if (url.pathname === '/asr') {
      const owner = url.searchParams.get('owner') || 'lyrics';
      if (url.searchParams.get('options') !== '1') {
        capture.attach(client, owner);
        return;
      }
      const reject = () => {
        send(client, { type: 'error', message: '识别设置未收到或格式无效，请重试。' });
        client.close(1008);
      };
      const timer = setTimeout(reject, 5000);
      client.once('close', () => clearTimeout(timer));
      client.once('message', (data, binary) => {
        clearTimeout(timer);
        if (closing || binary || data.length > 16 * 1024) return reject();
        try { capture.attach(client, owner, JSON.parse(data.toString())); }
        catch { reject(); }
      });
      return;
    }
    clients.add(client);
    client.on('close', () => clients.delete(client));
    send(client, getWireState());
    send(client, lyricState({ doc: true, lines: true }));
    send(client, songState());
    send(client, asrState());
    send(client, speech.snapshot());
    const handleMessage = async (data, isBinary) => {
      let id;
      try {
        if (closing) throw new Error('服务正在关闭。');
        if (isBinary) throw new Error('只支持 JSON 文本消息。');
        const message = JSON.parse(data.toString());
        id = typeof message.id === 'string' ? message.id.slice(0, 80) : undefined;
        if (message.type === 'asr:configure') {
          try {
            if (data.length > 16 * 1024) throw new Error('消息超过 16 KiB。');
            if (Object.keys(message).some((key) => !['type', 'id', 'options'].includes(key))) throw new Error('百炼凭证设置格式无效。');
            await capture.configure(message.options, (credentials) => saveDashScopeConfig(asrConfigPath, credentials));
            send(client, { type: 'asr:config', ok: true, id, message: '百炼凭证已保存，可直接测试连接。' });
          } catch (error) {
            send(client, { type: 'asr:config', ok: false, id, message: error.message });
          }
          return;
        }
        if (message.type !== 'lyrics:load' && data.length > 16 * 1024) throw new Error('消息超过 16 KiB。');
        if (message.type === 'program:ticket-set') {
          if (Object.keys(message).some((key) => !['type', 'id', 'cycle', 'torn'].includes(key)) ||
              !Number.isSafeInteger(message.cycle) || typeof message.torn !== 'boolean') {
            throw new Error('票根指令格式无效。');
          }
          const program = settings.modules.program;
          if (message.cycle === ticket.cycle && (ticket.tornAt !== null) !== message.torn &&
              program.visible && (program.current || program.next)) {
            ticket = { ...ticket, tornAt: message.torn ? Date.now() : null };
            scheduleTicketHide();
            broadcast({ type: 'program:ticket', ticket: { ...ticket }, id });
          } else send(client, { type: 'program:ticket', ticket: { ...ticket }, id });
          return;
        }
        if (['asr:test', 'asr:stop', 'speech:clear'].includes(message.type)) {
          const allowed = message.type === 'asr:test' ? ['type', 'id', 'options'] : ['type', 'id'];
          if (Object.keys(message).some((key) => !allowed.includes(key))) throw new Error('识别控制消息包含未知字段。');
          if (message.type === 'asr:test') capture.test(message.options);
          else if (message.type === 'asr:stop') capture.stop();
          else speech.clear();
          send(client, { ...asrState(), id });
          return;
        }
        if (['hosts:manage', 'program:manage'].includes(message.type)) {
          if (Object.keys(message).some((key) => !['type', 'id', 'payload'].includes(key))) throw new Error('管理消息包含未知字段。');
          const kind = message.type.split(':')[0];
          const task = writeQueue.catch(() => {}).then(async () => {
            const next = applyManagement(settings.modules[kind], kind, message.payload);
            // 已经在最后一项再按「下一项」，或重复提交同一个槽位：画面没变，就不要重写文件。
            if (JSON.stringify(next) === JSON.stringify(settings.modules[kind])) return false;
            const revisionBefore = revision;
            const candidate = { ...settings, modules: { ...settings.modules, [kind]: next } };
            await atomicWrite(settingsPath, settingsForDisk(candidate));
            const concurrent = revision !== revisionBefore;
            trackShown(settings.modules, candidate.modules);
            settings.modules[kind] = next;
            revision += 1;
            // 写盘期间歌词进度如果又往前走了，这份文件不含那次进度，不能把它标成已保存。
            if (!concurrent) {
              savedRevision = revision;
              savedAt = new Date().toISOString();
            }
            return true;
          });
          // A rejected management edit leaves the accepted state unchanged.
          writeQueue = task.catch(() => {});
          const changed = await task;
          if (changed) {
            broadcast({ ...getWireState(), id });
            if (savedRevision < revision) scheduleSave();
          }
          send(client, { type: 'management:result', id });
          return;
        }
        if (LYRIC_COMMANDS.includes(message.type) || ['lyrics:select-song', 'lyrics:move-song'].includes(message.type)) {
          if (Object.keys(message).some((key) => !['type', 'id', 'payload'].includes(key))) {
            throw new Error('歌词消息包含未知字段。');
          }
          const task = songQueue.then(async () => {
            if (closing) throw new Error('服务正在关闭。');
            if (message.type === 'lyrics:load' || message.type === 'lyrics:select-song') {
              await changeSong(message.type, message.payload, id);
            } else if (message.type === 'lyrics:move-song') {
              moveSong(message.payload, id);
            } else if (message.type === 'lyrics:clear-correction-log') {
              lyrics.apply(message.type, message.payload);
              broadcast(asrState());
            } else {
              const change = lyrics.apply(message.type, message.payload);
              if (change) publishLyrics(change, id);
              else send(client, lyricState(undefined, id));
              if (message.type === 'lyrics:correct') broadcast(asrState());
            }
          });
          songQueue = task.catch(() => {});
          await task;
          return;
        }
        if (message.type === 'patch' && isObject(message.patch) && Object.keys(message.patch).length === 1 && isObject(message.patch.layout)) {
          const layout = { autoAvoid: true, ...settings.layout, ...validateLayout(message.patch.layout, true) };
          if (JSON.stringify(layout) === JSON.stringify({ autoAvoid: true, ...settings.layout })) {
            send(client, { ...getWireState(), id });
            return;
          }
          settings = { ...settings, layout };
          revision += 1;
          broadcast({ ...getWireState(), id });
          scheduleSave();
          return;
        }
        if (message.type !== 'patch' || !isObject(message.patch) || !isObject(message.patch.modules)) {
          throw new Error('只支持包装模块设置修改。');
        }
        if (Object.keys(message.patch).some((key) => key !== 'modules')) throw new Error('画面设置需要单独修改。');
        const moduleIds = Object.keys(message.patch.modules);
        if (moduleIds.length !== 1) throw new Error('每次只能修改一个包装模块。');
        const moduleId = moduleIds[0];
        if (!MODULE_IDS.includes(moduleId)) throw new Error(`未知模块：${moduleId}`);
        const values = validateModulePatch(moduleId, message.patch.modules[moduleId]);
        const current = settings.modules[moduleId];
        const nextModule = { ...current };
        for (const [key, value] of Object.entries(values)) {
          if (key === 'animation') nextModule.animation = { ...current.animation, ...value };
          else nextModule[key] = value;
        }
        if (JSON.stringify(nextModule) === JSON.stringify(current)) {
          send(client, { ...getWireState(), id });
          return;
        }
        trackShown(settings.modules, { ...settings.modules, [moduleId]: nextModule });
        settings = { ...settings, modules: { ...settings.modules, [moduleId]: nextModule } };
        revision += 1;
        broadcast({ ...getWireState(), id });
        scheduleSave();
      } catch (error) {
        send(client, { type: 'error', message: error.message, id });
      }
    };
    client.on('message', (data, isBinary) => {
      const task = commandQueue.then(() => handleMessage(data, isBinary));
      commandQueue = task.catch(() => {});
    });
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (!client.isAlive) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, 15000);
  heartbeat.unref();

  return {
    server,
    getState,
    listen(port = 3000, host = '127.0.0.1') {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve({ port: server.address().port, host });
        });
      });
    },
    async close() {
      if (closing) return;
      closing = true;
      cancelTicketHide();
      clearInterval(heartbeat);
      clearInterval(lyricHeartbeat);
      clearInterval(lyricCheckpoint);
      await capture.close();
      await commandQueue;
      await songQueue;
      lyrics.close();
      if (lyrics.checkpointNeeded()) checkpointLyrics();
      clearTimeout(saveTimer);
      if (savedRevision < revision) await queueSave();
      else await writeQueue;
      for (const client of wss.clients) client.terminate();
      await new Promise((resolve) => wss.close(resolve));
      if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let app;
  try {
    app = await createPackagingServer();
    const port = Number(process.env.PORT || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须为 1–65535 的整数。');
    await app.listen(port);
    console.log(`\n烟洲直播包装服务已启动\n控制面板：http://localhost:${port}/control.html\n歌词控制台：http://localhost:${port}/lyrics.html\nOBS 浏览器来源：http://localhost:${port}/overlay.html\n设置文件：${path.join(ROOT, 'settings.json')}\n按 Ctrl+C 可保存设置并退出。\n`);
    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      try { await app.close(); process.exitCode = 0; }
      catch (error) { console.error('关闭时保存失败：', error.message); process.exitCode = 1; }
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error(`启动失败：${error.code === 'EADDRINUSE' ? '端口已被占用，请关闭该端口的旧服务或通过 PORT 指定其他端口。' : error.message}`);
    if (app) await app.close().catch(() => {});
    process.exitCode = 1;
  }
}
