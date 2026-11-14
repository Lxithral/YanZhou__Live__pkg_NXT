import { createModuleLayer, isLightColor } from './module-layer.js';
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
.hosts-board .module-body { height:160px; display:flex; align-items:end; gap:16px; }
.hosts-board .host-slot { position:relative; flex:1; min-width:0; height:160px; }
.hosts-board .slot-content { position:absolute; inset:0; }
.hosts-board .host-visual { position:absolute; bottom:0; left:0; width:max-content; font-family:'MiSans',sans-serif; font-size:30px; transform-origin:left bottom; }
.hosts-board .is-right .host-visual { left:auto; right:0; transform-origin:right bottom; flex-direction:row-reverse; }
.hosts-board .host-visual .names { font-size:44px; line-height:1.3; max-width:440px; }
.hosts-board .host-visual .sub { font-size:22px; }
.hosts-board .host-visual .hidden { display:none; }
.hosts-board .host-visual[data-template=h] { width:560px; grid-template-columns:116px minmax(0,1fr) 16px; }
.hosts-board .host-visual[data-template=h] .tag { font-size:26px; }
.hosts-board .is-right .host-visual[data-template=h] { grid-template-columns:16px minmax(0,1fr) 116px; }
.hosts-board .is-right .host-visual[data-template=h] .tag { grid-column:3; border-top-left-radius:0; border-top-right-radius:var(--host-radius); }
.hosts-board .host-visual[data-template=h] .sub:has(.host-footer-right:empty) { display:none; }
.hosts-board .host-visual[data-template=i] { min-width:0; width:max-content; max-width:800px; }
.hosts-board .host-visual:not([data-template=h]) .sub { max-width:350px; white-space:normal; overflow-wrap:anywhere; }
`;
export function hostsAppearance(slot) {
  const appearance = HostAppearance.template(slot.style ?? 'h');
  if (slot.customColors) {
    appearance.tagColor = slot.accentColor.toLowerCase();
    appearance.tagTextColor = isLightColor(slot.accentColor) ? '#10131f' : '#ffffff';
    appearance.textColor = slot.textColor.toLowerCase();
    if (slot.style !== 'h') appearance.borderColor = slot.accentColor.toLowerCase();
    appearance.customized = true;
  }
  return appearance;
}
export function createHostsRenderer(container) {
  if (!document.getElementById(STYLE_ID)) {
    for (const href of ['/host-appearance.css', '/school-watermark.css']) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = href; document.head.append(link);
    }
    const sheet = document.createElement('style');
    sheet.id = STYLE_ID; sheet.textContent = CSS; document.head.append(sheet);
  }
  const layer = createModuleLayer(container, { className:'hosts-board' });
  const slots = Array.from({ length:4 }, (_, index) => {
    const cell = document.createElement('div');
    cell.className = 'host-slot'; cell.dataset.slot = index;
    const content = document.createElement('div');
    content.className = 'slot-content';
    const visual = document.createElement('div');
    visual.className = 'host-visual';
    visual.innerHTML = '<span class="tag"></span><span class="names"></span><span class="sub"></span>';
    content.append(visual); cell.append(content); layer.body.append(cell);
    return { cell, content, visual, signature:'', shown:false };
  });
  let module;
  function limits() {
    return { minX:80, maxX:780, minY:54, maxY:Math.max(54, Math.floor(1026 - 160 * (module?.scale ?? 1))) };
  }
  function fit() {
    for (const { cell, visual } of slots) {
      if (!cell.hidden) visual.style.transform = `scale(${Math.min(1, cell.clientWidth / Math.max(1, visual.offsetWidth), 152 / Math.max(1, visual.offsetHeight))})`;
    }
  }
  // The observer follows the renderer's lifetime, including temporary measurement renderers.
  const observer = new ResizeObserver(fit);
  observer.observe(layer.body);
  document.fonts?.ready.then(fit);
  return {
    ...layer, getPositionLimits:limits,
    dispose() {
      observer.disconnect();
      for (const { content } of slots) content.getAnimations().forEach((animation) => animation.cancel());
    },
    update(hosts, { animate = true, constrain = true } = {}) {
      module = hosts;
      const bounds = limits();
      const x = constrain ? Math.min(bounds.maxX, Math.max(bounds.minX, hosts.x)) : hosts.x;
      const y = constrain ? Math.min(bounds.maxY, Math.max(bounds.minY, hosts.y)) : hosts.y;
      const people = hosts.people ?? String(hosts.names ?? '').split(/\r?\n/u).filter(Boolean).map((line, i) => {
        const [name, title = ''] = line.split(/[｜|]/u);
        return { id:String(i), name, title };
      });
      const selections = hosts.slots ?? slots.map((_, i) => ({ ...hosts, personId:people[i]?.id, hidden:false }));
      layer.update({ ...hosts, x, y });
      layer.body.style.width = `${Math.max(360, 1920 - 2 * x) / hosts.scale}px`;
      const wasHidden = layer.element.hidden;
      layer.element.hidden = false;
      for (const [i, item] of slots.entries()) {
        const slot = selections[i];
        const person = people.find(({ id }) => id === slot.personId);
        const shown = i < hosts.slotCount && !slot.hidden && Boolean(person);
        item.cell.hidden = i >= hosts.slotCount;
        item.cell.classList.toggle('is-right', i >= Math.ceil(hosts.slotCount / 2));
        const signature = JSON.stringify([person, slot, hosts.label, shown]);
        if (signature !== item.signature) {
          item.content.getAnimations().forEach((a) => a.cancel());
          HostAppearance.update(item.visual, {
            title:hosts.label, names:person?.name ?? '', subtitle:person?.title ?? '', single:true,
            appearance:hostsAppearance(slot),
            animation:hosts.visible && item.shown && shown && animate ? 'rise' : 'none',
          }, fit);
          item.content.style.opacity = shown ? '1' : '0';
          item.content.setAttribute('aria-hidden', String(!shown));
          if (hosts.visible && animate && item.signature && shown !== item.shown && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
            item.content.animate(shown ? [{ opacity:.15, transform:'translateY(12px)' }, { opacity:1, transform:'none' }] :
              [{ opacity:item.shown ? 1 : 0, transform:'none' }, { opacity:0, transform:'translateY(12px)' }],
            { duration:shown ? 300 : 180, easing:'ease-out' });
          }
          item.signature = signature; item.shown = shown;
        }
      }
      fit(); layer.element.hidden = wasHidden;
      layer.element.setAttribute('aria-label', slots.filter((s) => s.shown).map((s) => s.visual.textContent).join(' · ') || '人物信息条');
    },
  };
}
