const $ = (id) => document.getElementById(id);
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function button(text, action, key, className = '') {
  const b = node('button', text, 'button ' + className);
  b.type = 'button';
  b.onclick = action;
  if (key) b.dataset.focusKey = key;
  return b;
}
// 六点拖动手柄图标（2 列 × 3 行），用 SVG 画，不依赖字体。
function gripIcon(className = 'stage-grip-icon') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 9 15');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const cy of [2.5, 7.5, 12.5]) for (const cx of [2.25, 6.75]) {
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('r', '1.25');
    svg.append(dot);
  }
  return svg;
}
function kbd(text) {
  return node('kbd', text, 'stage-kbd');
}
function limited(b, condition) {
  b.dataset.unavailable = String(condition);
  return b;
}
export function bindStageControls({ send, edit, toast }) {
  let settings;
  let ready = false;
  let request;
  let last;
  let savingKind;
  let reordering = false;
  const editors = new Map();
  const areas = {};
  for (const kind of ['hosts', 'program']) {
    const panel = document.querySelector(`[data-module-panel="${kind}"]`);
    const grid = panel.querySelector('.field-grid');
    for (const child of grid.children) child.hidden = true;
    if (kind === 'hosts') panel.querySelector('#hostsX').closest('.settings-section').hidden = true;
    const area = node('div', undefined, 'stage-management field-wide');
    area.dataset.management = kind;
    const title = node('div', undefined, 'stage-heading');
    title.append(node('strong', kind === 'hosts' ? '主持人管理' : '节目单'));
    const badge = node('span', '', 'stage-badge');
    const state = node('span', '', 'stage-state');
    title.append(badge, state);
    const status = node('div', '', 'stage-source');
    status.setAttribute('role', 'status');
    title.append(status);
    const top = node('div', undefined, 'stage-top');
    const slots = node('div', undefined, 'stage-slots');
    const current = node('div', undefined, 'stage-current');
    const next = node('div', undefined, 'stage-next');
    const quick = node('div', undefined, 'stage-quick');
    const add = button(kind === 'hosts' ? '+ 添加主持人' : '+ 添加节目', () => open(kind), `add-${kind}`, 'stage-add');
    const libraryHead = node('div', undefined, 'stage-section-head');
    const libraryCount = node('span', '', 'stage-section-count');
    libraryHead.append(node('strong', kind === 'hosts' ? '人物资料库' : '节目资料库'), libraryCount, add);
    const quickHead = node('div', undefined, 'stage-section-head');
    quickHead.append(node('strong', kind === 'hosts' ? '字幕条' : '快速切换'), node('span', kind === 'hosts' ? '点姓名换人，点「显示/隐藏」单条上下屏' : '单击切换 · 按住拖动排序', 'stage-section-note'));
    const list = node('div', undefined, 'stage-list');
    list.setAttribute('aria-label', kind === 'hosts' ? '主持人资料卡片' : '节目资料卡片');
    const hotkeys = node('div', undefined, 'stage-hotkeys');
    hotkeys.append(node('span', '热键', 'stage-hotkeys-label'));
    if (kind === 'hosts') hotkeys.append(kbd('0'), node('span', '整体显隐'), kbd('1'), node('span', '–'), kbd('4'), node('span', '单条显隐'));
    else hotkeys.append(kbd('←'), kbd('→'), node('span', '切节目'), kbd('0'), node('span', '显隐'));
    hotkeys.append(node('span', '点此框后生效', 'stage-hotkeys-hint'));
    hotkeys.tabIndex = 0;
    hotkeys.setAttribute('role','group');
    hotkeys.setAttribute('aria-label', kind === 'hosts' ? '主持人热键操作区' : '节目热键操作区');
    hotkeys.onkeydown = (event) => {
      if (event.target !== hotkeys || event.isComposing || event.repeat || event.ctrlKey || event.altKey || event.metaKey || !ready || request) return;
      const module = settings.modules[kind];
      if (event.key === '0') edit(kind, { visible:!module.visible });
      else if (kind === 'hosts' && /^[1-4]$/u.test(event.key)) {
        const index = Number(event.key) - 1;
        if (index >= module.slotCount) return;
        command(kind, { action:'slot', index, patch:{ hidden:!module.slots[index].hidden } });
      } else if (kind === 'program' && ['ArrowLeft','ArrowRight'].includes(event.key)) {
        command(kind, { action:'navigate', direction:event.key === 'ArrowLeft' ? -1 : 1 });
      } else return;
      event.preventDefault();
    };
    const now = node('div', undefined, 'stage-now');
    now.append(current, next);
    area.append(title, top, hotkeys, now, quickHead, quick, slots, libraryHead, list);
    grid.append(area);
    areas[kind] = { area, badge, state, status, top, slots, current, next, quick, list, libraryCount };
  }
  sortable(areas.program.list, { item:'.stage-record', handle:'.stage-drag-handle', threshold:3, grid:false });
  sortable(areas.program.quick, { item:'.stage-quick-cell', threshold:6, grid:true });
  const dragNote = node('span', undefined, 'stage-section-note');
  dragNote.append('按住 ', gripIcon('stage-grip-icon is-inline'), ' 拖动排序，编号自动更新');
  areas.program.libraryCount.after(dragNote);
  const hostPosition = node('div', undefined, 'stage-position');
  hostPosition.append(node('strong', '字幕条位置'));
  for (const [key, caption] of [['x','X 坐标（左边距）'],['bottom','Y 坐标（底边距）']]) {
    const label = node('label', caption);
    const input = node('input');
    input.className = 'text-input';
    input.type = 'number'; input.min = '0'; input.max = key === 'x' ? '1920' : '1080';
    input.dataset.position = key;
    input.setAttribute('aria-label', caption);
    input.oninput = () => {
      if (!ready || !Number.isFinite(input.valueAsNumber)) return;
      const hosts = settings.modules.hosts;
      edit('hosts', key === 'x' ? { x:input.valueAsNumber } : { y:1080 - 160 * hosts.scale - input.valueAsNumber });
    };
    label.append(input); hostPosition.append(label);
  }
  // ---------- 拖动排序（v19）：原生 Pointer Events，无依赖 ----------
  // list：只从左侧六点手柄起拖；quick：整个格子可拖，但移动超过阈值才算拖动，单击照常切换节目。
  let drag;
  function canReorder() {
    return ready && !request && !editors.has('program') && (settings?.modules.program.items?.length ?? 0) > 1;
  }
  function sendOrder(ids) {
    const current = (settings.modules.program.items ?? []).map((item) => item.id);
    if (ids.length !== current.length || ids.every((id, i) => id === current[i])) return false;
    command('program', { action:'reorder', order:ids });
    return true;
  }
  function scrollParent(element) {
    for (let el = element.parentElement; el; el = el.parentElement) {
      const { overflowY } = getComputedStyle(el);
      if (/(auto|scroll)/u.test(overflowY) && el.scrollHeight > el.clientHeight) return el;
    }
    return document.scrollingElement;
  }
  function sortable(container, { item, handle, threshold, grid }) {
    container.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || drag || !canReorder()) return;
      const source = event.target.closest(item);
      if (!source || !container.contains(source) || (handle && !event.target.closest(handle))) return;
      if (handle) event.preventDefault();
      drag = { container, source, grid, threshold, item, pointer:event.pointerId, x:event.clientX, y:event.clientY, active:false };
    });
    container.addEventListener('pointermove', (event) => {
      if (!drag || drag.container !== container || event.pointerId !== drag.pointer) return;
      drag.lastX = event.clientX; drag.lastY = event.clientY;
      if (!drag.active) {
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < drag.threshold) return;
        startDrag(event);
      }
      moveDrag(event.clientX, event.clientY);
    });
    container.addEventListener('pointerup', (event) => {
      if (!drag || drag.container !== container || event.pointerId !== drag.pointer) return;
      if (!drag.active) { drag = undefined; return; }
      finishDrag(true);
    });
    container.addEventListener('pointercancel', () => drag?.container === container && finishDrag(false));
    container.addEventListener('lostpointercapture', () => drag?.container === container && drag.active && finishDrag(true));
    // 拖动结束后浏览器还会补发一次 click，吞掉它，避免误切节目。
    container.addEventListener('click', (event) => {
      if (container.dataset.suppressClick) { event.stopPropagation(); event.preventDefault(); delete container.dataset.suppressClick; }
    }, true);
  }
  function startDrag(event) {
    drag.active = true;
    drag.container.setPointerCapture(drag.pointer);
    drag.items = [...drag.container.querySelectorAll(':scope > ' + drag.item)];
    drag.from = drag.items.indexOf(drag.source);
    drag.source.classList.add('is-drag-source');
    drag.container.classList.add('is-sorting');
    document.documentElement.classList.add('is-stage-dragging');
    drag.line = node('div', undefined, 'stage-drop-line' + (drag.grid ? ' is-vertical' : ''));
    drag.line.setAttribute('aria-hidden', 'true');
    drag.container.append(drag.line);
    const title = drag.source.querySelector('h4, .stage-quick-title')?.textContent ?? '';
    const number = drag.source.querySelector('.stage-number')?.textContent ?? '';
    drag.ghost = node('div', undefined, 'stage-drag-ghost');
    drag.ghost.append(node('span', number, 'stage-number'), node('strong', title));
    drag.ghost.setAttribute('aria-hidden', 'true');
    document.body.append(drag.ghost);
    drag.scroller = scrollParent(drag.container);
    const tick = () => {
      if (!drag?.active) return;
      const box = drag.scroller === document.scrollingElement ? { top:0, bottom:innerHeight } : drag.scroller.getBoundingClientRect();
      const edge = 48;
      const speed = drag.lastY < box.top + edge ? -(box.top + edge - drag.lastY) : drag.lastY > box.bottom - edge ? drag.lastY - (box.bottom - edge) : 0;
      if (speed) { drag.scroller.scrollTop += Math.max(-18, Math.min(18, speed / 2)); moveDrag(drag.lastX, drag.lastY); }
      drag.frame = requestAnimationFrame(tick);
    };
    drag.frame = requestAnimationFrame(tick);
  }
  function moveDrag(x, y) {
    drag.ghost.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y + 10)}px)`;
    const host = drag.container.getBoundingClientRect();
    const rects = drag.items.map((el) => el.getBoundingClientRect());
    let to;
    if (drag.grid) {
      // 网格：找最近的格子，按其左右半边决定插在前还是后。
      let best = 0, bestDistance = Infinity;
      rects.forEach((r, i) => {
        const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
        const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
        const d = dy * 4 + dx;
        if (d < bestDistance) { bestDistance = d; best = i; }
      });
      const r = rects[best];
      to = x < r.left + r.width / 2 ? best : best + 1;
      const gap = parseFloat(getComputedStyle(drag.container).columnGap) || 6;
      const left = to === best ? r.left - gap / 2 : r.right + gap / 2;
      Object.assign(drag.line.style, { left:`${left - host.left - 1}px`, top:`${r.top - host.top}px`, height:`${r.height}px`, width:'' });
    } else {
      to = rects.findIndex((r) => y < r.top + r.height / 2);
      if (to < 0) to = rects.length;
      const gap = parseFloat(getComputedStyle(drag.container).rowGap) || 8;
      const edgeY = to < rects.length ? rects[to].top - gap / 2 : rects.at(-1).bottom + gap / 2;
      Object.assign(drag.line.style, { top:`${Math.max(0, Math.min(host.height - 2, edgeY - host.top - 1))}px`, left:`${rects[0].left - host.left}px`, width:`${rects[0].width}px`, height:'' });
    }
    drag.to = to;
    // 落回原位时不显示指示线。
    drag.line.hidden = to === drag.from || to === drag.from + 1;
  }
  function finishDrag(commit) {
    const state = drag;
    drag = undefined;
    cancelAnimationFrame(state.frame);
    state.source.classList.remove('is-drag-source');
    state.container.classList.remove('is-sorting');
    document.documentElement.classList.remove('is-stage-dragging');
    state.line?.remove(); state.ghost?.remove();
    if (state.container.hasPointerCapture?.(state.pointer)) state.container.releasePointerCapture(state.pointer);
    state.container.dataset.suppressClick = 'true';
    setTimeout(() => delete state.container.dataset.suppressClick, 0);
    if (!commit || state.to === undefined || state.to === state.from || state.to === state.from + 1) return;
    const ids = state.items.map((el) => el.dataset.recordId);
    const [moved] = ids.splice(state.from, 1);
    ids.splice(state.to > state.from ? state.to - 1 : state.to, 0, moved);
    if (!sendOrder(ids)) return;
    // 乐观更新：先在本地挪好，服务器回传后整表重绘确认。
    state.container.insertBefore(state.source, state.items[state.to] ?? null);
    // 编号同步按新顺序显示（与后端重排规则一致），避免等服务器回传时闪一下旧编号。
    const width = Math.max(2, String(ids.length).length);
    for (const holder of [areas.program.list, areas.program.quick]) {
      for (const el of holder.querySelectorAll('[data-record-id]')) {
        const at = ids.indexOf(el.dataset.recordId);
        const label = el.querySelector('.stage-number');
        if (at >= 0 && label) label.textContent = String(at + 1).padStart(width, '0');
      }
    }
  }
  function cancelDrag() {
    if (drag?.active) finishDrag(false);
    drag = undefined;
  }
  function moveByKey(id, delta) {
    if (!canReorder()) return;
    const ids = (settings.modules.program.items ?? []).map((item) => item.id);
    const from = ids.indexOf(id), to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    pendingFocus = `drag-${id}`;
    sendOrder(ids);
  }
  let pendingFocus;
  function command(kind, payload) {
    if (!ready || request) return;
    request = `management-${crypto.randomUUID()}`;
    savingKind = payload.action === 'save' ? kind : null;
    reordering = payload.action === 'reorder';
    send({ type:`${kind}:manage`, id:request, payload });
    refreshEnabled();
  }
  let sourceStatusSince = 0;
  let sourceStatusTimer;
  function refreshEnabled() {
    clearTimeout(sourceStatusTimer);
    if (request && !sourceStatusSince) sourceStatusSince = performance.now();
    const settling = ready && !request && sourceStatusSince && performance.now() - sourceStatusSince < 250;
    if (settling) sourceStatusTimer = setTimeout(refreshEnabled, 250 - (performance.now() - sourceStatusSince));
    else if (!request) sourceStatusSince = 0;
    for (const [kind, { area, status }] of Object.entries(areas)) {
      area.classList.toggle('is-pending', Boolean(request));
      area.setAttribute('aria-busy', String(Boolean(request)));
      area.querySelectorAll('button,input,textarea,select').forEach((input) => {
        // A round trip must not dim every programme button. Commands are
        // guarded while pending; only draft fields need a temporary lock.
        input.disabled = !ready || input.dataset.unavailable === 'true' || (Boolean(request) && Boolean(input.closest('form')));
      });
      status.textContent = !ready ? '连接断开 · 草稿已保留' : (request || settling) ? '正在保存…' : 'settings.json · 已连接';
      status.classList.toggle('is-offline', !ready);
    }
  }
  function navigation(kind, item, index, total, slotIndex) {
    const nav = node('div', undefined, 'stage-nav');
    const payload = (direction) => ({ action:'navigate', direction, ...(kind === 'hosts' && { index:slotIndex }) });
    const previous = limited(button('◀', () => command(kind, payload(-1)), kind === 'hosts' ? `previous-${slotIndex}` : 'program-previous', 'stage-nav-button'), index <= 0);
    const following = limited(button('▶', () => command(kind, payload(1)), kind === 'hosts' ? `next-${slotIndex}` : 'program-next', 'stage-nav-button'), index >= total - 1);
    previous.setAttribute('aria-label', kind === 'hosts' ? `字幕条 ${slotIndex + 1} 上一人` : '上一节目');
    following.setAttribute('aria-label', kind === 'hosts' ? `字幕条 ${slotIndex + 1} 下一人` : '下一节目');
    const info = node('div', undefined, 'stage-nav-info');
    info.append(node('span', item ? item.number || String(index + 1) : '—', 'stage-number'),
      node('strong', item ? kind === 'hosts' ? item.name : item.title : '暂无资料', 'stage-nav-title'),
      node('span', item ? kind === 'hosts' ? item.title : [item.type,item.performer].filter(Boolean).join(' · ') : '', 'stage-nav-meta'));
    if (kind === 'program') info.prepend(node('small', '当前节目', 'stage-now-label'));
    nav.append(previous, info, following);
    return nav;
  }
  const quickCache = new Map();
  function quickCell(item, index, selected, action, key, kind, upcoming = false) {
    const signature = JSON.stringify([item, index]);
    const old = kind === 'program' && quickCache.get(item.id);
    if (old?.signature === signature) {
      old.cell.setAttribute('aria-pressed', String(selected));
      old.cell.dataset.next = String(upcoming);
      return old.cell;
    }
    const cell = button('', action, key, 'stage-quick-cell');
    cell.setAttribute('aria-pressed', String(selected));
    if (upcoming) cell.dataset.next = 'true';
    cell.append(node('span', item.number || String(index + 1).padStart(2,'0'), 'stage-number'),
      node('strong', kind === 'hosts' ? item.name : item.title, 'stage-quick-title'));
    if (kind === 'program' && item.type) cell.append(node('small', item.type, 'stage-quick-type'));
    if (kind === 'program') { quickCache.set(item.id, { signature, cell }); cell.dataset.recordId = item.id; cell.title = '单击切换 · 按住拖动调整顺序'; }
    return cell;
  }
  function renderHostSlots(hosts) {
    const people = hosts.people ?? [];
    areas.hosts.slots.replaceChildren(...(hosts.slots ?? []).map((slot, index) => {
      const card = node('div', undefined, 'stage-slot');
      card.dataset.slot = index;
      card.style.setProperty('--slot-color', slot.accentColor);
      const inactive = index >= hosts.slotCount;
      card.classList.toggle('is-inactive', inactive);
      // 状态：画面中（整体显示且本条显示）/ 待上屏（本条显示但整体隐藏）/ 已隐藏 / 未启用
      const state = inactive ? 'off' : slot.hidden || !slot.personId ? 'hidden' : hosts.visible ? 'live' : 'cued';
      card.dataset.state = state;
      const head = node('div', undefined, 'stage-slot-head');
      const name = node('div', undefined, 'stage-slot-name');
      name.append(node('strong', `字幕条 ${index + 1}`), node('span', { live:'画面中', cued:'待上屏', hidden:'已隐藏', off:'未启用' }[state], 'stage-slot-state'));
      const toggle = limited(button(slot.hidden ? '显示' : '隐藏', () => command('hosts', { action:'slot', index, patch:{ hidden:!slot.hidden } }), `visible-${index}`, slot.hidden ? 'is-hidden' : 'is-live'), inactive || !slot.personId);
      toggle.append(kbd(String(index + 1)));
      toggle.setAttribute('aria-label', `${slot.hidden ? '显示' : '隐藏'}字幕条 ${index + 1}`);
      head.append(name, toggle);
      const at = people.findIndex((p) => p.id === slot.personId);
      const nav = navigation('hosts', people[at], at, people.length, index);
      const quick = node('div', undefined, 'stage-slot-quick');
      people.forEach((person, i) => quick.append(quickCell(person, i, person.id === slot.personId,
        () => command('hosts', { action:'slot', index, patch:{ personId:person.id } }), `person-${index}-${person.id}`, 'hosts')));
      const appearance = node('details', undefined, 'stage-slot-appearance');
      appearance.append(node('summary', '自定义颜色'));
      const styles = node('div', undefined, 'stage-style-row');
      styles.setAttribute('role', 'group');
      styles.setAttribute('aria-label', `字幕条 ${index + 1} 样式`);
      for (const [id, name] of [['h','烟洲新闻'],['g','烟洲校色'],['i','烟洲印记']]) {
        const b = button(name, () => command('hosts', { action:'slot', index, patch:{ style:id } }), `style-${index}-${id}`);
        b.setAttribute('aria-pressed', String(slot.style === id));
        styles.append(b);
      }
      for (const [key, label] of [['accentColor','标签色'],['textColor','姓名色']]) {
        const l = node('label', label);
        const input = node('input');
        input.type = 'color'; input.value = slot[key];
        input.dataset.focusKey = `${key}-${index}`;
        input.setAttribute('aria-label', `字幕条 ${index + 1} ${label}`);
        input.onchange = () => command('hosts', { action:'slot', index, patch:{ [key]:input.value, customColors:true } });
        l.append(input); appearance.append(l);
      }
      card.append(head, nav, quick, styles, appearance);
      if (inactive) card.querySelectorAll('button,input').forEach((control) => control.dataset.unavailable = 'true');
      return card;
    }));
  }
  const libraryCache = { hosts: new Map(), program: new Map() };
  function renderLibraries(kind) {
    const module = settings.modules[kind];
    const records = kind === 'hosts' ? module.people ?? [] : module.items ?? [];
    const editor = editors.get(kind);
    const items = editor?.isNew ? [...records, editor.item] : records;
    const cards = items.map((item, index) => {
      const key = JSON.stringify([item, index, editor?.item.id === item.id, Boolean(editor)]);
      const cached = libraryCache[kind].get(item.id);
      if (cached?.key === key) return cached.card;
      const card = node('article', undefined, 'stage-record');
      card.dataset.recordId = item.id;
      card.classList.toggle('is-current', item.id === module.selectedId);
      if (kind === 'program') {
        const grip = limited(button('', () => {}, `drag-${item.id}`, 'stage-drag-handle'), Boolean(editor) || records.length < 2);
        grip.append(gripIcon());
        grip.setAttribute('aria-label', `拖动调整「${item.title}」的顺序，也可按 ↑ ↓ 移动`);
        grip.title = '拖动调整顺序（↑ ↓ 也可移动）';
        grip.onkeydown = (event) => {
          if (!['ArrowUp','ArrowDown'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
          event.preventDefault();
          moveByKey(item.id, event.key === 'ArrowUp' ? -1 : 1);
        };
        card.append(grip);
      }
      const head = node('div', undefined, 'stage-record-head');
      head.append(node('span', kind === 'hosts' ? String(index + 1).padStart(2,'0') : item.number || String(index + 1).padStart(2,'0'), 'stage-number'));
      const heading = node('div', undefined, 'stage-record-title');
      heading.append(node('h4', kind === 'hosts' ? item.name : item.title));
      if (kind === 'program' && item.type) heading.append(node('span', item.type, 'stage-type'));
      card.append(head, heading);
      const meta = kind === 'hosts' ? item.title : item.performer;
      if (meta) {
        const line = node('p', undefined, 'stage-record-meta');
        line.append(node('span', kind === 'hosts' ? '身份：' : '演出：'), document.createTextNode(meta));
        card.append(line);
      }
      const desc = kind === 'hosts' ? item.bio : item.desc;
      if (desc) card.append(node('p', desc, 'stage-record-desc'));
      if (editor?.item.id === item.id) {
        card.classList.add('is-editing');
        card.append(editor.form);
      } else {
        const actions = node('div', undefined, 'stage-actions');
        actions.append(button('编辑', () => open(kind, item), `edit-${item.id}`, 'stage-edit'),
          button('删除', () => {
            if (confirm(`删除「${kind === 'hosts' ? item.name : item.title}」？`)) command(kind, { action:'delete', id:item.id });
          }, `delete-${item.id}`, 'stage-delete'));
        if (kind === 'program') {
          const badge = node('span', '当前节目', 'stage-current-badge');
          badge.hidden = item.id !== module.selectedId; actions.append(badge);
        }
        card.append(actions);
      }
      libraryCache[kind].set(item.id, { key, card });
      return card;
    });
    for (const id of libraryCache[kind].keys()) if (!items.some((item) => item.id === id)) libraryCache[kind].delete(id);
    cards.forEach((card, index) => {
      const selected = items[index].id === module.selectedId;
      card.classList.toggle('is-current', selected);
      const badge = card.querySelector('.stage-current-badge');
      if (badge) badge.hidden = !selected;
    });
    const list = areas[kind].list;
    // Keep unchanged cards attached, preserving focus and CSS transitions.
    [...list.children].filter((child) => !cards.includes(child)).forEach((child) => child.remove());
    cards.forEach((card, index) => { if (list.children[index] !== card) list.insertBefore(card, list.children[index] ?? null); });
    if (!items.length) areas[kind].list.append(node('p', '暂无资料，请添加。'));
  }
  function open(kind, item) {
    if (editors.has(kind)) {
      const current = editors.get(kind);
      areas[kind].list.querySelector(`[data-record-id="${CSS.escape(current.item.id)}"]`)?.scrollIntoView({ block:'nearest', behavior:'smooth' });
      return;
    }
    const isNew = !item;
    item = item ?? (kind === 'hosts' ? { id:crypto.randomUUID(), name:'新主持人', title:'', bio:'' } :
      { id:crypto.randomUUID(), number:'', type:'舞蹈', title:'新节目', performer:'', desc:'', cover:'' });
    const form = node('form', undefined, 'stage-inline-editor');
    const fields = node('div', undefined, 'stage-editor-fields');
    const definitions = kind === 'hosts' ? [['name','姓名',80],['title','身份／头衔',120],['bio','简介',1000]] :
      [['number','序号',40],['type','类型',80],['title','标题',80],['performer','演出者',1000],['desc','描述',2000]];
    for (const [name, label, max] of definitions) {
      const l = node('label', label);
      const input = node(['bio','desc'].includes(name) ? 'textarea' : 'input');
      input.name = name; input.maxLength = max; input.value = item[name] ?? '';
      input.className = 'text-input';
      input.required = name === (kind === 'hosts' ? 'name' : 'title');
      input.dataset.focusKey = `edit-${kind}-${item.id}-${name}`;
      l.append(input); fields.append(l);
    }
    const message = node('p', '', 'stage-editor-status');
    message.setAttribute('role','status');
    const actions = node('div', undefined, 'stage-actions');
    const save = node('button', '保存', 'button stage-save'); save.type = 'submit';
    const cancel = button('取消', () => {
      editors.delete(kind); renderLibraries(kind); refreshEnabled();
    }, 'cancel-' + kind);
    actions.append(save,cancel); form.append(fields,message,actions);
    form.onsubmit = (event) => {
      event.preventDefault();
      const record = { ...item };
      for (const input of fields.querySelectorAll('[name]')) record[input.name] = input.value;
      command(kind, { action:'save', item:record });
    };
    editors.set(kind, { item, form, message, isNew });
    renderLibraries(kind); refreshEnabled();
    const first = fields.querySelector('input');
    first.focus({ preventScroll:true });
    form.scrollIntoView({ block:'nearest', behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  function render(nextSettings, connected) {
    settings = nextSettings; ready = connected;
    const hosts = settings.modules.hosts;
    const program = settings.modules.program;
    const signature = JSON.stringify([hosts.people,hosts.slots,hosts.slotCount,hosts.visible,program.items,program.selectedId,program.visible]);
    if (signature !== last) {
      last = signature;
      cancelDrag();
      const focused = document.activeElement?.dataset.focusKey;
      const people = hosts.people ?? [];
      const items = program.items ?? [];
      areas.hosts.badge.textContent = `${people.length} 位`;
      areas.program.badge.textContent = `${items.length} 个节目`;
      areas.hosts.libraryCount.textContent = `${people.length}`;
      areas.program.libraryCount.textContent = `${items.length}`;
      for (const kind of ['hosts','program']) {
        const on = settings.modules[kind].visible;
        areas[kind].state.textContent = on ? '画面中' : '未显示';
        areas[kind].state.classList.toggle('is-live', on);
        areas[kind].area.dataset.live = String(on);
      }
      areas.hosts.top.replaceChildren();
      const count = node('div', undefined, 'stage-count');
      count.append(node('span', '显示数量'));
      const numbers = node('div', undefined, 'stage-count-buttons');
      for (let n = 1; n <= 4; n++) {
        const b = button(`${n} 位`, () => edit('hosts', { slotCount:n }), `count-${n}`);
        b.setAttribute('aria-pressed', String(hosts.slotCount === n)); numbers.append(b);
      }
      count.append(numbers);
      areas.hosts.top.append(count,hostPosition);
      for (const kind of ['hosts','program']) {
        const module = settings.modules[kind];
        const visible = module.visible;
        const toggle = button(visible ? kind === 'hosts' ? '隐藏全部' : '隐藏节目单' : kind === 'hosts' ? '显示全部' : '显示节目单',
          () => edit(kind,{ visible:!visible }), 'toggle-' + kind, 'stage-toggle' + (visible ? ' is-live' : ''));
        toggle.append(kbd('0'));
        if (kind === 'hosts') areas[kind].top.prepend(toggle);
        else areas[kind].top.replaceChildren(toggle);
      }
      renderHostSlots(hosts);
      const index = items.findIndex((p) => p.id === program.selectedId);
      const previousProgram = areas.program.current.dataset.content;
      const currentContent = JSON.stringify([items[index], items[index + 1]]);
      areas.program.current.dataset.content = currentContent;
      areas.program.current.replaceChildren(navigation('program', items[index], index, items.length));
      const nextItem = items[index + 1];
      areas.program.next.replaceChildren(node('small','下一个节目'),
        node('strong',nextItem?.title ?? '没有下一个节目了'),
        node('span', nextItem ? [nextItem.number,nextItem.type,nextItem.performer].filter(Boolean).join(' · ') : '已到达最后一个节目'));
      const quickCards = items.map((item,i) => quickCell(item,i,item.id===program.selectedId,
        ()=>command('program',{ action:'select', id:item.id }), `select-${item.id}`,'program', i === index + 1));
      for (const [id, entry] of quickCache) if (!quickCards.includes(entry.cell)) { entry.cell.remove(); quickCache.delete(id); }
      [...areas.program.quick.children].filter((cell) => !quickCards.includes(cell)).forEach((cell) => cell.remove());
      quickCards.forEach((cell,i) => { if (areas.program.quick.children[i] !== cell) areas.program.quick.insertBefore(cell, areas.program.quick.children[i] ?? null); });
      if (previousProgram && previousProgram !== currentContent && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        for (const region of [areas.program.current, areas.program.next]) {
          region.getAnimations().forEach((a) => a.cancel());
          region.animate([{ transform:'translateY(3px)' }, { transform:'none' }], { duration:180, easing:'ease-out' });
        }
      }
      renderLibraries('hosts'); renderLibraries('program');
      const refocus = pendingFocus ?? focused;
      pendingFocus = undefined;
      if (refocus) document.querySelector(`[data-focus-key="${CSS.escape(refocus)}"]`)?.focus({ preventScroll:true });
    }
    for (const input of hostPosition.querySelectorAll('input')) {
      if (document.activeElement !== input) input.value = Math.round(input.dataset.position === 'x' ? hosts.x : 1080 - 160 * hosts.scale - hosts.y);
    }
    refreshEnabled();
  }
  return {
    render,
    navigateProgram: () => command('program',{ action:'navigate', direction:1 }),
    disconnected() {
      request = undefined; ready = false; savingKind = null; refreshEnabled();
      for (const { message } of editors.values()) message.textContent = '连接中断，草稿已保留。';
    },
    result(message) {
      if (!request || message.id !== request) return false;
      request = undefined;
      if (message.type === 'error') {
        editors.get(savingKind)?.message.replaceChildren(document.createTextNode(message.message));
        toast(message.message);
        // 排序失败：本地已乐观挪动，按服务器状态重绘还原。
        if (reordering) { last = undefined; render(settings, ready); }
      } else if (savingKind) {
        editors.delete(savingKind); renderLibraries(savingKind);
      }
      savingKind = null; reordering = false;
      refreshEnabled(); return true;
    },
  };
}
