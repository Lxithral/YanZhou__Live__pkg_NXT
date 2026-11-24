export const AVOID_GAP = 16;
export const CANVAS = { width: 1920, height: 1080 };

const CORNER_MODULES = ['logo', 'eventMark'];
const CAPTION_MODULES = ['lyrics', 'speech'];

const overlaps = (a, b, gap) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
const shifted = (rects, dx, dy) => rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
const hits = (rects, placed, gap) => rects.some((r) => placed.some((p) => overlaps(r, p, gap)));
const occupiedRects = (rects) => rects.filter((r) => r && r.w > 0 && r.h > 0);

function coveredArea(rects, placed) {
  let area = 0;
  for (const a of rects) {
    for (const b of placed) {
      const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      area += w * h;
    }
  }
  return area;
}

function axisBounds(rects, axis, size, start, end) {
  const near = Math.min(...rects.map((r) => r[axis]));
  const far = Math.max(...rects.map((r) => r[axis] + r[size]));
  const min = start - near;
  const max = end - far;
  if (min <= max) return [min, max];
  const aligned = axis === 'y' ? max : (min + max) / 2;
  return [aligned, aligned];
}

/** 取画布边界和矩形边缘对齐的位置，包含紧贴以及留出间距的候选点。 */
function axisCandidates(rects, placed, axis, size, [min, max], gap) {
  const nearest = Math.min(max, Math.max(min, 0));
  const values = new Set([nearest, min, max]);
  for (const r of rects) {
    for (const p of placed) {
      const before = p[axis] - r[axis] - r[size];
      const after = p[axis] + p[size] - r[axis];
      for (const value of [before - gap, before, p[axis] - r[axis], after - r[size], after, after + gap]) {
        if (value >= min && value <= max) values.add(value);
      }
    }
  }
  return { nearest, values };
}

function betterScore(score, best) {
  const firstDifference = score.findIndex((value, i) => value !== best[i]);
  return firstDifference !== -1 && score[firstDifference] < best[firstDifference];
}

function findSpot(rects, placed, captions, { width, height, gap }) {
  const xs = axisCandidates(rects, placed, 'x', 'w', axisBounds(rects, 'x', 'w', 0, width), gap);
  const ys = axisCandidates(rects, placed, 'y', 'h', axisBounds(rects, 'y', 'h', height / 2, height), gap);
  let best;
  for (const dy of ys.values) {
    for (const dx of xs.values) {
      const moved = shifted(rects, dx, dy);
      const overlap = coveredArea(moved, placed);
      const direction = dy === ys.nearest ? 0 : dx === xs.nearest ? 1 : 2;
      // 空间不足时先保护字幕。遮挡相同时，优先同排横移、留出间距和较短位移。
      const score = [
        overlap ? coveredArea(moved, captions) : 0,
        overlap,
        direction,
        !overlap && hits(moved, placed, gap) ? 1 : 0,
        dx ** 2 + dy ** 2,
        -dy,
      ];
      if (!best || betterScore(score, best.score)) best = { dx, dy, score };
    }
  }
  return { dx: best.dx, dy: best.dy };
}

function placeModules(ids, rectsById, fixed, canvas, forcedCaption) {
  const placed = [...fixed];
  const captions = [];
  const offsets = {};
  let captionOverlap = 0;
  let narrowCaptionGap = false;
  let totalOverlap = 0;
  for (const id of ids) {
    const rects = rectsById.get(id);
    const offset = forcedCaption?.id === id ? forcedCaption.offset :
      hits(rects, placed, 0) ? findSpot(rects, placed, captions, canvas) : { dx: 0, dy: 0 };
    offsets[id] = offset;
    const moved = shifted(rects, offset.dx, offset.dy);
    totalOverlap += coveredArea(moved, placed);
    placed.push(...moved);
    if (CAPTION_MODULES.includes(id)) captions.push(...moved);
    else {
      captionOverlap += coveredArea(moved, captions);
      narrowCaptionGap ||= hits(moved, captions, canvas.gap);
    }
  }
  return { offsets, captionOverlap, totalOverlap, narrowCaptionGap };
}

