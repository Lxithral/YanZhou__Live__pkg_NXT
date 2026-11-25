import { createModuleLayer, moduleMotionInsets } from '../core/module-layer.js';
import { stageSafeArea } from '../core/stage-area.js';
import { PERF_SCROLL, scrollPlan, startDelay, scrollKeyframes } from '../motion/perf-scroll.js';
import { INTRO_SCROLL, introSpeed, introPlan, introBar, introKeyframes } from '../motion/intro-scroll.js';

const STYLE_ID = 'yanzhou-program-renderer-style';

// 票根卡整体按旧版 75% 的尺寸排版：滑块 100% = 旧版 75%。
const TITLE_MIN = 25.5;
const TEAR_CLEARANCE = { right: 82, bottom: 72 };

// 纵向位置（%）与撕线两侧的缺口宽度（px）。
const TEAR_EDGE = [
  [0, 0], [9, 0], [12, 1.8], [16, .4], [20, 0], [25, 3], [29, .8],
  [33, 0], [39, 2.2], [43, 0], [48, .4], [53, 3.3], [57, .7], [61, 0],
  [67, 2.6], [71, 0], [77, .5], [82, 2.6], [87, 0], [94, 1.1], [100, 0],
];
const DETACH_AT = .66;
const TEAR_TIME = 1080;
const RESTORE_TIME = 820;
const unit = (value) => Math.max(0, Math.min(1, value));
const smoothstep = (value) => value * value * (3 - 2 * value);

function edgeUntil(front) {
  if (front === 0) return [TEAR_EDGE[0]];
  const next = TEAR_EDGE.findIndex(([y]) => y >= front);
  const [lastY, lastInset] = TEAR_EDGE[next - 1];
  const [nextY, nextInset] = TEAR_EDGE[next];
  const inset = lastInset + (nextInset - lastInset) * (front - lastY) / (nextY - lastY);
  return [...TEAR_EDGE.slice(0, next), [front, inset]];
}

function paperClip(edge) {
  const points = edge.map(([y, inset]) => `calc(100% - ${inset}px) ${y}%`);
  return `polygon(0 0, ${points.join(', ')}, 100% ${edge.at(-1)[0]}%, 100% 100%, 0 100%)`;
}

function paintTear({ paper, num, flap, flapPaper }, progress, height) {
  const front = 100 * smoothstep(unit(progress / DETACH_AT));
  const edge = edgeUntil(front);
  paper.style.clipPath = paperClip(edge);
  num.style.clipPath = `inset(${front}% 0 0)`;
  const flapEdge = edge.reverse().map(([y, inset]) => `${inset * .65}px ${y}%`);
  flapPaper.style.clipPath = `polygon(100% 0, 100% ${front}%, ${flapEdge.join(', ')})`;

  // 缺口下方留在原位，纸片从缺口处逐渐向右弯曲。最后一个齿孔松开后才开始下落。
  const lift = smoothstep(unit(progress / .38));
  const release = unit((progress - DETACH_AT) / (1 - DETACH_AT));
  const turn = smoothstep(release);
  const flutter = Math.sin(2 * Math.PI * release) * (1 - release);
  // 长节目会撑高票面，限制拐角扫过的距离，给局部预览留出余量。
  const bend = Math.min(12, 1360 / height) * lift * (1 - .8 * turn);
  const rotation = Math.min(13, 1900 / height) * (turn + .12 * flutter);
  const yaw = -23 * lift + 37 * turn + 6 * flutter;
  const drift = 35 * turn;
  const fall = 43 * release ** 2 - 3 * Math.sin(Math.PI * release) ** 2;
  flap.style.transformOrigin = `0 ${front}%`;
  flap.style.transform = `translate(${drift}px, ${fall}px) perspective(860px) rotate(${rotation}deg) rotateY(${yaw}deg) skewX(${-bend}deg)`;
  flap.style.opacity = 1 - smoothstep(unit((release - .23) / .77));
}

