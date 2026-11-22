import { readFileSync } from 'node:fs';

const PEOPLE = JSON.parse(readFileSync(new URL('../config/people-defaults.json', import.meta.url), 'utf8'));
const PROGRAMS = JSON.parse(readFileSync(new URL('../config/program-defaults.json', import.meta.url), 'utf8'));
const STYLES = ['h', 'g', 'i'];
const COLORS = { h: ['#143B83', '#123571'], g: ['#792B2D', '#792B2D'], i: ['#792B2D', '#58232C'] };
const ID = /^[a-zA-Z0-9_-]{1,64}$/u;

function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('管理数据包含无效字段。');
}
function text(value, max, required = false) {
  if (typeof value !== 'string' || [...value].length > max ||
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value) || (required && !value.trim())) {
    throw new Error(`文字不能为空或超过 ${max} 个字符。`);
  }
  return value;
}
function itemId(id) {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('资料编号无效。');
  return id;
}
function record(value, kind) {
  const limits = kind === 'hosts' ? { name: 80, title: 120, bio: 1000 } :
    { number: 40, type: 80, title: 80, performer: 1000, desc: 2000, cover: 500 };
  fields(value, ['id', ...Object.keys(limits)]);
  return { id: itemId(value.id), ...Object.fromEntries(Object.entries(limits).map(([key, max]) =>
    [key, text(value[key] ?? '', max, key === (kind === 'hosts' ? 'name' : 'title'))])) };
}
function list(values, kind) {
  if (!Array.isArray(values) || values.length > 200) throw new Error('资料库最多 200 项。');
  const result = values.map((value) => record(value, kind));
  if (new Set(result.map(({ id }) => id)).size !== result.length) throw new Error('资料编号重复。');
  return result;
}
export function defaultManagement(kind, module) {
  if (kind === 'hosts') {
    const people = PEOPLE.map((p, i) => record({ ...p, id: `person-${i + 1}` }, kind));
    const style = STYLES.includes(module.style) ? module.style : 'h';
    return { people, slots: Array.from({ length: 4 }, (_, i) => ({
      personId: people[i]?.id ?? null, hidden: i >= 2, style,
      customColors: Boolean(module.customColors),
      accentColor: module.customColors ? module.accentColor : COLORS[style][0],
      textColor: module.customColors ? module.textColor : COLORS[style][1],
    })), slotCount: 2, visible: false };
  }
  const items = PROGRAMS.map((p, i) => record({ ...p, id: `program-${i + 1}` }, kind));
  return projectProgram({ items, selectedId: items[0]?.id ?? null, visible: false });
}
export function validateManagement(module, kind) {
  if (kind === 'hosts') {
    const people = list(module.people, kind);
    if (!Array.isArray(module.slots) || module.slots.length !== 4) throw new Error('必须保留四个槽位。');
    const slots = module.slots.map((slot) => {
      fields(slot, ['personId', 'hidden', 'style', 'customColors', 'accentColor', 'textColor']);
      if (slot.personId !== null && !people.some(({ id }) => id === slot.personId)) throw new Error('人物不存在。');
      if (typeof slot.hidden !== 'boolean' || typeof slot.customColors !== 'boolean' ||
          !STYLES.includes(slot.style) || typeof slot.accentColor !== 'string' ||
          typeof slot.textColor !== 'string' || !/^#[0-9a-f]{6}$/iu.test(slot.accentColor) ||
          !/^#[0-9a-f]{6}$/iu.test(slot.textColor)) throw new Error('槽位设置无效。');
      return { ...slot };
    });
    if (!Number.isInteger(module.slotCount) || module.slotCount < 1 || module.slotCount > 4) throw new Error('槽位数量无效。');
    const result = { people, slots };
    if (Buffer.byteLength(JSON.stringify(result)) > 80 * 1024) throw new Error('人物资料库超过 80 KiB。');
    return result;
  }
  const items = list(module.items, kind);
  if (module.selectedId !== null && !items.some(({ id }) => id === module.selectedId)) throw new Error('当前节目不存在。');
  if (items.length && module.selectedId === null) throw new Error('请选择当前节目。');
  if (Buffer.byteLength(JSON.stringify(items)) > 80 * 1024) throw new Error('节目资料库超过 80 KiB。');
  return { items, selectedId: module.selectedId };
}
function projectProgram(module) {
  const index = module.items.findIndex(({ id }) => id === module.selectedId);
  return { ...module, current: module.items[index]?.title ?? '', next: module.items[index + 1]?.title ?? '', queue: '' };
}
export function applyManagement(module, kind, payload) {
  fields(payload, ['action', 'item', 'id', 'direction', 'index', 'patch', 'order', 'move']);
  const next = structuredClone(module);
  const key = kind === 'hosts' ? 'people' : 'items';
  const records = next[key];
  if (payload.action === 'save') {
    fields(payload, ['action', 'item']);
    const item = record(payload.item, kind);
    const index = records.findIndex(({ id }) => id === item.id);
    if (index < 0) records.push(item);
    else records[index] = item;
    if (kind === 'program' && next.selectedId === null) next.selectedId = item.id;
  } else if (payload.action === 'delete') {
    fields(payload, ['action', 'id']);
    const index = records.findIndex(({ id }) => id === itemId(payload.id));
    if (index < 0) throw new Error('资料已不存在，请刷新列表。');
    records.splice(index, 1);
    if (kind === 'hosts') {
      for (const slot of next.slots) {
        if (slot.personId === payload.id) { slot.personId = null; slot.hidden = true; }
      }
    } else if (next.selectedId === payload.id) next.selectedId = records[index]?.id ?? records.at(-1)?.id ?? null;
  } else if (kind === 'hosts' && payload.action === 'slot') {
    fields(payload, ['action', 'index', 'patch']);
    if (!Number.isInteger(payload.index) || payload.index < 0 || payload.index > 3) throw new Error('槽位编号无效。');
    fields(payload.patch, ['personId', 'hidden', 'style', 'customColors', 'accentColor', 'textColor']);
    const slot = next.slots[payload.index];
    Object.assign(slot, payload.patch);
    if (payload.patch.style && !Object.hasOwn(payload.patch, 'customColors')) {
      slot.customColors = false;
      [slot.accentColor, slot.textColor] = COLORS[slot.style] ?? [];
    }
  } else if (kind === 'program' && payload.action === 'reorder') {
    // 拖动排序：order 必须是当前全部节目 ID 的一个排列；当前节目按 ID 追踪，排序后保持不变。
    fields(payload, ['action', 'order', 'move']);
    let { order } = payload;
    if (!Array.isArray(order) || order.length !== records.length) throw new Error('节目列表已变化，请刷新后再排序。');
    if (Object.hasOwn(payload, 'move')) {
      fields(payload.move, ['id', 'to']);
      if (records.some(({ id }, index) => id !== order[index])) throw new Error('节目顺序已在另一端调整，请按当前顺序重试。');
      const { id, to } = payload.move;
      const from = order.indexOf(itemId(id));
      if (from < 0 || !Number.isSafeInteger(to) || to < 0 || to >= order.length) throw new Error('节目移动位置无效。');
      if (from === to) return next;
      order = [...order];
      order.splice(to, 0, ...order.splice(from, 1));
    }
    const byId = new Map(records.map((item) => [item.id, item]));
    const seen = new Set();
    for (const id of order) {
      if (!byId.has(itemId(id)) || seen.has(id)) throw new Error('节目列表已变化，请刷新后再排序。');
      seen.add(id);
    }
    // 拖动后按新顺序重写编号：01、02…，至少两位，超过 99 个自动变三位。只有拖动排序触发，编辑/新增不改编号。
    const width = Math.max(2, String(records.length).length);
    next.items = order.map((id, index) => ({ ...byId.get(id), number:String(index + 1).padStart(width, '0') }));
  } else if (kind === 'program' && payload.action === 'select') {
    fields(payload, ['action', 'id']);
    next.selectedId = itemId(payload.id);
  } else if (payload.action === 'navigate') {
    fields(payload, kind === 'hosts' ? ['action', 'index', 'direction'] : ['action', 'direction']);
    if (![-1, 1].includes(payload.direction)) throw new Error('切换方向无效。');
    const slot = kind === 'hosts' ? next.slots[payload.index] : null;
    if (kind === 'hosts' && (!Number.isInteger(payload.index) || !slot)) throw new Error('槽位编号无效。');
    const selected = kind === 'hosts' ? slot.personId : next.selectedId;
    const from = records.findIndex(({ id }) => id === selected);
    // 空字幕条没有当前人物。左右切换不能替它从资料库里挑一个人送上画面。
    if (!(kind === 'hosts' && from < 0)) {
      const target = from < 0 ? (payload.direction > 0 ? records[0] : records.at(-1)) : records[from + payload.direction];
      if (target) {
        if (slot) slot.personId = target.id;
        else next.selectedId = target.id;
      }
    }
  } else throw new Error('管理操作无效。');
  Object.assign(next, validateManagement(next, kind));
  return kind === 'program' ? projectProgram(next) : next;
}

