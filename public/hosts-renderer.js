import { createModuleLayer } from './module-layer.js';

const STYLE_ID = 'yanzhou-hosts-renderer-style';

/* Ported from the legacy LSP packaging (public/host.html): slot-style caption
   bars with a gradient prefix block, a white info bar, four color themes,
   mirrored right half and swap animations on host changes. */
const STYLES = `
.hosts-wrap { display: flex; justify-content: space-between; align-items: flex-end; gap: 80px; width: 1760px; }
.hosts-slot { display: flex; align-items: stretch; opacity: 0; transform: translateY(30px); transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
.hosts-slot.visible { opacity: 1; transform: translateY(0); }
.hosts-slot.hiding { opacity: 0; transform: translateY(20px); transition: transform 0.18s ease, opacity 0.12s ease; }
.hosts-slot.swap-out { opacity: 0; transform: translateY(80px); transition: transform 0.18s cubic-bezier(0.4, 0, 1, 1), opacity 0.12s ease; }
.hosts-slot.swap-in { opacity: 1; transform: translateY(0); transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
.lt-prefix { position: relative; padding: 14px 18px 14px 22px; border-radius: 6px 0 0 6px; display: flex; align-items: center; overflow: hidden; }
.lt-prefix::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 45%; background: linear-gradient(180deg, rgba(255, 255, 255, 0.07), transparent); pointer-events: none; }
.lt-prefix::after { content: ""; position: absolute; top: 8px; bottom: 8px; right: -1px; width: 3px; background: var(--hosts-accent); border-radius: 1px; opacity: 0.8; }
.lt-prefix-text { font-family: "Noto Serif SC", "Source Han Serif SC", serif; font-size: 26px; font-weight: 900; color: var(--hosts-prefix-color); letter-spacing: 0.12em; text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2); white-space: nowrap; }
.lt-info { position: relative; background: rgba(255, 255, 255, 0.95); border: 1px solid rgba(0, 0, 0, 0.06); border-left: none; padding: 14px 28px 14px 22px; display: flex; align-items: center; gap: 14px; border-radius: 0 6px 6px 0; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08); overflow: hidden; }
.lt-name { font-family: "Noto Serif SC", "Source Han Serif SC", serif; font-size: 26px; font-weight: 900; color: var(--hosts-name-color); letter-spacing: 0.06em; white-space: nowrap; }
.lt-divider { width: 2px; height: 22px; background: rgba(0, 0, 0, 0.12); flex-shrink: 0; border-radius: 1px; }
.lt-class { font-size: 17px; font-weight: 600; letter-spacing: 0.08em; white-space: nowrap; }
.hosts-slot.mirrored { flex-direction: row-reverse; }
.hosts-slot.mirrored .lt-prefix { border-radius: 0 6px 6px 0; }
.hosts-slot.mirrored .lt-prefix::after { right: auto; left: -1px; }
.hosts-slot.mirrored .lt-info { border-radius: 6px 0 0 6px; border-left: 1px solid rgba(0, 0, 0, 0.06); border-right: none; }
.slot-color-rose .lt-prefix { background: linear-gradient(135deg, #772b2c, #a03c3d); }
.slot-color-rose .lt-class { color: #772b2c; }
.slot-color-blue .lt-prefix { background: linear-gradient(135deg, #1a3a6e, #4a6ad0); }
.slot-color-blue .lt-class { color: #1a3a6e; }
.slot-color-green .lt-prefix { background: linear-gradient(135deg, #1a5c2e, #39e3a7); }
.slot-color-green .lt-class { color: #1a5c2e; }
.slot-color-purple .lt-prefix { background: linear-gradient(135deg, #5a1a6e, #c972eb); }
.slot-color-purple .lt-class { color: #5a1a6e; }
`;

const SLOT_COLORS = ['rose', 'blue', 'green', 'purple'];
const SLOT_MAX = 4;
const PLACEHOLDER = '暂无主持人';

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

/** One names line: 姓名｜头衔 (fullwidth or ASCII pipe both accepted). */
function parseEntries(names) {
  return String(names ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf('｜') >= 0 ? '｜' : '|';
      const cut = line.indexOf(separator);
      if (cut < 0) return { name: line, title: '' };
      return { name: line.slice(0, cut).trim(), title: line.slice(cut + separator.length).trim() };
    });
}

export function createHostsRenderer(container) {
  installStyles();
  const layer = createModuleLayer(container, {
    className: 'hosts-board',
    bodyHTML: `<div class="hosts-wrap">${Array.from({ length: SLOT_MAX }, (_, i) => `<div class="hosts-slot" data-slot="${i}"><div class="lt-prefix"><span class="lt-prefix-text"></span></div><div class="lt-info"><span class="lt-name"></span><span class="lt-divider"></span><span class="lt-class"></span></div></div>`).join('')}</div>`,
  });
  const { element, body } = layer;
  const slots = Array.from(body.querySelectorAll('.hosts-slot'), (el, i) => ({
    el,
    prefixText: el.querySelector('.lt-prefix-text'),
    name: el.querySelector('.lt-name'),
    divider: el.querySelector('.lt-divider'),
    title: el.querySelector('.lt-class'),
    content: null,
    busy: false,
    timer: 0,
    index: i,
  }));

  function setContent(slot, entry) {
    slot.name.textContent = entry ? entry.name || '' : PLACEHOLDER;
    slot.title.textContent = entry ? entry.title || '' : '';
    slot.divider.style.display = entry && entry.title ? 'block' : 'none';
  }

  function baseClasses(slot, mirrored) {
    return `hosts-slot slot-color-${SLOT_COLORS[slot.index]}${mirrored ? ' mirrored' : ''}`;
  }

  function applySlot(slot, entry, mirrored, active) {
    const content = entry ? `${entry.name}|${entry.title}` : '';
    slot.el.style.display = '';
    if (slot.content !== content) {
      const hadContent = slot.content !== null;
      slot.content = content;
      clearTimeout(slot.timer);
      if (hadContent && active && !slot.busy) {
        // Same swap choreography as the legacy page: out 200ms, in 400ms.
        slot.busy = true;
        slot.el.className = `${baseClasses(slot, mirrored)} swap-out`;
        slot.timer = setTimeout(() => {
          setContent(slot, entry);
          slot.el.className = `${baseClasses(slot, mirrored)} swap-in`;
          slot.timer = setTimeout(() => {
            slot.el.className = `${baseClasses(slot, mirrored)} visible`;
            slot.busy = false;
          }, 400);
        }, 200);
        return;
      }
    }
    setContent(slot, entry);
  }

  return {
    element,
    body,
    update(hosts) {
      layer.update(hosts);
      element.style.setProperty('--hosts-accent', hosts.accentColor);
      element.style.setProperty('--hosts-name-color', hosts.textColor);
      const entries = parseEntries(hosts.names);
      const label = hosts.label || '';
      const count = Math.max(1, Math.min(SLOT_MAX, Number(hosts.slotCount) || 2));
      const rightStart = count <= 1 ? count : Math.ceil(count / 2);
      for (const slot of slots) {
        slot.prefixText.textContent = label;
        if (slot.index >= count) {
          clearTimeout(slot.timer);
          slot.busy = false;
          slot.el.style.display = 'none';
          continue;
        }
        applySlot(slot, entries[slot.index] ?? null, slot.index >= rightStart, Boolean(hosts.visible));
      }
      element.setAttribute('aria-label', [hosts.label, ...entries.map((entry) => entry.name)].filter(Boolean).join(' · ') || '主持字幕');
    },
    getBounds: () => layer.getBounds(),
  };
}