const STYLES = `
/* 票根 · 艺术节：绛红主票 + 米色存根，中间齿孔撕线；存根放序号和校徽 */
.pc-wrap { filter: drop-shadow(0 10.5px 19.5px #0007); }
.pc { box-sizing: border-box; position: relative; isolation: isolate; width: 510px; display: grid; grid-template-columns: minmax(0, 1fr) 112.5px; grid-template-areas: "head num" "title num" "perf num" "desc num" "next num"; grid-template-rows: auto auto auto 1fr auto; font-family: 'Microsoft YaHei', 'MiSans', sans-serif; line-height: 1.3; }
.pc-paper { grid-area: 1 / 1 / -1 / 2; z-index: -1; background: #6e2427; border-radius: 4.5px 0 0 4.5px; --pc-notch: 100%; }
.pc-paper, .pc-num {
  -webkit-mask: radial-gradient(circle 10.5px at var(--pc-notch) 0, #0000 98%, #000) top / 100% 51% no-repeat, radial-gradient(circle 10.5px at var(--pc-notch) 100%, #0000 98%, #000) bottom / 100% 51% no-repeat;
  mask: radial-gradient(circle 10.5px at var(--pc-notch) 0, #0000 98%, #000) top / 100% 51% no-repeat, radial-gradient(circle 10.5px at var(--pc-notch) 100%, #0000 98%, #000) bottom / 100% 51% no-repeat; }
.pc.is-torn:not(.is-tearing) .pc-paper { clip-path: ${paperClip(TEAR_EDGE)}; }
.pc.is-torn:not(.is-tearing) .pc-num { opacity: 0; pointer-events: none; }
.pc [hidden] { display: none !important; }
.pc-head { grid-area: head; display: flex; align-items: center; gap: 9px; padding: 19.5px 24px 0; white-space: nowrap; }
.pc-label { flex: none; padding: 2.25px 7.5px; border-radius: 2px; background: #f4ece0; color: #6e2427; font-size: 11.25px; font-weight: 700; letter-spacing: 2.25px; }
.pc-type { flex: none; padding: 2px 6.75px; border: 1px solid #f1d9bd66; color: #f1d9bd; font-size: 11.25px; font-weight: 700; }
.pc-title { grid-area: title; padding: 9px 24px 0; color: #fff8ee; font-size: 37.5px; font-weight: 700; white-space: nowrap; overflow: hidden; overflow-wrap: anywhere; }
.pc-perf { grid-area: perf; display: flex; gap: 10.5px; align-items: baseline; padding: 9px 24px 0; }
.pc-perf-label { flex: none; color: #e6c08a; font-size: 12px; font-weight: 700; letter-spacing: 2px; }
.pc-perf-text { display: block; min-width: 0; flex: 1 1 auto; color: #f3e7da; font-size: 15px; line-height: 1.5; max-height: ${15 * 1.5 * PERF_SCROLL.lines}px; overflow: hidden; }
.pc-perf-track, .pc-perf-copy { display: block; }
.pc-perf-copy + .pc-perf-copy { display: none; }
/* 放不下时：竖向无缝循环滚动，内容复制一份，两份之间留间隔，上下边缘渐隐 */
.pc-perf-text.is-scrolling { -webkit-mask: linear-gradient(to bottom, #0000, #000 ${PERF_SCROLL.fade}px, #000 calc(100% - ${PERF_SCROLL.fade}px), #0000); mask: linear-gradient(to bottom, #0000, #000 ${PERF_SCROLL.fade}px, #000 calc(100% - ${PERF_SCROLL.fade}px), #0000); }
.pc-perf-text.is-scrolling .pc-perf-track { will-change: transform; }
.pc-perf-text.is-scrolling .pc-perf-copy { padding-bottom: ${PERF_SCROLL.gap}px; }
.pc-perf-text.is-scrolling .pc-perf-copy + .pc-perf-copy { display: block; }
.pc-desc { grid-area: desc; align-self: start; position: relative; min-width: 0; margin: 7.5px 24px 0; }
/* 介绍：最多 3 行；放不下时按阅读速度竖向慢慢上滚，上下渐隐；右侧细竖条放在卡片原有的右侧留白里（离字 9px，不压字、不改变可视宽度和卡片高度），显示长度和进度 */
.pc-desc-view { max-height: ${INTRO_SCROLL.fontSize * INTRO_SCROLL.lineHeight * INTRO_SCROLL.lines}px; overflow: hidden; color: #f3e7dab3; font-size: ${INTRO_SCROLL.fontSize}px; line-height: ${INTRO_SCROLL.lineHeight}; }
.pc-desc-track { display: block; }
.pc-desc.is-scrolling .pc-desc-view { -webkit-mask: linear-gradient(to bottom, #0000, #000 ${INTRO_SCROLL.fade}px, #000 calc(100% - ${INTRO_SCROLL.fade}px), #0000); mask: linear-gradient(to bottom, #0000, #000 ${INTRO_SCROLL.fade}px, #000 calc(100% - ${INTRO_SCROLL.fade}px), #0000); }
.pc-desc.is-scrolling .pc-desc-track, .pc-desc.is-scrolling .pc-desc-thumb { will-change: transform, opacity; }
.pc-desc-bar { position: absolute; top: 0; bottom: 0; right: -11px; width: 2px; border-radius: 1px; background: #fff8ee24; overflow: hidden; visibility: hidden; }
.pc-desc.is-scrolling .pc-desc-bar { visibility: visible; }
.pc-desc-thumb { position: absolute; left: 0; right: 0; top: 0; border-radius: 1px; background: #fff8eebf; }
.pc-next { grid-area: next; display: flex; align-items: baseline; gap: 9px; margin: 13.5px 24px 0; padding: 10.5px 0 13.5px; border-top: 1px dashed #ffffff3d; color: #fff; font-size: 14.25px; }
.pc-next-label { flex: none; color: #e6c08a; font-weight: 700; }
.pc-next-name { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pc.no-next .is-last { margin-bottom: 19.5px; }
.pc-num { grid-area: num; display: flex !important; flex-direction: column; align-items: center; justify-content: center; gap: 3px; background: #f4ece0; border-left: 2px dashed #6e242766; border-radius: 0 4.5px 4.5px 0; color: #6e2427; font-family: 'MiSans', sans-serif; font-size: 48px; font-weight: 600; line-height: 1; --pc-notch: 0%; }
.pc-num::before { content: "节目"; font-family: 'Microsoft YaHei', 'MiSans', sans-serif; font-size: 11.25px; font-weight: 700; letter-spacing: 4.5px; opacity: .7; }
.pc-num.is-empty::before { content: none; }
.pc-num::after { content: ""; width: 55.5px; height: 55.5px; margin-top: 10.5px; background: url('/assets/yanzhou-watermark.png') center/contain no-repeat; opacity: .55; filter: saturate(.6); }
.pc-num.is-empty::after { width: 72px; height: 72px; margin: 0; opacity: .7; }
.pc-flap { display: none; grid-area: num; position: relative; z-index: 1; pointer-events: none; filter: drop-shadow(2px 3px 4px #290e1044); }
.pc.is-tearing .pc-flap { display: block; }
.pc-flap .pc-num { position: absolute; inset: 0; border-left-color: transparent; background-image: linear-gradient(115deg, #a2633c20, #fff7 36%, #fff0 67%, #8e524619); }
`;