function improveCaptionRoom(id, otherIds, rectsById, fixed, canvas, initial) {
  const rects = rectsById.get(id);
  const { dx, dy } = initial.offsets[id];
  if ((!dx && !dy) || !initial.captionOverlap) return initial;

  // 字幕已离开原位但仍与其它模块重叠时，尝试在下半屏换一条能排开的高度。
  const minY = canvas.height / 2;
  const guides = [...fixed];
  for (const otherId of otherIds) {
    const other = rectsById.get(otherId);
    if (!other.length) continue;
    const [top, bottom] = axisBounds(other, 'y', 'h', minY, canvas.height);
    guides.push(...other, ...shifted(other, 0, top), ...shifted(other, 0, bottom));
  }
  const bounds = axisBounds(rects, 'y', 'h', minY, canvas.height);
  const { values } = axisCandidates(rects, guides, 'y', 'h', bounds, canvas.gap);
  const fixedOverlap = coveredArea(shifted(rects, dx, dy), fixed);
  let best = initial;
  let bestScore = [initial.captionOverlap, initial.totalOverlap, Number(initial.narrowCaptionGap), 0];
  for (const alternative of values) {
    if (alternative === dy || coveredArea(shifted(rects, dx, alternative), fixed) > fixedOverlap) continue;
    const offset = { dx, dy: alternative };
    const layout = placeModules([id, ...otherIds], rectsById, fixed, canvas, { id, offset });
    const score = [layout.captionOverlap, layout.totalOverlap, Number(layout.narrowCaptionGap), Math.abs(alternative - dy)];
    if (betterScore(score, bestScore)) {
      best = layout;
      bestScore = score;
    }
  }
  return best;
}

/**
 * 按保存位置计算临时偏移。角标固定，字幕先占位，其余模块按上屏顺序避让。
 * 只在实际重叠时调整；碰撞解除后偏移回到零。
 */
export function resolveAvoidance(boxes, order = [], { width = CANVAS.width, height = CANVAS.height, gap = AVOID_GAP, fixed = [] } = {}) {
  const ids = [...new Set([...order, ...Object.keys(boxes)])].filter((id) => Object.hasOwn(boxes, id));
  const rectsById = new Map(ids.map((id) => [id, occupiedRects(boxes[id])]));
  const obstacles = occupiedRects(fixed);
  const corners = ids.filter((id) => CORNER_MODULES.includes(id));
  for (const id of corners) obstacles.push(...rectsById.get(id));

  const movable = ids.filter((id) => !CORNER_MODULES.includes(id));
  const captionIds = movable.filter((id) => CAPTION_MODULES.includes(id));
  const otherIds = movable.filter((id) => !CAPTION_MODULES.includes(id));
  const canvas = { width, height, gap };
  const initial = placeModules([...captionIds, ...otherIds], rectsById, obstacles, canvas);
  const layout = captionIds.length === 1 ?
    improveCaptionRoom(captionIds[0], otherIds, rectsById, obstacles, canvas, initial) : initial;
  return {
    ...Object.fromEntries(corners.map((id) => [id, { dx: 0, dy: 0 }])),
    ...layout.offsets,
  };
}

/* ---------- 页面部分：量取模块实际尺寸并套用偏移 ---------- */

