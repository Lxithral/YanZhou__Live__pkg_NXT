import { createModuleLayer, isLightColor } from './module-layer.js';

const STYLE_ID = 'yanzhou-hosts-renderer-style';
const STYLES = `
.hosts-wrap { display: grid; grid-template-columns: repeat(var(--hosts-count), minmax(0, 1fr)); align-items: end; gap: 14px; width: var(--hosts-span); }
.hosts-slot { display: flex; min-width: 0; width: max-content; max-width: 100%; min-height: 52px; overflow: hidden; border-radius: 5px; background: var(--hosts-surface); color: var(--hosts-name-color); }
.hosts-slot[hidden], .hosts-slot [hidden] { display: none; }
.hosts-slot.mirrored { justify-self: end; flex-direction: row-reverse; }
.lt-prefix { display: flex; align-items: center; flex: 0 1 auto; min-width: 0; max-width: max(88px, 42%); padding: 10px 15px; background: var(--hosts-accent); color: var(--hosts-prefix-color); }
.lt-prefix-text, .lt-name, .lt-class { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lt-prefix-text { font-size: 19px; font-weight: 650; }
.lt-info { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 10px 15px; }
.lt-name { font-size: 26px; font-weight: 670; }
.lt-class { font-size: 17px; opacity: .76; flex-shrink: 2; }
.lt-divider { width: 1px; height: 18px; background: currentColor; opacity: .24; flex: none; }
`;

function parseEntries(names) {
  return String(names ?? '').split(/\r?\n/).map((line) => {
    const separator = line.search(/[｜|]/u);
    return separator < 0 ? { name: line.trim(), title: '' } : {
      name: line.slice(0, separator).trim(),
      title: line.slice(separator + 1).trim(),
    };
  }).filter(({ name }) => name);
}

export function createHostsRenderer(container) {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLES;
    document.head.append(style);
  }
  const layer = createModuleLayer(container, {
    className: 'hosts-board',
    bodyHTML: '<div class="hosts-wrap"></div>',
  });
  const wrap = layer.body.firstElementChild;
  const slots = Array.from({ length: 4 }, () => {
    const node = document.createElement('div');
    node.className = 'hosts-slot';
    node.innerHTML = '<div class="lt-prefix"><span class="lt-prefix-text"></span></div><div class="lt-info"><span class="lt-name"></span><span class="lt-divider"></span><span class="lt-class"></span></div>';
    wrap.append(node);
    return {
      node,
      prefix: node.querySelector('.lt-prefix'),
      label: node.querySelector('.lt-prefix-text'),
      name: node.querySelector('.lt-name'),
      divider: node.querySelector('.lt-divider'),
      title: node.querySelector('.lt-class'),
      content: null,
      pending: null,
      animation: null,
      phase: '',
    };
  });
  let shown = false;

  function commitSlot(slot) {
    const { label, entry, content } = slot.pending;
    slot.content = content;
    slot.prefix.hidden = !label;
    slot.label.textContent = label;
    slot.name.textContent = entry.name;
    slot.title.textContent = entry.title;
    slot.title.hidden = slot.divider.hidden = !entry.title;
  }

  function cancelSlot(slot) {
    if (slot.animation) {
      slot.animation.onfinish = null;
      slot.animation.cancel();
      slot.animation = null;
    }
    slot.phase = '';
  }

  function swapSlot(slot, index) {
    // Keep the old name on screen until its exit finishes. Updates during
    // that exit replace the pending name, so a stale update cannot reappear.
    if (slot.phase === 'out') return;
    cancelSlot(slot);
    slot.phase = 'out';
    slot.animation = slot.node.animate([
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: 'translateY(80px)' },
    ], { duration: 200, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    slot.animation.onfinish = () => {
      cancelSlot(slot);
      commitSlot(slot);
      slot.phase = 'in';
      slot.animation = slot.node.animate([
        { opacity: 0, transform: 'translateY(30px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 350, easing: 'cubic-bezier(.22,1,.36,1)', delay: index * 25, fill: 'both' });
      slot.animation.onfinish = () => cancelSlot(slot);
    };
  }

  function getPositionLimits() {
    const { width, height } = layer.getBounds();
    return {
      minX: 96, maxX: Math.max(96, Math.floor(1824 - width)),
      minY: 54, maxY: Math.max(54, Math.floor(1026 - height)),
    };
  }

  return {
    ...layer,
    getPositionLimits,
    update(hosts, { animate = true, constrain = true } = {}) {
      const entries = parseEntries(hosts.names).slice(0, Math.round(hosts.slotCount || 2));
      const visible = hosts.visible && entries.length > 0;
      layer.update({ ...hosts, visible });
      const accent = hosts.accentColor;
      layer.element.style.setProperty('--hosts-accent', accent);
      layer.element.style.setProperty('--hosts-prefix-color', isLightColor(accent) ? '#141921' : '#ffffff');
      layer.element.style.setProperty('--hosts-name-color', hosts.textColor);
      layer.element.style.setProperty('--hosts-surface', isLightColor(hosts.textColor) ? '#202634' : '#f2f4f7');
      wrap.style.setProperty('--hosts-span', `${1728 / Math.max(1, hosts.scale)}px`);
      wrap.style.setProperty('--hosts-count', Math.max(1, entries.length));

      for (const [index, slot] of slots.entries()) {
        const entry = entries[index];
        slot.node.hidden = !entry;
        slot.node.classList.toggle('mirrored', index >= Math.ceil(entries.length / 2));
        const content = entry ? JSON.stringify([hosts.label, entry.name, entry.title]) : null;
        slot.pending = { label: hosts.label, entry, content };
        if (!entry) {
          cancelSlot(slot);
          slot.content = null;
          continue;
        }
        if (slot.content === content && !slot.phase) continue;
        if (visible && shown && animate && slot.content !== null) {
          if (slot.content !== content) swapSlot(slot, index);
        } else {
          cancelSlot(slot);
          commitSlot(slot);
        }
      }
      if (constrain) {
        const limits = getPositionLimits();
        layer.element.style.left = `${Math.min(limits.maxX, Math.max(limits.minX, hosts.x))}px`;
        layer.element.style.top = `${Math.min(limits.maxY, Math.max(limits.minY, hosts.y))}px`;
      }
      shown = visible;
      layer.element.setAttribute('aria-label', [hosts.label, ...entries.map(({ name }) => name)].filter(Boolean).join(' · ') || '人物信息条');
    },
  };
}