const STUB_HTML = '<div class="pc-num"><span class="pc-num-text"></span></div>';
const TICKET_HTML = '<div class="pc-wrap"><div class="pc">'
  + '<div class="pc-paper" aria-hidden="true"></div>'
  + '<div class="pc-head"><span class="pc-label"></span><span class="pc-type"></span></div>'
  + STUB_HTML
  + '<div class="pc-flap" aria-hidden="true">' + STUB_HTML + '</div>'
  + '<div class="pc-title"></div>'
  + '<div class="pc-perf"><span class="pc-perf-label">表演者</span><span class="pc-perf-text"><span class="pc-perf-track"><span class="pc-perf-copy"></span><span class="pc-perf-copy" aria-hidden="true"></span></span></span></div>'
  + '<div class="pc-desc"><div class="pc-desc-view"><span class="pc-desc-track"></span></div><div class="pc-desc-bar"><span class="pc-desc-thumb"></span></div></div>'
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

/** 滚动内容的身份。节目编号算在里面：换节目即使演出者、介绍一字不差，也从头滚。 */
export function programScrollKey(selectedId, text) {
  return `${selectedId ?? ''}\u0000${text}`;
}

/** 下屏后的停止计时只安排一次。后面的状态回声不能把停止时间往后推。 */
export function shouldArmScrollExit({ visible, shown, running, exitArmed }) {
  return !visible && !exitArmed && Boolean(shown || running);
}

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

