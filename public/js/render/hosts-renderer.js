import { createModuleLayer } from '../core/module-layer.js';
import './host-appearance.js';

const HostAppearance = globalThis.HostAppearance;
export const HOSTS_STYLES = [
  { id: 'h', name: '烟洲新闻', hint: '蓝白新闻条' },
  { id: 'g', name: '烟洲校色', hint: '绛红双线边框' },
  { id: 'i', name: '烟洲印记', hint: '绛红边与淡校徽' },
];
export const DEFAULT_HOSTS_STYLE = 'h';
const STYLE_ID = 'yanzhou-hosts-renderer-style';

const CSS = `
.hosts-solo .module-body { width: 100%; display: flex; justify-content: center; align-items: flex-start; }
.hosts-solo .solo-name { display: flex; align-items: center; gap: 22px; padding: 15px 38px 17px 26px; box-sizing: border-box; border: 1px solid #d8ad55b3; border-radius: 8px; background-image: radial-gradient(120% 180% at 18% 0%, #a2272b 0%, #7f2023 42%, #5a1216 100%), linear-gradient(180deg, #772B2C, #5a1216); box-shadow: 0 16px 34px #00000073, inset 0 1px 0 #ffffff24, inset 0 0 0 1px #ffffff0f; }
.hosts-solo .solo-name[hidden] { display: none; }
.hosts-solo .solo-logo { display: block; flex: none; width: auto; height: 58px; filter: drop-shadow(0 2px 4px #00000059); }
.hosts-solo .solo-copy { display: flex; flex-direction: column; align-items: flex-start; gap: 7px; }
.hosts-solo .solo-class { font-size: 16px; font-weight: 600; letter-spacing: 8px; color: #e9cd92; opacity: .92; white-space: nowrap; }
.hosts-solo .solo-name-text { font-size: 60px; font-weight: 700; line-height: 1.04; letter-spacing: 14px; padding-left: 14px; color: #fbf0d6; text-shadow: 0 2px 8px #0000004d; white-space: nowrap; }
.solo-particle { position: absolute; z-index: 60; border-radius: 50%; pointer-events: none; box-shadow: 0 0 8px #e0b76966; }
`;

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const sheet = document.createElement('style');
  sheet.id = STYLE_ID;
  sheet.textContent = CSS;
  document.head.append(sheet);
}

export function hostsAppearance(slot) {
  const appearance = HostAppearance.template(slot.style ?? 'h');
  if (slot.customColors) {
    appearance.tagColor = slot.accentColor.toLowerCase();
    appearance.textColor = slot.textColor.toLowerCase();
    appearance.customized = true;
  }
  return appearance;
}

export function createHostsRenderer(container) {
  installStyles();
  const layer = createModuleLayer(container, {
    className: 'hosts-solo',
    bodyHTML: '<div class="solo-name" hidden>' +
      '<img class="solo-logo" src="/assets/mark-emblem.png" alt="" width="238" height="254">' +
      '<span class="solo-copy"><small class="solo-class"></small><strong class="solo-name-text"></strong></span>' +
      '</div>',
  });
  const plate = layer.body.querySelector('.solo-name');
  const nameEl = plate.querySelector('.solo-name-text');
  const classEl = plate.querySelector('.solo-class');
  let module;
  let lastName = '';
  let lastVisible = false;
  const stage = layer.element.parentElement;

  function limits() {
    return { minX: 80, maxX: 780, minY: 54, maxY: Math.max(54, Math.floor(1026 - 100 * (module?.scale ?? 1))) };
  }

  function burst() {
    if (!stage) return;
    const rect = plate.getBoundingClientRect();
    const base = stage.getBoundingClientRect();
    const offsetX = rect.left - base.left;
    const offsetY = rect.top - base.top;
    for (let i = 0; i < 44; i += 1) {
      const dot = document.createElement("span");
      dot.className = "solo-particle";
      const size = 3 + Math.random() * 6;
      const cx = offsetX + Math.random() * rect.width;
      const cy = offsetY + Math.random() * rect.height;
      dot.style.cssText = `left:${cx}px;top:${cy}px;width:${size}px;height:${size}px;background:${i % 3 === 0 ? "#fbf0d6" : "#e0b769"}`;
      stage.append(dot);
      const angle = Math.random() * Math.PI * 2;
      const distance = 40 + Math.random() * 150;
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance - 20;
      dot.animate([
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.1)`, opacity: 0 },
      ], { duration: 480 + Math.random() * 460, easing: "cubic-bezier(.18,.72,.28,1)" }).onfinish = () => dot.remove();
    }
  }

  return {
    element: layer.element,
    body: layer.body,
    getBounds: () => layer.getBounds(),
    getPositionLimits: limits,
    dispose() {},
    update(hosts, { constrain = true } = {}) {
      module = hosts;
      const bounds = limits();
      const x = constrain ? Math.min(bounds.maxX, Math.max(bounds.minX, hosts.x)) : hosts.x;
      const y = constrain ? Math.min(bounds.maxY, Math.max(bounds.minY, hosts.y)) : hosts.y;
      const people = hosts.people ?? String(hosts.names ?? '').split(/\r?\n/u).filter(Boolean).map((line, index) => {
        const [name, title = ''] = line.split(/[｜|]/u);
        return { id: String(index), name, title };
      });
      const index = Math.min(3, Math.max(0, Math.trunc(Number(hosts.activeSlot) || 0)));
      const slot = (hosts.slots ?? [])[index];
      const person = people.find(({ id }) => id === slot?.personId);
      const shown = Boolean(person) && index < hosts.slotCount && !slot.hidden;
      plate.hidden = !shown;
      if (person) {
        if (person.name !== nameEl.textContent) nameEl.textContent = person.name;
        if (person.title !== classEl.textContent) classEl.textContent = person.title;
        if (person.name !== lastName && !plate.hidden && lastName && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
          plate.animate([{ opacity: 0.2, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'ease-out' });
        }
        lastName = person.name;
      }
      const visibleNow = Boolean(hosts.visible) && shown;
      if (lastVisible && !visibleNow && !hosts.immediate && !matchMedia('(prefers-reduced-motion: reduce)').matches) burst();
      lastVisible = visibleNow;
      layer.update({ ...hosts, x, y });
      layer.body.style.width = `${Math.max(360, 1920 - 2 * x) / hosts.scale}px`;
      layer.element.setAttribute('aria-label', shown ? [person?.name, person?.title].filter(Boolean).join(' · ') : '人物信息条');
    },
  };
}

/* 旧版四条字幕条（H/G/I 样式）渲染代码已停用，保留在 git 历史中；
   public/js/render/host-appearance.js 与样式文件未删除，需要时可恢复。 */
