import { createModuleLayer } from './module-layer.js';

const STYLE_ID = 'yanzhou-program-renderer-style';

// 票根卡整体按旧版 75% 的尺寸排版：滑块 100% = 旧版 75%。
const TITLE_MIN = 25.5;

const STYLES = `
/* 票根 · 艺术节：绛红主票 + 米色存根，中间齿孔撕线；存根放序号和校徽 */
.pc-wrap { filter: drop-shadow(0 10.5px 19.5px #0007); }
.pc { box-sizing: border-box; position: relative; isolation: isolate; width: 510px; display: grid; grid-template-columns: minmax(0, 1fr) 112.5px; grid-template-areas: "head num" "title num" "perf num" "desc num" "next num"; grid-template-rows: auto auto auto 1fr auto; background: #6e2427; border-radius: 4.5px; font-family: 'Microsoft YaHei', 'MiSans', sans-serif; line-height: 1.3;
  -webkit-mask: radial-gradient(circle 10.5px at calc(100% - 112.5px) 0, #0000 98%, #000) top / 100% 51% no-repeat, radial-gradient(circle 10.5px at calc(100% - 112.5px) 100%, #0000 98%, #000) bottom / 100% 51% no-repeat;
  mask: radial-gradient(circle 10.5px at calc(100% - 112.5px) 0, #0000 98%, #000) top / 100% 51% no-repeat, radial-gradient(circle 10.5px at calc(100% - 112.5px) 100%, #0000 98%, #000) bottom / 100% 51% no-repeat; }
.pc [hidden] { display: none !important; }
.pc-head { grid-area: head; display: flex; align-items: center; gap: 9px; padding: 19.5px 24px 0; white-space: nowrap; }
.pc-label { flex: none; padding: 2.25px 7.5px; border-radius: 2px; background: #f4ece0; color: #6e2427; font-size: 11.25px; font-weight: 700; letter-spacing: 2.25px; }
.pc-type { flex: none; padding: 2px 6.75px; border: 1px solid #f1d9bd66; color: #f1d9bd; font-size: 11.25px; font-weight: 700; }
.pc-title { grid-area: title; padding: 9px 24px 0; color: #fff8ee; font-size: 37.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pc-perf { grid-area: perf; display: flex; gap: 10.5px; align-items: baseline; padding: 9px 24px 0; }
.pc-perf-label { flex: none; color: #e6c08a; font-size: 12px; font-weight: 700; letter-spacing: 2px; }
.pc-perf-text { min-width: 0; color: #f3e7da; font-size: 15px; line-height: 1.5; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.pc-desc { grid-area: desc; align-self: start; margin: 7.5px 24px 0; color: #f3e7dab3; font-size: 14.25px; line-height: 1.65; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
.pc-next { grid-area: next; display: flex; align-items: baseline; gap: 9px; margin: 13.5px 24px 0; padding: 10.5px 0 13.5px; border-top: 1px dashed #ffffff3d; color: #fff; font-size: 14.25px; }
.pc-next-label { flex: none; color: #e6c08a; font-weight: 700; }
.pc-next-name { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pc.no-next .is-last { margin-bottom: 19.5px; }
.pc-num { grid-area: num; display: flex !important; flex-direction: column; align-items: center; justify-content: center; gap: 3px; background: #f4ece0; border-left: 2px dashed #6e242766; color: #6e2427; font-family: 'MiSans', sans-serif; font-size: 48px; font-weight: 600; line-height: 1; }
.pc-num::before { content: "节目"; font-family: 'Microsoft YaHei', 'MiSans', sans-serif; font-size: 11.25px; font-weight: 700; letter-spacing: 4.5px; opacity: .7; }
.pc-num.is-empty::before { content: none; }
.pc-num::after { content: ""; width: 55.5px; height: 55.5px; margin-top: 10.5px; background: url('/assets/yanzhou-watermark.png') center/contain no-repeat; opacity: .55; filter: saturate(.6); }
.pc-num.is-empty::after { width: 72px; height: 72px; margin: 0; opacity: .7; }
`;

const TICKET_HTML = '<div class="pc-wrap"><div class="pc">'
  + '<div class="pc-head"><span class="pc-label"></span><span class="pc-type"></span></div>'
  + '<div class="pc-num"><span class="pc-num-text"></span></div>'
  + '<div class="pc-title"></div>'
  + '<div class="pc-perf"><span class="pc-perf-label">表演者</span><span class="pc-perf-text"></span></div>'
  + '<div class="pc-desc"></div>'
  + '<div class="pc-next"><span class="pc-next-label"></span><span class="pc-next-name"></span></div>'
  + '</div></div>';

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

