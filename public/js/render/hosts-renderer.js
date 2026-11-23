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
.hosts-solo .solo-name { display: flex; align-items: center; gap: 18px; padding: 12px 28px 12px 22px; box-sizing: border-box; background: #772B2C; border: 1px solid #d8ad55a6; border-radius: 6px; box-shadow: 0 14px 30px #00000059, inset 0 0 0 1px #ffffff14; }
.hosts-solo .solo-name[hidden] { display: none; }
.hosts-solo .solo-logo { display: block; flex: none; width: auto; height: 56px; }
.hosts-solo .solo-copy { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.hosts-solo .solo-class { font-size: 17px; font-weight: 600; letter-spacing: 6px; color: #e9cd92; white-space: nowrap; }
.hosts-solo .solo-name-text { font-size: 58px; font-weight: 700; line-height: 1.06; letter-spacing: 9px; padding-left: 9px; color: #f8e8c4; white-space: nowrap; }
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

  function limits() {
    return { minX: 80, maxX: 780, minY: 54, maxY: Math.max(54, Math.floor(1026 - 100 * (module?.scale ?? 1))) };
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
      layer.update({ ...hosts, x, y });
      layer.body.style.width = `${Math.max(360, 1920 - 2 * x) / hosts.scale}px`;
      layer.element.setAttribute('aria-label', shown ? [person?.name, person?.title].filter(Boolean).join(' · ') : '人物信息条');
    },
  };
}

/* 旧版四条字幕条（H/G/I 样式）渲染代码已停用，保留在 git 历史中；
   public/js/render/host-appearance.js 与样式文件未删除，需要时可恢复。 */
