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
/** 一条资料修改还在写盘时，切节目的操作先排上，不要丢掉。
 *  直接点某个节目会清掉前面排着的上一项 / 下一项；其它操作不进这个队列。 */
export function queueManagement(queue, command, limit = 30) {
  const action = command?.payload?.action;
  if (action === 'select') return [command];
  if (action === 'navigate' && queue.length < limit) return [...queue, command];
  return queue;
}
export function hasVisibleHosts(hosts) {
  return Boolean(hosts.visible && hosts.slots?.some((slot, index) =>
    index < hosts.slotCount && !slot.hidden && hosts.people?.some(({ id }) => id === slot.personId)));
}
export function bindStageControls({ send, edit, toast }) {
  let settings;
  let ready = false;
  let request;
  let last;
  let savingKind;
  let sortingEnabled = false;
  let pendingMove;
  let undoMove;
  let pickerSlot = null;
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
    const top = kind === 'hosts' ? node('div', undefined, 'stage-top') : null;
    const slots = node('div', undefined, 'stage-slots');
    const current = node('div', undefined, 'stage-current');
    const next = node('div', undefined, 'stage-next');
    const quick = node('div', undefined, 'stage-quick');
    const add = button(kind === 'hosts' ? '+ 添加主持人' : '+ 添加节目', () => open(kind), `add-${kind}`, 'stage-add');
    add.onclick = (event) => { event.preventDefault(); open(kind); };
    const library = node('details', undefined, 'stage-library');
    const libraryHead = node('summary', undefined, 'stage-section-head');
    const libraryCount = node('span', '', 'stage-section-count');
    libraryHead.append(node('strong', kind === 'hosts' ? '人物资料库' : '节目资料库'), libraryCount, add);
    const quickHead = node('div', undefined, 'stage-section-head');
    quickHead.append(node('strong', kind === 'hosts' ? '上屏名单' : '快速切换'));
    const list = node('div', undefined, 'stage-list');
    list.setAttribute('aria-label', kind === 'hosts' ? '主持人资料卡片' : '节目资料卡片');
    library.append(libraryHead, list);
    const hotkeys = node('div', undefined, 'stage-hotkeys');
    hotkeys.append(node('span', '热键', 'stage-hotkeys-label'));
    if (kind === 'hosts') hotkeys.append(kbd('0'), node('span', '整体显隐'));
    else hotkeys.append(kbd('←'), kbd('→'), node('span', '切节目'), kbd('0'), node('span', '显隐'));
    hotkeys.append(node('span', '点此框后生效', 'stage-hotkeys-hint'));
    hotkeys.tabIndex = 0;
    hotkeys.setAttribute('role','group');
    hotkeys.setAttribute('aria-label', kind === 'hosts' ? '主持人热键操作区' : '节目热键操作区');
    hotkeys.onkeydown = (event) => {
      if (event.target !== hotkeys || event.isComposing || event.repeat || event.ctrlKey || event.altKey || event.metaKey || !ready) return;
      const module = settings.modules[kind];
      if (event.key === '0') edit(kind, { visible:!module.visible });
      /* 单条显隐热键 1–4 已停用（画面只显示一位）：
      else if (kind === 'hosts' && /^[1-4]$/u.test(event.key)) {
        const index = Number(event.key) - 1;
        if (index >= module.slotCount) return;
        command(kind, { action:'slot', index, patch:{ hidden:!module.slots[index].hidden } });
      }
      */ else if (kind === 'program' && ['ArrowLeft','ArrowRight'].includes(event.key)) {
        command(kind, { action:'navigate', direction:event.key === 'ArrowLeft' ? -1 : 1 });
      } else return;
      event.preventDefault();
    };
    const now = node('div', undefined, 'stage-now');
    now.append(current, next);
    area.append(title);
    if (top) area.append(top);
    area.append(hotkeys, now, quickHead, quick, slots, library);
    grid.append(area);
    areas[kind] = { area, badge, state, status, top, slots, current, next, quick, library, list, libraryCount };
  }
  sortable(areas.program.list);
  const sortTools = node('div', undefined, 'stage-sort-tools');
  const sortLock = button('解锁排序', () => {
    sortingEnabled = !sortingEnabled;
    cancelDrag();
    refreshEnabled();
  }, 'sort-lock');
  const sortUndo = button('撤销排序', () => {
    if (canUndo()) sendMove(undoMove.to, undoMove.from, true);
  }, 'sort-undo');
  const sortStatus = node('span', '', 'stage-section-note');
  sortStatus.setAttribute('role', 'status');
  sortTools.append(sortLock, sortUndo, sortStatus);
  areas.program.list.before(sortTools);

  const personPicker = node('dialog', undefined, 'stage-person-picker');
  const pickerTitle = node('h2', '选择人物');
  pickerTitle.id = 'stage-person-picker-title';
  personPicker.setAttribute('aria-labelledby', pickerTitle.id);
  const pickerHead = node('div', undefined, 'stage-person-picker-head');
  pickerHead.append(pickerTitle, button('关闭', () => personPicker.close()));
  const pickerSearch = node('input', undefined, 'text-input');
  pickerSearch.type = 'search';
  pickerSearch.id = 'stage-person-search';
  pickerSearch.placeholder = '姓名或班级';
  const searchLabel = node('label', '搜索人物');
  searchLabel.htmlFor = pickerSearch.id;
  const pickerResults = node('div', undefined, 'stage-person-results');
  pickerResults.setAttribute('role', 'group');
  pickerResults.setAttribute('aria-label', '搜索结果');
  const pickerStatus = node('p', '', 'stage-person-status');
  pickerStatus.setAttribute('role', 'status');
  personPicker.append(pickerHead, searchLabel, pickerSearch, pickerStatus, pickerResults);
  document.body.append(personPicker);
  pickerSearch.addEventListener('input', renderPersonPicker);
  personPicker.addEventListener('close', () => {
    areas.hosts.slots.querySelector(`[data-focus-key="pick-person-${pickerSlot}"]`)?.focus({ preventScroll:true });
    pickerSlot = null;
  });
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
  let drag;
  const programOrder = () => settings?.modules.program.items?.map(({ id }) => id) ?? [];
  const sameOrder = (first, second) => first.length === second.length && first.every((id, i) => id === second[i]);
  function canReorder() {
    return sortingEnabled && ready && !request && !editors.has('program') && programOrder().length > 1;
  }
  function canUndo() {
    return Boolean(undoMove && canReorder() && sameOrder(undoMove.after, programOrder()));
  }
  function sendMove(from, to, undo = false) {
    if (!canReorder()) return;
    const before = programOrder();
    if (from < 0 || to < 0 || from === to || from >= before.length || to >= before.length) return;
    const after = [...before];
    const [id] = after.splice(from, 1);
    after.splice(to, 0, id);
    pendingMove = { from, to, after, undo };
    if (command('program', { action:'reorder', order:before, move:{ id, to } })) paintOrder(after);
    else pendingMove = undefined;
  }
  // 资料库和快速切换是两份列表。拖完只改其中一份时，另一份会变成「新编号贴在旧行上」。
  function paintOrder(ids) {
    const width = Math.max(2, String(ids.length).length);
    const selectedAt = ids.indexOf(settings.modules.program.selectedId);
    for (const holder of [areas.program.list, areas.program.quick]) {
      const byId = new Map([...holder.querySelectorAll(':scope > [data-record-id]')].map((el) => [el.dataset.recordId, el]));
      ids.forEach((id, index) => {
        const el = byId.get(id);
        if (!el) return;
        holder.append(el);
        const label = el.querySelector('.stage-number');
        if (label) label.textContent = String(index + 1).padStart(width, '0');
        if (!el.classList.contains('stage-quick-cell')) return;
        el.setAttribute('aria-pressed', String(id === settings.modules.program.selectedId));
        if (index === selectedAt + 1) el.dataset.next = 'true';
        else delete el.dataset.next;
      });
    }
  }
  function scrollParent(element) {
    for (let el = element.parentElement; el; el = el.parentElement) {
      const { overflowY } = getComputedStyle(el);
      if (/(auto|scroll)/u.test(overflowY) && el.scrollHeight > el.clientHeight) return el;
    }
    return document.scrollingElement;
  }
  function sortable(container) {
    container.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || drag || !canReorder()) return;
      const handle = event.target.closest('.stage-drag-handle');
      const source = handle?.closest('.stage-record');
      if (!source || !container.contains(source)) return;
      drag = { container, source, pointer:event.pointerId, x:event.clientX, y:event.clientY, active:false };
      container.setPointerCapture(event.pointerId);
    });
    container.addEventListener('pointermove', (event) => {
      if (!drag || drag.container !== container || event.pointerId !== drag.pointer) return;
      drag.lastX = event.clientX; drag.lastY = event.clientY;
      if (!drag.active) {
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 3) return;
        startDrag();
      }
      moveDrag(event.clientX, event.clientY);
    });
    container.addEventListener('pointerup', (event) => {
      if (!drag || drag.container !== container || event.pointerId !== drag.pointer) return;
      if (!drag.active) { drag = undefined; return; }
      finishDrag(true);
    });
    container.addEventListener('pointercancel', cancelDrag);
    container.addEventListener('lostpointercapture', cancelDrag);
    // 吞掉拖动结束后补发的点击，避免折叠资料卡。
    container.addEventListener('click', (event) => {
      if (container.dataset.suppressClick) { event.stopPropagation(); event.preventDefault(); delete container.dataset.suppressClick; }
    }, true);
  }
  function startDrag() {
    drag.active = true;
    drag.items = [...drag.container.querySelectorAll(':scope > .stage-record')];
    drag.from = drag.items.indexOf(drag.source);
    drag.source.classList.add('is-drag-source');
    drag.container.classList.add('is-sorting');
    document.documentElement.classList.add('is-stage-dragging');
    drag.line = node('div', undefined, 'stage-drop-line');
    drag.line.setAttribute('aria-hidden', 'true');
    drag.container.append(drag.line);
    const title = drag.source.querySelector('h4')?.textContent ?? '';
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
    let to = rects.findIndex((r) => y < r.top + r.height / 2);
    if (to < 0) to = rects.length;
    const edgeY = to < rects.length ? rects[to].top : rects.at(-1).bottom;
    Object.assign(drag.line.style, { top:`${Math.max(0, Math.min(host.height - 2, edgeY - host.top - 1))}px`, left:`${rects[0].left - host.left}px`, width:`${rects[0].width}px` });
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
    sendMove(state.from, state.to > state.from ? state.to - 1 : state.to);
  }
  function cancelDrag() {
    if (!drag) return;
    if (drag.active) { finishDrag(false); return; }
    const { container, pointer } = drag;
    drag = undefined;
    if (container.hasPointerCapture(pointer)) container.releasePointerCapture(pointer);
  }
  function moveByKey(id, delta) {
    if (!canReorder()) return;
    const ids = programOrder();
    const from = ids.indexOf(id), to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    pendingFocus = `drag-${id}`;
    sendMove(from, to);
  }
  let pendingFocus;
  let followUps = [];
  function beginCommand(kind, payload) {
    request = `management-${crypto.randomUUID()}`;
    savingKind = payload.action === 'save' ? kind : null;
    send({ type:`${kind}:manage`, id:request, payload });
    refreshEnabled();
  }
  function command(kind, payload) {
    if (!ready) return false;
    if (request) {
      const queued = queueManagement(followUps, { kind, payload });
      if (queued === followUps) return false;
      followUps = queued;
      return true;
    }
    beginCommand(kind, payload);
    return true;
  }
  let sourceStatusSince = 0;
  let sourceStatusTimer;
  function refreshEnabled() {
    clearTimeout(sourceStatusTimer);
    if (request && !sourceStatusSince) sourceStatusSince = performance.now();
    const settling = ready && !request && sourceStatusSince && performance.now() - sourceStatusSince < 250;
    if (settling) sourceStatusTimer = setTimeout(refreshEnabled, 250 - (performance.now() - sourceStatusSince));
    else if (!request) sourceStatusSince = 0;
    areas.program.area.dataset.sortEnabled = String(sortingEnabled);
    sortLock.textContent = sortingEnabled ? '锁定排序' : '解锁排序';
    sortLock.dataset.unavailable = String(Boolean(request) || editors.has('program') || programOrder().length < 2);
    sortUndo.dataset.unavailable = String(!canUndo());
    const orderStatus = sortingEnabled ? '拖动手柄或按 ↑ / ↓ 排序' : '排序已锁定';
    if (sortStatus.textContent !== orderStatus) sortStatus.textContent = orderStatus;
    if (personPicker.open) pickerResults.querySelectorAll('button').forEach((input) => { input.disabled = !ready || Boolean(request); });
    for (const [kind, { area, status }] of Object.entries(areas)) {
      area.classList.toggle('is-pending', Boolean(request));
      area.setAttribute('aria-busy', String(Boolean(request)));
      area.querySelectorAll('button,input,textarea,select').forEach((input) => {
        // A round trip must not dim every programme button. Commands are
        // guarded while pending; only draft fields need a temporary lock.
        input.disabled = !ready || input.dataset.unavailable === 'true' ||
          (Boolean(request) && Boolean(input.closest('form') || input.matches('.stage-drag-handle')));
      });
      status.textContent = !ready ? '已断线 · 草稿保留' : (request || settling) ? '保存中…' : '已连接';
      status.classList.toggle('is-offline', !ready);
    }
  }
  function navigation(kind, item, index, total, slotIndex) {
    const nav = node('div', undefined, 'stage-nav');
    const payload = (direction) => ({ action:'navigate', direction, ...(kind === 'hosts' && { index:slotIndex }) });
    const previous = limited(button('◀', () => command(kind, payload(-1)), kind === 'hosts' ? `previous-${slotIndex}` : 'program-previous', 'stage-nav-button'), index <= 0);
    const following = limited(button('▶', () => command(kind, payload(1)), kind === 'hosts' ? `next-${slotIndex}` : 'program-next', 'stage-nav-button'), (kind === 'hosts' && index < 0) || index >= total - 1);
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
  function quickCell(item, index, selected, action, key, upcoming) {
    const signature = JSON.stringify([item, index]);
    const old = quickCache.get(item.id);
    if (old?.signature === signature) {
      old.cell.setAttribute('aria-pressed', String(selected));
      old.cell.dataset.next = String(upcoming);
      return old.cell;
    }
    const cell = button('', action, key, 'stage-quick-cell');
    cell.setAttribute('aria-pressed', String(selected));
    if (upcoming) cell.dataset.next = 'true';
    cell.append(node('span', item.number || String(index + 1).padStart(2,'0'), 'stage-number'),
      node('strong', item.title, 'stage-quick-title'));
    if (item.type) cell.append(node('small', item.type, 'stage-quick-type'));
    quickCache.set(item.id, { signature, cell });
    cell.dataset.recordId = item.id;
    return cell;
  }
  function openPersonPicker(index) {
    if (!ready || request) return;
    pickerSlot = index;
    pickerTitle.textContent = `选择字幕条 ${index + 1} 的人物`;
    pickerSearch.value = '';
    renderPersonPicker();
    personPicker.showModal();
    pickerSearch.focus();
  }
  function renderPersonPicker() {
    const { hosts } = settings.modules;
    if (pickerSlot === null) return;
    if (pickerSlot >= hosts.slotCount) { personPicker.close(); return; }
    const slot = hosts.slots[pickerSlot];
    const query = pickerSearch.value.trim().normalize('NFKC').toLowerCase();
    const results = hosts.people.filter(({ name, title }) =>
      `${name} ${title}`.normalize('NFKC').toLowerCase().includes(query));
    pickerStatus.textContent = results.length ? `找到 ${results.length} 位人物` : '没有匹配的人物';
    pickerResults.replaceChildren(...results.map((person) => {
      const option = button('', () => {
        if (command('hosts', { action:'slot', index:pickerSlot, patch:{ personId:person.id } })) {
          personPicker.close();
          edit('hosts', { activeSlot: pickerSlot });
        }
      }, `pick-result-${person.id}`, 'stage-person-option');
      option.setAttribute('aria-pressed', String(slot.personId === person.id));
      option.disabled = !ready || Boolean(request);
      option.append(node('strong', person.name));
      if (person.title) option.append(node('small', person.title));
      return option;
    }));
  }
  function renderHostSlots(hosts) {
    const people = hosts.people ?? [];
    const active = Number.isInteger(hosts.activeSlot) ? hosts.activeSlot : 0;
    areas.hosts.slots.replaceChildren(...(hosts.slots ?? []).slice(0, 4).map((slot, index) => {
      const person = people.find(({ id }) => id === slot.personId);
      const card = node('div', undefined, 'stage-slot');
      card.dataset.slot = index;
      card.dataset.state = index === active && person && !slot.hidden ? (hosts.visible ? 'live' : 'cued') : 'hidden';
      card.style.cursor = person ? 'pointer' : '';
      const name = node('div', undefined, 'stage-slot-person');
      name.textContent = person?.name ?? '未选择人物';
      const meta = node('div', undefined, 'stage-slot-meta');
      meta.append(node('span', person?.title ?? '', 'stage-slot-title'));
      const pick = button(person ? '更换人物' : '选择人物', (event) => {
        event.stopPropagation();
        openPersonPicker(index);
      }, `pick-person-${index}`, 'stage-slot-picker');
      pick.setAttribute('aria-haspopup', 'dialog');
      pick.setAttribute('aria-label', `为第 ${index + 1} 个框选择人物`);
      card.onclick = () => { if (person) edit('hosts', { activeSlot: index }); };
      card.append(name, meta, pick);
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
      if (cached?.key === key) {
        // 条目内容没变时卡片会复用。节目从 1 个变成多个后，拖动手柄必须重新允许拖动。
        const grip = cached.card.querySelector('.stage-drag-handle');
        if (grip) grip.dataset.unavailable = String(Boolean(editor) || records.length < 2);
        return cached.card;
      }
      const card = node('details', undefined, 'stage-record stage-record-fold');
      card.open = editor?.item.id === item.id || Boolean(cached?.card.open);
      card.dataset.recordId = item.id;
      card.classList.toggle('is-current', item.id === module.selectedId);
      const summary = node('summary', undefined, 'stage-record-summary');
      summary.dataset.focusKey = `record-${kind}-${item.id}`;
      const body = node('div', undefined, 'stage-record-body');
      if (kind === 'program') {
        const grip = limited(button('', () => {}, `drag-${item.id}`, 'stage-drag-handle'), Boolean(editor) || records.length < 2);
        grip.append(gripIcon());
        grip.setAttribute('aria-label', `拖动调整「${item.title}」的顺序，也可按 ↑ ↓ 移动`);
        grip.title = '拖动调整顺序（↑ ↓ 也可移动）';
        grip.onkeydown = (event) => {
          if (!['ArrowUp','ArrowDown'].includes(event.key) || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
          event.preventDefault();
          moveByKey(item.id, event.key === 'ArrowUp' ? -1 : 1);
        };
        summary.append(grip);
      }
      const head = node('div', undefined, 'stage-record-head');
      head.append(node('span', kind === 'hosts' ? String(index + 1).padStart(2,'0') : item.number || String(index + 1).padStart(2,'0'), 'stage-number'));
      const heading = node('div', undefined, 'stage-record-title');
      heading.append(node('h4', kind === 'hosts' ? item.name : item.title));
      if (kind === 'program' && item.type) heading.append(node('span', item.type, 'stage-type'));
      summary.append(head, heading);
      const meta = kind === 'hosts' ? item.title : item.performer;
      if (meta) {
        const line = node('p', undefined, 'stage-record-meta');
        line.append(node('span', kind === 'hosts' ? '身份：' : '演出：'), document.createTextNode(meta));
        body.append(line);
      }
      const desc = kind === 'hosts' ? item.bio : item.desc;
      if (desc) body.append(node('p', desc, 'stage-record-desc'));
      if (editor?.item.id === item.id) {
        card.classList.add('is-editing');
        body.append(editor.form);
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
        summary.append(actions);
      }
      card.append(summary, body);
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
    if (!items.length) areas[kind].list.append(node('p', '暂无资料'));
  }
  function open(kind, item) {
    areas[kind].library.open = true;
    if (editors.has(kind)) {
      const current = editors.get(kind);
      const card = areas[kind].list.querySelector(`[data-record-id="${CSS.escape(current.item.id)}"]`);
      if (card) { card.open = true; card.scrollIntoView({ block:'nearest', behavior:'smooth' }); }
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
    if (undoMove && !sameOrder(undoMove.after, programOrder())) undoMove = undefined;
    const signature = JSON.stringify([hosts.people,hosts.slots,hosts.slotCount,hosts.activeSlot,hosts.visible,program.items,program.selectedId,program.visible]);
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
        const on = kind === 'hosts' ? hasVisibleHosts(hosts) : program.visible;
        areas[kind].state.textContent = on ? '画面中' : '未显示';
        areas[kind].state.classList.toggle('is-live', on);
        areas[kind].area.dataset.live = String(on);
      }
      areas.hosts.top.replaceChildren();
      /* 「显示数量 1–4 位」已去掉：固定四个框，一次只上屏一位。
      const count = node('div', undefined, 'stage-count');
      count.append(node('span', '显示数量'));
      const numbers = node('div', undefined, 'stage-count-buttons');
      for (let n = 1; n <= 4; n++) {
        const b = button(`${n} 位`, () => edit('hosts', { slotCount:n }), `count-${n}`);
        b.setAttribute('aria-pressed', String(hosts.slotCount === n)); numbers.append(b);
      }
      count.append(numbers);
      areas.hosts.top.append(count,hostPosition);
      */
      /* 字幕条位置（X/Y）已去掉，位置在预览里拖动或在下方位置段调整。 */
      renderHostSlots(hosts);
      if (personPicker.open) renderPersonPicker();
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
        ()=>command('program',{ action:'select', id:item.id }), `select-${item.id}`, i === index + 1));
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
      followUps = [];
      if (pendingMove) last = undefined;
      pendingMove = undefined; undoMove = undefined; sortingEnabled = false;
      cancelDrag();
      if (personPicker.open) personPicker.close();
      request = undefined; ready = false; savingKind = null; refreshEnabled();
      for (const { message } of editors.values()) message.textContent = '已断线，草稿保留。';
    },
    result(message) {
      if (!request || message.id !== request) return false;
      if (message.type === 'error') {
        editors.get(savingKind)?.message.replaceChildren(document.createTextNode(message.message));
        toast(message.message);
        // 排序失败：本地已乐观挪动，按服务器状态重绘还原。
        if (pendingMove) { last = undefined; render(settings, ready); }
      } else if (pendingMove) {
        undoMove = !pendingMove.undo && sameOrder(pendingMove.after, programOrder()) ? pendingMove : undefined;
      } else if (savingKind) {
        editors.delete(savingKind); renderLibraries(savingKind);
      }
      savingKind = null; pendingMove = undefined;
      const next = followUps.shift();
      if (next && ready) beginCommand(next.kind, next.payload);
      else { request = undefined; refreshEnabled(); }
      return true;
    },
  };
}
