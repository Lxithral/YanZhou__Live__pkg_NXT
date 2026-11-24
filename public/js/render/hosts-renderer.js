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
let ribbonSequence = 0;

const CSS = `
.hosts-solo .module-body { width: 100%; display: flex; justify-content: center; align-items: flex-start; }
.hosts-solo .solo-name { position: relative; display: flex; align-items: center; width: max-content; height: 106px; padding: 0 68px 12px 92px; box-sizing: border-box; }
.hosts-solo .solo-name[hidden] { display: none; }
.hosts-solo .solo-ribbon { position: absolute; left: 8px; top: 24px; width: calc(100% - 8px); height: 76px; overflow: visible; filter: drop-shadow(0 3px 5px #21000680); }
.hosts-solo .solo-scroll { position: absolute; right: 6px; top: 48px; width: 52px; height: 52px; color: #dbb775; filter: drop-shadow(0 1px 1px #31080e); }
.hosts-solo .solo-logo { position: absolute; left: 18px; top: 8px; display: block; width: auto; height: 68px; filter: drop-shadow(0 2px 2px #30070e80); }
.hosts-solo .solo-copy { position: relative; display: grid; grid-template-rows: 24px 70px; justify-items: center; align-items: center; }
.hosts-solo .solo-meta { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 500; line-height: 1; letter-spacing: 1px; text-shadow: 0 1px 2px #30070e; white-space: nowrap; }
.hosts-solo .solo-school { color: #e8c67f; }
.hosts-solo .solo-class { display: inline-flex; align-items: center; gap: 8px; font: inherit; color: #d1bc94; }
.hosts-solo .solo-class::before { content: ''; width: 1px; height: 9px; background: #cda66b80; }
.hosts-solo .solo-class:empty { display: none; }
.hosts-solo .solo-name-text { font-family: 'KaiTi', 'STKaiti', 'Kaiti SC', serif; font-size: 48px; font-weight: 400; line-height: 1; letter-spacing: 12px; padding-left: 12px; color: #f3dba0; text-shadow: 0 1px 0 #be8b43, 0 2px 2px #30070e; white-space: nowrap; }
.solo-dissolve { position: absolute; z-index: 60; pointer-events: none; transform-origin: top left; font-family: 'MiSans', sans-serif; line-height: 1; }
.solo-dissolve .solo-name { width: 100%; height: 100%; mask-image: linear-gradient(90deg, transparent 45%, #000 55%); mask-size: 240% 100%; mask-position: 100% 0; mask-repeat: no-repeat; }
.solo-particle { position: absolute; border-radius: 50%; pointer-events: none; background: #e0b769; box-shadow: 0 0 4px #e0b76940; }
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
  const ribbonId = `yanzhou-host-ribbon-${++ribbonSequence}`;
  const layer = createModuleLayer(container, {
    className: 'hosts-solo',
    bodyHTML: `<div class="solo-name" hidden>
      <svg class="solo-ribbon" viewBox="0 0 560 80" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="${ribbonId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#bd3229"/><stop offset=".18" stop-color="#97201f"/>
          <stop offset=".55" stop-color="#772B2C"/><stop offset="1" stop-color="#490c14"/>
        </linearGradient></defs>
        <path class="solo-ribbon-fill" d="M18 1.5H520a38.5 38.5 0 0 1 0 77H1.5Z" fill="url(#${ribbonId})" stroke="#e8c67f" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
        <path class="solo-ribbon-inset" d="M22 4H520a36 36 0 0 1 0 72H6" fill="none" stroke="#f5dfa5" stroke-opacity=".26" stroke-width=".7" vector-effect="non-scaling-stroke"/>
      </svg>
      <svg class="solo-scroll" viewBox="0 0 80 80" fill="none" aria-hidden="true">
        <path d="M0 78H16C44 78 68 63 68 41C68 23 54 13 40 16C26 19 20 33 26 45C32 56 48 55 52 45C56 35 47 28 40 32C34 35 35 42 41 42" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>
      <img class="solo-logo" src="/assets/mark-emblem.png" alt="" width="238" height="254">
      <span class="solo-copy">
        <span class="solo-meta"><span class="solo-school">烟洲中学</span><small class="solo-class"></small></span>
        <strong class="solo-name-text"></strong>
      </span>
    </div>`,
  });
  const plate = layer.body.querySelector('.solo-name');
  const nameEl = plate.querySelector('.solo-name-text');
  const classEl = plate.querySelector('.solo-class');
  const ribbon = plate.querySelector('.solo-ribbon');
  const ribbonFill = plate.querySelector('.solo-ribbon-fill');
  const ribbonInset = plate.querySelector('.solo-ribbon-inset');
  let lastRibbonWidth = 0;
  let module;
  let lastName = '';
  let lastVisible = false;
  let lastPersonId = '';
  let effect;
  let nameAnimation;
  const stage = layer.element.parentElement;

  function limits() {
    return { minX: 80, maxX: 780, minY: 54, maxY: Math.max(54, Math.floor(1026 - 100 * (module?.scale ?? 1))) };
  }

  function clearEffect() {
    if (!effect) return;
    for (const animation of effect.getAnimations({ subtree: true })) animation.cancel();
    effect.remove();
    effect = null;
  }

  function dissolve(copyPlate) {
    clearEffect();
    if (!stage || !plate.offsetWidth || !plate.offsetHeight) return;
    const rect = plate.getBoundingClientRect();
    const base = stage.getBoundingClientRect();
    if (!base.width || !base.height || !stage.offsetWidth || !stage.offsetHeight) return;
    const zoomX = base.width / stage.offsetWidth;
    const zoomY = base.height / stage.offsetHeight;
    const width = plate.offsetWidth;
    const height = plate.offsetHeight;
    const group = document.createElement('div');
    group.className = 'hosts-solo solo-dissolve';
    group.setAttribute('aria-hidden', 'true');
    group.style.cssText = `left:${(rect.left - base.left) / zoomX}px;top:${(rect.top - base.top) / zoomY}px;width:${width}px;height:${height}px;transform:scale(${rect.width / zoomX / width},${rect.height / zoomY / height});opacity:${module.opacity / 100}`;
    stage.append(group);
    effect = group;
    const sweep = Math.min(620, Math.max(300, module.animation?.duration ?? 600));
    if (copyPlate) {
      const copy = plate.cloneNode(true);
      copy.style.visibility = '';
      const gradient = copy.querySelector('linearGradient');
      gradient.id += '-dissolve';
      copy.querySelector('.solo-ribbon-fill').setAttribute('fill', `url(#${gradient.id})`);
      group.append(copy);
      copy.animate([
        { maskPosition: '100% 0', opacity: 1 },
        { maskPosition: '0% 0', opacity: 0 },
      ], { duration: sweep, easing: 'linear', fill: 'forwards' });
    }

    const total = 110;
    for (let i = 0; i < total; i += 1) {
      const dot = document.createElement('span');
      dot.className = 'solo-particle';
      const progress = (i + Math.random()) / total;
      const size = 1 + Math.random() * 2.8;
      const cy = Math.random() * height;
      const dx = 32 + Math.random() * 100;
      const dy = -12 - Math.random() * 48;
      const duration = 460 + Math.random() * 300;
      dot.style.cssText = `left:${progress * width}px;top:${cy}px;width:${size}px;height:${size}px;background:${i % 7 === 0 ? '#fbf0d6' : i % 3 === 0 ? '#b88a46' : '#e0b769'};opacity:0`;
      group.append(dot);
      dot.animate([
        { transform: 'translate(0, 0) scale(.5)', opacity: 0 },
        { transform: `translate(${dx * .12}px, ${dy * .1}px) scale(1)`, opacity: .85, offset: .16 },
        { transform: `translate(${dx * .62}px, ${dy * .55}px) scale(.7)`, opacity: .45, offset: .65 },
        { transform: `translate(${dx}px, ${dy}px) scale(.15)`, opacity: 0 },
      ], { duration, delay: progress * sweep * .85, easing: 'cubic-bezier(.2,.65,.35,1)', fill: 'both' });
    }
    group.animate([{ opacity: module.opacity / 100 }, { opacity: 0 }], {
      duration: sweep + 760, easing: 'cubic-bezier(.7,0,1,1)',
    }).onfinish = () => { if (effect === group) clearEffect(); };
  }

  return {
    element: layer.element,
    body: layer.body,
    getBounds: () => layer.getBounds(),
    getPositionLimits: limits,
    dispose() {
      clearEffect();
      nameAnimation?.cancel();
    },
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
      const visibleNow = Boolean(hosts.visible) && shown;
      const personId = shown ? person.id : '';
      const switched = Boolean(lastVisible && visibleNow && lastPersonId && personId !== lastPersonId && !hosts.immediate);
      const leaving = lastVisible && !visibleNow && !hosts.immediate;
      const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (hosts.immediate || reducedMotion || (!lastVisible && visibleNow)) clearEffect();
      if ((switched || leaving) && !reducedMotion) dissolve(leaving);
      if (hosts.immediate || leaving || switched) nameAnimation?.cancel();
      lastPersonId = personId;
      lastVisible = visibleNow;
      plate.hidden = !shown;
      plate.style.visibility = visibleNow ? '' : 'hidden';
      if (person) {
        if (person.name !== nameEl.textContent) nameEl.textContent = person.name;
        const title = (person.title ?? '').replace(/^(高[一二三]|初[一二三])\s*[（(]\s*([^）)]+)\s*[）)]\s*班$/u, '$1 · $2班');
        if (title !== classEl.textContent) classEl.textContent = title;
        if (person.name !== lastName && visibleNow && lastName && !hosts.immediate && !reducedMotion) {
          nameAnimation?.cancel();
          nameAnimation = plate.animate([{ opacity: 0.2, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'ease-out' });
        }
        lastName = person.name;
      }
      layer.update({ ...hosts, x, y });
      layer.body.style.width = `${Math.max(360, 1920 - 2 * x) / hosts.scale}px`;
      const ribbonWidth = plate.offsetWidth - 8;
      if (ribbonWidth > 0 && ribbonWidth !== lastRibbonWidth) {
        ribbon.setAttribute('viewBox', `0 0 ${ribbonWidth} 80`);
        ribbonFill.setAttribute('d', `M18 1.5H${ribbonWidth - 40}a38.5 38.5 0 0 1 0 77H1.5Z`);
        ribbonInset.setAttribute('d', `M22 4H${ribbonWidth - 40}a36 36 0 0 1 0 72H6`);
        lastRibbonWidth = ribbonWidth;
      }
      layer.element.setAttribute('aria-label', shown ? [person?.name, person?.title].filter(Boolean).join(' · ') : '人物信息条');
    },
  };
}

/* 旧版四条字幕条（H/G/I 样式）渲染代码已停用，保留在 git 历史中；
   public/js/render/host-appearance.js 与样式文件未删除，需要时可恢复。 */