/** 长节目名先缩小字号（最小 25.5px），仍放不下则换行完整显示。 */
function fitTitle(title) {
  title.style.fontSize = '';
  title.style.whiteSpace = '';
  if (!title.clientWidth) return;
  let size = parseFloat(getComputedStyle(title).fontSize);
  while (size > TITLE_MIN && title.scrollWidth > title.clientWidth + 1) {
    size -= 1.5;
    title.style.fontSize = `${size}px`;
  }
  if (title.scrollWidth > title.clientWidth + 1) title.style.whiteSpace = 'normal';
}

export function createProgramRenderer(container) {
  installStyles();
  const layer = createModuleLayer(container, { className: 'program-board', bodyHTML: TICKET_HTML });
  const { element, body } = layer;
  const $ = (selector) => body.querySelector(selector);
  const ticket = {
    card: $('.pc'), paper: $('.pc-paper'), head: $('.pc-head'), label: $('.pc-label'), type: $('.pc-type'),
    num: $('.pc-num'), numText: $('.pc-num-text'), flap: $('.pc-flap'),
    flapPaper: $('.pc-flap .pc-num'), flapText: $('.pc-flap .pc-num-text'), title: $('.pc-title'),
    perf: $('.pc-perf'), perfText: $('.pc-perf-text'), perfTrack: $('.pc-perf-track'),
    perfCopies: [...body.querySelectorAll('.pc-perf-copy')], desc: $('.pc-desc'),
    descView: $('.pc-desc-view'), descTrack: $('.pc-desc-track'), descBar: $('.pc-desc-bar'), descThumb: $('.pc-desc-thumb'),
    next: $('.pc-next'), nextLabel: $('.pc-next-label'), nextName: $('.pc-next-name'),
  };
  let shown = false;
  let lastSignature = '';
  let module;
  let firstUpdate = true;
  let constrained = true;
  let ticketCycle;
  let tornAt = null;
  let tearFrame = 0;
  let tearProgress = 0;
  let disposed = false;

  function finishTear() {
    cancelAnimationFrame(tearFrame);
    tearFrame = 0;
    tearProgress = tornAt === null ? 0 : 1;
    ticket.card.classList.remove('is-tearing');
    ticket.paper.style.clipPath = '';
    ticket.num.style.clipPath = '';
    ticket.flapPaper.style.clipPath = '';
    ticket.flap.removeAttribute('style');
  }

  function animateTear() {
    const target = tornAt === null ? 0 : 1;
    const start = tearProgress;
    const duration = (target ? TEAR_TIME : RESTORE_TIME) * Math.abs(target - start);
    if (!duration) {
      finishTear();
      return;
    }
    cancelAnimationFrame(tearFrame);
    const height = Math.max(1, ticket.num.offsetHeight);
    ticket.card.classList.add('is-tearing');
    paintTear(ticket, start, height);
    const started = performance.now();
    const step = (now) => {
      const elapsed = unit((now - started) / duration);
      if (elapsed === 1) {
        finishTear();
        return;
      }
      // 恢复或再次撕开时，从当前画面沿同一条轨迹继续。
      tearProgress = start + (target - start) * elapsed;
      paintTear(ticket, tearProgress, height);
      tearFrame = requestAnimationFrame(step);
    };
    tearFrame = requestAnimationFrame(step);
  }

  function updateTicket(state, { animate = false } = {}) {
    const next = Number.isFinite(state?.tornAt) ? state.tornAt : null;
    const sameCycle = ticketCycle === state?.cycle;
    if (sameCycle && next === tornAt) return;
    const shouldAnimate = animate && sameCycle && (tornAt === null) !== (next === null) && shown &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches;
    ticketCycle = state?.cycle;
    tornAt = next;
    ticket.card.classList.toggle('is-torn', tornAt !== null);
    ticket.num.setAttribute('aria-hidden', String(tornAt !== null));
    if (shouldAnimate) animateTear();
    else finishTear();
  }
  // 滚动器：表演者（竖向无缝循环）和介绍（竖向上滚 + 右侧竖条）共用同一套生命周期：
  // 只在内容 / 显隐 / 字体变化时重新测量；key = 文本 + 测量结果，结果不变就不打断正在进行的动画。
  function createScroller({ host, measure, start }) {
    const state = { text: '', identity: '', key: '', measured: false, animations: [], stopTimer: 0 };
    const stop = () => {
      clearTimeout(state.stopTimer);
      state.stopTimer = 0;
      for (const animation of state.animations) animation.cancel();
      state.animations = [];
      state.key = '';
      state.measured = false;
      host.classList.remove('is-scrolling');
    };
    const sync = ({ restart = false, delay = PERF_SCROLL.pause } = {}) => {
      if (element.hidden || !state.text || host.closest('[hidden]')) { stop(); return; }
      // offsetWidth / offsetHeight 不受外层 scale 影响，缩放模块不会改变测量结果。
      const plan = measure();
      const key = plan ? `${state.text}|${plan.key}` : '';
      if (!restart && key === state.key && (!plan || state.animations.length)) { state.measured = true; return; }
      stop();
      state.measured = true;
      if (!plan) return;
      state.key = key;
      host.classList.add('is-scrolling');
      state.animations = start(plan, delay);
    };
    return { state, stop, sync };
  }

  /** 表演者：超出 2 行就在原区域里竖向无缝循环滚动。 */
  const perfScroller = createScroller({
    host: ticket.perfText,
    measure() {
      const scrolling = ticket.perfText.classList.contains('is-scrolling');
      const contentHeight = ticket.perfCopies[0].offsetHeight - (scrolling ? PERF_SCROLL.gap : 0);
      const viewportHeight = parseFloat(getComputedStyle(ticket.perfText).maxHeight) || 45;
      const plan = scrollPlan({ contentHeight, viewportHeight });
      return plan && { ...plan, key: plan.distance };
    },
    start: (plan, delay) => [ticket.perfTrack.animate(scrollKeyframes(plan.distance),
      { duration: plan.duration, delay, iterations: Infinity, easing: 'linear' })],
  });

  /** 介绍：3 行放不下就按阅读速度竖向上滚到文末，停一下，淡出回到开头；右侧竖条同步显示长度和进度。 */
  const introScroller = createScroller({
    host: ticket.desc,
    measure() {
      const contentHeight = ticket.descTrack.offsetHeight;
      const viewportHeight = parseFloat(getComputedStyle(ticket.descView).maxHeight) || 70.5;
      const viewportWidth = ticket.descView.clientWidth;
      const plan = introPlan({ contentHeight, viewportHeight, speed: introSpeed({ viewportWidth }) });
      if (!plan) return null;
      const bar = introBar({ contentHeight, viewportHeight, barLength: viewportHeight });
      return { ...plan, bar, key: `${plan.distance}|${bar.thumb}` };
    },
    start(plan, delay) {
      ticket.descThumb.style.height = `${plan.bar.thumb}px`;
      const frames = introKeyframes(plan, plan.bar.travel);
      const timing = { duration: plan.total, delay, iterations: Infinity, easing: 'linear' };
      return [ticket.descTrack.animate(frames.track, timing), ticket.descThumb.animate(frames.thumb, timing)];
    },
  });
  const scrollers = [perfScroller, introScroller];

  function getPlacementArea({ width, height } = layer.getBounds()) {
    const area = stageSafeArea();
    const scale = module?.scale ?? 1;
    const { left, right, top, bottom } = moduleMotionInsets(module?.animation);
    const nudge = Math.min(4 * scale, Math.max(0, area.bottom - area.top - height));
    const x = Math.min(1, Math.max(0, area.right - area.left - width) / ((left + right) * scale || 1));
    const y = Math.min(1, Math.max(0, area.bottom - area.top - height - nudge) / ((top + bottom) * scale || 1));
    return { left: area.left + left * scale * x, right: area.right - right * scale * x,
      top: area.top + top * scale * y, bottom: area.bottom - bottom * scale * y - nudge, motionX: x, motionY: y, nudge };
  }

  function getPositionLimits() {
    const bounds = layer.getBounds();
    const area = getPlacementArea(bounds);
    const maxX = Math.max(0, Math.floor(area.right - bounds.width));
    const maxY = Math.max(0, Math.floor(area.bottom - bounds.height));
    return { minX: Math.min(Math.ceil(area.left), maxX), maxX, minY: Math.min(Math.ceil(area.top), maxY), maxY };
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
    if (constrained) {
      const { motionX, motionY } = getPlacementArea();
      body.style.setProperty('--module-motion-x', motionX);
      body.style.setProperty('--module-motion-y', motionY);
    }
    place(constrained);
  }
  document.fonts?.ready.then(() => { if (!disposed) { refit(); if (shown) scrollers.forEach((s) => s.sync()); } });

  return {
    element,
    body,
    getPositionLimits,
    getPlacementArea,
    getTearClearance() {
      const scale = module?.scale ?? 1;
      return { right: TEAR_CLEARANCE.right * scale, bottom: TEAR_CLEARANCE.bottom * scale };
    },
    updateTicket,
    dispose() {
      disposed = true;
      cancelAnimationFrame(tearFrame);
      scrollers.forEach((scroller) => scroller.stop());
      element.remove();
    },
    update(program, { animate = true, constrain = true } = {}) {
      module = program;
      constrained = constrain;
      const content = programContent(program);
      const visible = program.visible && Boolean(content.title || content.next);
      if (!visible && tearFrame) finishTear();
      layer.update({ ...program, visible });
      setText(ticket.label, content.label);
      setText(ticket.type, content.type);
      ticket.head.hidden = !content.label && !content.type;
      if (ticket.numText.textContent !== content.number) {
        ticket.numText.textContent = content.number;
        ticket.flapText.textContent = content.number;
      }
      const noNumber = !content.number;
      ticket.num.classList.toggle('is-empty', noNumber);
      ticket.flapPaper.classList.toggle('is-empty', noNumber);
      setText(ticket.title, content.title);
      const perfKey = programScrollKey(program.selectedId, content.performer);
      const perfChanged = perfKey !== perfScroller.state.identity;
      if (perfChanged) {
        for (const copy of ticket.perfCopies) copy.textContent = content.performer;
        perfScroller.state.text = content.performer;
        perfScroller.state.identity = perfKey;
      }
      ticket.perf.hidden = !content.performer;
      const descKey = programScrollKey(program.selectedId, content.desc);
      const descChanged = descKey !== introScroller.state.identity;
      if (descChanged) {
        ticket.descTrack.textContent = content.desc;
        introScroller.state.text = content.desc;
        introScroller.state.identity = descKey;
      }
      ticket.desc.hidden = !content.desc;
      setText(ticket.nextLabel, content.nextLabel);
      setText(ticket.nextName, content.next);
      ticket.next.hidden = !content.next;
      ticket.card.classList.toggle('no-next', !content.next);
      const last = [ticket.desc, ticket.perf, ticket.title].find((row) => !row.hidden) ?? ticket.title;
      for (const row of [ticket.title, ticket.perf, ticket.desc]) row.classList.toggle('is-last', row === last);
      refit();

      // 表演者 / 介绍滚动：上屏就一直滚；刚入场先等入场动画 + 停顿；切节目 / 内容变化从头开始；下屏放完退场后停止。
      const entering = visible && !shown;
      const animation = program.animation ?? {};
      for (const [scroller, changed] of [[perfScroller, perfChanged], [introScroller, descChanged]]) {
        const { state } = scroller;
        if (visible) {
          clearTimeout(state.stopTimer);
          state.stopTimer = 0;
          if (entering || changed) {
            scroller.sync({ restart: true, delay: startDelay({ entering: entering && !firstUpdate, enter: animation.enter, duration: animation.duration }) });
          } else if (!state.measured) scroller.sync();
        } else if (shouldArmScrollExit({
          visible, shown, running: state.animations.length > 0, exitArmed: Boolean(state.stopTimer),
        })) {
          const exitTime = animation.exit && animation.exit !== 'none' ? (Number(animation.duration) || 0) + 40 : 0;
          state.stopTimer = setTimeout(scroller.stop, exitTime);
        }
      }
      firstUpdate = false;

      const signature = JSON.stringify([content.title, content.next, content.number]);
      if (signature !== lastSignature && lastSignature && shown && visible && animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        ticket.card.getAnimations().forEach((animation) => animation.cancel());
        ticket.card.animate([
          { transform: 'translateY(' + (constrain ? getPlacementArea().nudge / program.scale : 4) + 'px)' },
          { transform: 'translateY(0)' },
        ], { duration: 240, easing: 'ease-out' });
      }
      lastSignature = signature;
      shown = visible;
      element.setAttribute('aria-label', [content.label, content.title, content.nextLabel, content.next].filter(Boolean).join(' · ') || '节目单');
    },
    getBounds: () => layer.getBounds(),
  };
}