function offsetWithin(node, root) {
  let x = 0;
  let y = 0;
  for (let n = node; n && n !== root; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
  return { x, y };
}

function isVisibleContent(moduleId, renderer, module) {
  return module?.visible && !renderer.element.hidden &&
    (!CAPTION_MODULES.includes(moduleId) || renderer.element.dataset.hasContent === 'true');
}

/** 模块在画布上的占用矩形（不含避让偏移和出入场动画）。看不见的模块返回 null。 */
export function measureModule(moduleId, renderer, module) {
  const element = renderer.element;
  if (!isVisibleContent(moduleId, renderer, module)) return null;
  if (moduleId === 'logo') {
    const { width: w, height: h } = renderer.getBounds();
    return [{ x: element.offsetLeft, y: element.offsetTop, w, h }];
  }
  const scale = Number(module.scale) || 1;
  const target = moduleId === 'lyrics' ? element.querySelector('.lyrics-viewport') ?? renderer.body :
    moduleId === 'speech' ? element.querySelector('.speech-viewport') ?? renderer.body :
      moduleId === 'hosts' ? element.querySelector('.solo-name:not([hidden])') : renderer.body;
  if (!target) return null;
  const { x, y } = offsetWithin(target, element);
  return [{
    x: element.offsetLeft + x * scale,
    y: element.offsetTop + y * scale,
    w: target.offsetWidth * scale,
    h: target.offsetHeight * scale,
  }];
}

const STYLE_ID = 'yanzhou-stage-avoidance-style';
const CSS = `
.module-layer.avoid-animate { transition: translate 350ms cubic-bezier(.25, .8, .3, 1); }
.dragging .module-layer, .module-layer.avoid-still { transition: none !important; }
@media (prefers-reduced-motion: reduce) { .module-layer.avoid-animate { transition-duration: 1ms; } }
`;

/**
 * renderers: { moduleId: renderer }；getState() 返回 { settings, showOrder }。
 * schedule() 在下一帧统一量取（先全部读，再全部写，避免布局抖动）。freeze(true) 时保持当前偏移不变（拖动中）。
 */
export function createAvoidance(renderers, getState, { animate = true, fixedElements = [] } = {}) {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.append(style);
  }
  let frame = 0;
  let frozen = false;
  let offsets = {};
  let onScreen = new Set();
  const observer = new ResizeObserver(schedule);
  const visibilityObserver = new MutationObserver((records) => {
    if (records.some(({ target, attributeName, oldValue }) => target.getAttribute(attributeName) !== oldValue)) schedule();
  });
  for (const renderer of Object.values(renderers)) {
    if (animate) renderer.element.classList.add('avoid-animate');
    observer.observe(renderer.body ?? renderer.element);
    visibilityObserver.observe(renderer.element, { attributeOldValue: true, attributeFilter: ['hidden', 'data-has-content'] });
  }
  for (const element of fixedElements) observer.observe(element);
  document.fonts?.ready.then(() => schedule());

  function run() {
    frame = 0;
    if (frozen) return;
    const { settings, showOrder } = getState();
    if (!settings?.modules) return;
    const enabled = settings.layout?.autoAvoid !== false;
    const boxes = {};
    const fixed = fixedElements.map(({ offsetLeft: x, offsetTop: y, offsetWidth: w, offsetHeight: h }) => ({ x, y, w, h }));
    const exiting = new Set();
    if (enabled) {
      for (const [id, renderer] of Object.entries(renderers)) {
        const module = settings.modules[id];
        // 退场动画结束前保留当前偏移，并让正在退场的模块继续占位。
        if (module && !module.visible && !renderer.element.hidden) {
          const rects = measureModule(id, renderer, { ...module, visible: true });
          const { dx = 0, dy = 0 } = offsets[id] ?? {};
          if (rects) fixed.push(...shifted(rects, dx, dy));
          exiting.add(id);
          continue;
        }
        const rects = measureModule(id, renderer, module);
        if (rects) boxes[id] = rects;
      }
    }
    const previous = offsets;
    offsets = enabled ? resolveAvoidance(boxes, showOrder ?? Object.keys(renderers), { ...settings.canvas, fixed }) : {};
    for (const id of exiting) if (previous[id]) offsets[id] = previous[id];
    const appearing = [];
    for (const [id, renderer] of Object.entries(renderers)) {
      const { element } = renderer;
      if (exiting.has(id)) continue; // 淡出中的模块原样淡出，不改它的位移
      const { dx = 0, dy = 0 } = offsets[id] ?? {};
      const value = dx || dy ? `${dx}px ${dy}px` : '';
      // 刚出现（或隐藏中）的模块直接放到避让位置，不从原位滑过去。
      const still = element.hidden || !onScreen.has(id);
      if (still) element.classList.add('avoid-still');
      if (element.style.translate !== value) element.style.translate = value;
      element.toggleAttribute('data-avoiding', Boolean(value));
      if (still && !element.hidden) appearing.push(element);
    }
    onScreen = new Set(Object.keys(renderers).filter((id) =>
      enabled ? Object.hasOwn(boxes, id) : isVisibleContent(id, renderers[id], settings.modules[id])));
    if (appearing.length) {
      void appearing[0].offsetWidth;
      for (const element of appearing) element.classList.remove('avoid-still');
    }
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(run);
  }
  return {
    schedule,
    freeze(value) { frozen = value; if (!value) schedule(); },
    offsets: () => offsets,
    dispose() { observer.disconnect(); visibilityObserver.disconnect(); cancelAnimationFrame(frame); },
  };
}