const text = (value) => String(value ?? '').trim();

/** 当前节目与下一个节目：优先读节目资料库（items / selectedId），旧设置没有资料库时用 current / next。 */
export function programContent(program) {
  const items = Array.isArray(program.items) ? program.items : [];
  const index = items.findIndex(({ id }) => id === program.selectedId);
  const item = index >= 0 ? items[index] : null;
  const following = index >= 0 ? items[index + 1] : null;
  return {
    label: text(program.label),
    nextLabel: text(program.nextLabel),
    number: text(item?.number),
    type: text(item?.type),
    title: text(item ? item.title : program.current),
    performer: text(item?.performer),
    desc: text(item?.desc),
    next: text(item ? following?.title : program.next),
  };
}

function setText(element, value) {
  if (element.textContent !== value) element.textContent = value;
  element.hidden = !value;
}

/** 长节目名先缩小字号（最小 25.5px），仍放不下再显示省略号。 */
function fitTitle(title) {
  title.style.fontSize = '';
  if (!title.clientWidth) return;
  let size = parseFloat(getComputedStyle(title).fontSize);
  while (size > TITLE_MIN && title.scrollWidth > title.clientWidth + 1) {
    size -= 1.5;
    title.style.fontSize = `${size}px`;
  }
}

export function createProgramRenderer(container) {
  installStyles();
  const layer = createModuleLayer(container, { className: 'program-board', bodyHTML: TICKET_HTML });
  const { element, body } = layer;
  const $ = (selector) => body.querySelector(selector);
  const ticket = {
    card: $('.pc'), head: $('.pc-head'), label: $('.pc-label'), type: $('.pc-type'),
    num: $('.pc-num'), numText: $('.pc-num-text'), title: $('.pc-title'),
    perf: $('.pc-perf'), perfText: $('.pc-perf-text'), desc: $('.pc-desc'),
    next: $('.pc-next'), nextLabel: $('.pc-next-label'), nextName: $('.pc-next-name'),
  };
  let shown = false;
  let lastSignature = '';
  let module;

  function getPositionLimits() {
    const { width, height } = layer.getBounds();
    return {
      minX: 0, maxX: Math.max(0, Math.floor(1920 - width)),
      minY: 0, maxY: Math.max(0, Math.floor(1080 - height)),
    };
  }

  function place(constrain) {
    if (!module) return;
    let { x, y } = module;
    if (constrain) {
      const limits = getPositionLimits();
      x = Math.min(limits.maxX, Math.max(limits.minX, x));
      y = Math.min(limits.maxY, Math.max(limits.minY, y));
    }
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
  }

  function refit() {
    const wasHidden = element.hidden;
    if (wasHidden) element.hidden = false;
    fitTitle(ticket.title);
    if (wasHidden) element.hidden = true;
    place(true);
  }
  document.fonts?.ready.then(refit);

  return {
    element,
    body,
    getPositionLimits,
    update(program, { animate = true, constrain = true } = {}) {
      module = program;
      const content = programContent(program);
      const visible = program.visible && Boolean(content.title || content.next);
      layer.update({ ...program, visible });
      setText(ticket.label, content.label);
      setText(ticket.type, content.type);
      ticket.head.hidden = !content.label && !content.type;
      ticket.numText.textContent = content.number;
      ticket.num.classList.toggle('is-empty', !content.number);
      setText(ticket.title, content.title);
      setText(ticket.perfText, content.performer);
      ticket.perf.hidden = !content.performer;
      setText(ticket.desc, content.desc);
      setText(ticket.nextLabel, content.nextLabel);
      setText(ticket.nextName, content.next);
      ticket.next.hidden = !content.next;
      ticket.card.classList.toggle('no-next', !content.next);
      const last = [ticket.desc, ticket.perf, ticket.title].find((row) => !row.hidden) ?? ticket.title;
      for (const row of [ticket.title, ticket.perf, ticket.desc]) row.classList.toggle('is-last', row === last);
      refit();
      if (!constrain) place(false);

      const signature = JSON.stringify([content.title, content.next, content.number]);
      if (signature !== lastSignature && lastSignature && shown && visible && animate) {
        ticket.card.getAnimations().forEach((animation) => animation.cancel());
        ticket.card.animate([
          { opacity: .3, transform: 'translateY(5px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ], { duration: 240, easing: 'ease-out' });
      }
      lastSignature = signature;
      shown = visible;
      element.setAttribute('aria-label', [content.label, content.title, content.nextLabel, content.next].filter(Boolean).join(' · ') || '节目单');
    },
    getBounds: () => layer.getBounds(),
  };
}
