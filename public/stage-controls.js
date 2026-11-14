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
    title.append(badge);
    const status = node('div', '', 'stage-source');
    status.setAttribute('role', 'status');
    const top = node('div', undefined, 'stage-top');
    const slots = node('div', undefined, 'stage-slots');
    const current = node('div', undefined, 'stage-current');
    const next = node('div', undefined, 'stage-next');
    const quick = node('div', undefined, 'stage-quick');
    const add = button(kind === 'hosts' ? '+ 添加主持人' : '+ 添加节目', () => open(kind), `add-${kind}`, 'stage-add');
    const list = node('div', undefined, 'stage-list');
    list.setAttribute('aria-label', kind === 'hosts' ? '主持人资料卡片' : '节目资料卡片');
    const hotkeys = node('div', kind === 'hosts' ? '热键 · 0 整体显隐 · 1–4 单条显隐' : '热键 · ← → 切节目 · 0 显隐', 'stage-hotkeys');
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
    area.append(title, status, top, current, next, quick, slots, add, list, hotkeys);
    grid.append(area);
    areas[kind] = { area, badge, status, top, slots, current, next, quick, list };
  }
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
  function command(kind, payload) {
    if (!ready || request) return;
    request = `management-${crypto.randomUUID()}`;
    savingKind = payload.action === 'save' ? kind : null;
    send({ type:`${kind}:manage`, id:request, payload });
    refreshEnabled();
  }
  function refreshEnabled() {
    for (const [kind, { area, status }] of Object.entries(areas)) {
      area.querySelectorAll('button,input,textarea,select').forEach((input) => {
        input.disabled = !ready || Boolean(request) || input.dataset.unavailable === 'true';
      });
      status.textContent = !ready ? '连接断开 · 草稿已保留' : request ? '正在保存…' : 'settings.json · 已连接';
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
    nav.append(previous, info, following);
    return nav;
  }
  function quickCell(item, index, selected, action, key, kind) {
    const cell = button('', action, key, 'stage-quick-cell');
    cell.setAttribute('aria-pressed', String(selected));
    cell.append(node('span', item.number || String(index + 1).padStart(2,'0'), 'stage-number'),
      node('strong', kind === 'hosts' ? item.name : item.title, 'stage-quick-title'));
    if (kind === 'program' && item.type) cell.append(node('small', item.type, 'stage-quick-type'));
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
      const head = node('div', undefined, 'stage-slot-head');
      head.append(node('strong', `字幕条 ${index + 1}`),
        limited(button(slot.hidden ? '已隐藏' : '显示中', () => command('hosts', { action:'slot', index, patch:{ hidden:!slot.hidden } }), `visible-${index}`, slot.hidden ? 'is-hidden' : 'is-live'), inactive || !slot.personId));
      const at = people.findIndex((p) => p.id === slot.personId);
      const nav = navigation('hosts', people[at], at, people.length, index);
      const quick = node('div', undefined, 'stage-slot-quick');
      people.forEach((person, i) => quick.append(quickCell(person, i, person.id === slot.personId,
        () => command('hosts', { action:'slot', index, patch:{ personId:person.id } }), `person-${index}-${person.id}`, 'hosts')));
      const appearance = node('details', undefined, 'stage-slot-appearance');
      appearance.append(node('summary', '样式与自定义颜色'));
      const styles = node('div', undefined, 'stage-style-row');
      for (const [id, name] of [['h','烟洲新闻'],['g','烟洲校色'],['i','烟洲印记']]) {
        const b = button(name, () => command('hosts', { action:'slot', index, patch:{ style:id } }), `style-${index}-${id}`);
        b.setAttribute('aria-pressed', String(slot.style === id));
        styles.append(b);
      }
      appearance.append(styles);
      for (const [key, label] of [['accentColor','标签色'],['textColor','姓名色']]) {
        const l = node('label', label);
        const input = node('input');
        input.type = 'color'; input.value = slot[key];
        input.dataset.focusKey = `${key}-${index}`;
        input.setAttribute('aria-label', `字幕条 ${index + 1} ${label}`);
        input.onchange = () => command('hosts', { action:'slot', index, patch:{ [key]:input.value, customColors:true } });
        l.append(input); appearance.append(l);
      }
      card.append(head, nav, quick, appearance);
      if (inactive) card.querySelectorAll('button,input').forEach((control) => control.dataset.unavailable = 'true');
      return card;
    }));
  }
  function renderLibraries(kind) {
    const module = settings.modules[kind];
    const records = kind === 'hosts' ? module.people ?? [] : module.items ?? [];
    const editor = editors.get(kind);
    const items = editor?.isNew ? [...records, editor.item] : records;
    const cards = items.map((item, index) => {
      const card = node('article', undefined, 'stage-record');
      card.dataset.recordId = item.id;
      card.classList.toggle('is-current', item.id === module.selectedId);
      const head = node('div', undefined, 'stage-record-head');
      head.append(node('span', kind === 'hosts' ? String(index + 1).padStart(2,'0') : item.number || String(index + 1).padStart(2,'0'), 'stage-number'));
      if (kind === 'program' && item.type) head.append(node('span', item.type, 'stage-type'));
      card.append(head, node('h4', kind === 'hosts' ? item.name : item.title));
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
        if (item.id === module.selectedId) actions.append(node('span', '当前节目', 'stage-current-badge'));
        card.append(actions);
      }
      return card;
    });
    areas[kind].list.replaceChildren(...cards);
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
      const focused = document.activeElement?.dataset.focusKey;
      const people = hosts.people ?? [];
      const items = program.items ?? [];
      areas.hosts.badge.textContent = `${people.length} 位`;
      areas.program.badge.textContent = `${items.length} 个节目`;
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
          () => edit(kind,{ visible:!visible }), 'toggle-' + kind, 'stage-toggle');
        if (kind === 'hosts') areas[kind].top.append(toggle);
        else areas[kind].top.replaceChildren(toggle);
      }
      renderHostSlots(hosts);
      const index = items.findIndex((p) => p.id === program.selectedId);
      areas.program.current.replaceChildren(navigation('program', items[index], index, items.length));
      const nextItem = items[index + 1];
      areas.program.next.replaceChildren(node('small','下一个节目'),
        node('strong',nextItem?.title ?? '没有下一个节目了'),
        node('span', nextItem ? [nextItem.number,nextItem.type,nextItem.performer].filter(Boolean).join(' · ') : '已到达最后一个节目'));
      areas.program.quick.replaceChildren(...items.map((item,i) => quickCell(item,i,item.id===program.selectedId,
        ()=>command('program',{ action:'select', id:item.id }), `select-${item.id}`,'program')));
      renderLibraries('hosts'); renderLibraries('program');
      if (focused) document.querySelector(`[data-focus-key="${CSS.escape(focused)}"]`)?.focus({ preventScroll:true });
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
      } else if (savingKind) {
        editors.delete(savingKind); renderLibraries(savingKind);
      }
      savingKind = null;
      refreshEnabled(); return true;
    },
  };
}
