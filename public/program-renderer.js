import { createModuleLayer } from './module-layer.js';
import { PERF_SCROLL, scrollPlan, startDelay, scrollKeyframes } from './perf-scroll.js';
import { INTRO_SCROLL, introSpeed, introPlan, introBar, introKeyframes } from './intro-scroll.js';

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
    perf: $('.pc-perf'), perfText: $('.pc-perf-text'), perfTrack: $('.pc-perf-track'),
    perfCopies: [...body.querySelectorAll('.pc-perf-copy')], desc: $('.pc-desc'),
    descView: $('.pc-desc-view'), descTrack: $('.pc-desc-track'), descBar: $('.pc-desc-bar'), descThumb: $('.pc-desc-thumb'),
    next: $('.pc-next'), nextLabel: $('.pc-next-label'), nextName: $('.pc-next-name'),
  };
  let shown = false;
  let lastSignature = '';
  let module;
  let firstUpdate = true;
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
  document.fonts?.ready.then(() => { refit(); if (shown) scrollers.forEach((s) => s.sync()); });

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
      if (!constrain) place(false);

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
          { transform: 'translateY(4px)' },
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
