/**
 * 自动避让：上屏模块互相重叠时，后出现的模块让开，先出现的保持原位；人物条例外，总是由它横向靠拢让开。
 * 避让只是画面上的临时偏移（CSS translate），不会改写保存的位置；冲突消失后回到原位。
 * resolveAvoidance 是纯函数，OBS 输出页和主控台预览用同一份结果，测试也直接调用它。
 */
export const AVOID_GAP = 16;
/** 成对的人物条横向靠拢时，两条之间至少留的距离。 */
export const PAIR_GAP = 24;
/** 人物条横向靠拢时，和挡住它的模块（如节目卡）之间留的距离。 */
export const LEAN_GAP = 96;
/** 放不下时，和障碍的距离最多缩到这么小。 */
export const LEAN_MIN_GAP = 48;
/** 画面左右安全区（和主控台预览里的安全区虚线框一致）。 */
export const SAFE_X = 96;
export const CANVAS = { width: 1920, height: 1080 };

const overlaps = (a, b, gap) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
const shifted = (rects, dx, dy) => rects.map((r) => ({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }));
const hits = (rects, placed, gap) => rects.some((r) => placed.some((p) => overlaps(r, p, gap)));

function inside(rects, dx, dy, { width, height }) {
  return rects.every((r) => r.x + dx >= -0.5 && r.y + dy >= -0.5 && r.x + r.w + dx <= width + 0.5 && r.y + r.h + dy <= height + 0.5);
}

/** 一个方向上的候选位移：贴到每个已放置矩形的上下（或左右）边，并留出 gap。 */
function axisCandidates(rects, placed, gap, axis) {
  const values = new Set();
  for (const r of rects) {
    for (const p of placed) {
      if (axis === 'y') { values.add(p.y - gap - (r.y + r.h)); values.add(p.y + p.h + gap - r.y); }
      else { values.add(p.x - gap - (r.x + r.w)); values.add(p.x + p.w + gap - r.x); }
    }
  }
  return [...values].sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
}

/**
 * boxes: { [moduleId]: [{ x, y, w, h }, ...] }，按保存位置量出的占用区域（一个模块可有多块，例如左右两条人物条）。
 * order: 上屏先后顺序（先出现的在前）。不在 order 里的模块排在最后。
 * lean: 横向靠拢的模块（人物条）。不管谁先出现，都由它们在原来那一行往旁边靠，其他模块不动；
 *   这一行放不下时，才退回「后出现的让开」。
 * fixed: 固定障碍（例如正在淡出的模块），只参与避让、自己不动。
 * 返回 { [moduleId]: { dx, dy, parts? } }。
 */
export function resolveAvoidance(boxes, order = [], options = {}) {
  const ids = [...order.filter((id) => boxes[id]), ...Object.keys(boxes).filter((id) => !order.includes(id))];
  const lean = options.lean ?? [];
  const leanLast = [...ids.filter((id) => !lean.includes(id)), ...ids.filter((id) => lean.includes(id))];
  const first = solve(boxes, leanLast, options);
  const leanFailed = lean.some((id) => first[id] && !first[id].parts && (first[id].dx || first[id].dy));
  if (!leanFailed || leanLast.every((id, i) => id === ids[i])) return first;
  return solve(boxes, ids, options);
}

function solve(boxes, ids, { width = CANVAS.width, height = CANVAS.height, gap = AVOID_GAP, lean = [], pairGap = PAIR_GAP, leanGap = LEAN_GAP, leanMinGap = LEAN_MIN_GAP, safeX = SAFE_X, fixed = [] } = {}) {
  const canvas = { width, height };
  const placed = fixed.filter((r) => r && r.w > 0 && r.h > 0);
  const result = {};
  for (const id of ids) {
    const rects = (boxes[id] ?? []).filter((r) => r && r.w > 0 && r.h > 0);
    let offset = { dx: 0, dy: 0 };
    let moved = rects;
    if (rects.length && hits(rects, placed, 0)) {
      // 人物条这类成对模块：不上下跳，而是留在原来那一行，整体横向靠向没有障碍的一侧。
      const parts = lean.includes(id) ? leanSpot(rects, placed, leanGap, Math.min(leanGap, leanMinGap), pairGap, canvas, safeX) : null;
      if (parts) {
        offset = { dx: 0, dy: 0, parts };
        moved = rects.map((r, i) => ({ ...r, x: r.x + parts[i].dx }));
      } else {
        offset = findSpot(rects, placed, gap, canvas) ?? findSpot(rects, placed, 0, canvas) ?? offset;
        moved = shifted(rects, offset.dx, offset.dy);
      }
    }
    result[id] = offset;
    placed.push(...moved);
  }
  return result;
}

/**
 * 横向靠拢：人物条保持原来的 Y，整组往没有障碍的一侧平移（两条之间的距离不变），和障碍留 gap。
 * 整组平移会越过画面安全区时，先把外侧那条停在安全区边上，再缩小两条之间的距离（至少 pairGap）；
 * 还放不下，就把和障碍的距离从 gap 逐步减到 minGap；仍不行返回 null（退回普通避让）。
 * 先试往左靠，再试往右靠，取总位移小的。
 */
function leanSpot(rects, placed, gap, minGap, pairGap, canvas, safeX) {
  const gaps = [];
  for (let g = gap; g > minGap; g -= 8) gaps.push(g);
  gaps.push(minGap);
  for (const g of gaps) {
    let best = null;
    for (const dir of [-1, 1]) {
      const xs = leanPack(rects, placed, g, pairGap, canvas, safeX, dir);
      if (!xs) continue;
      const cost = rects.reduce((sum, r, i) => sum + Math.abs(xs[i] - r.x), 0);
      if (!best || cost < best.cost) best = { cost, parts: rects.map((r, i) => ({ dx: xs[i] - r.x, dy: 0 })) };
    }
    if (best) return best.parts;
  }
  return null;
}

function leanPack(rects, placed, gap, pairGap, canvas, safeX, dir) {
  // 安全区边：画面左右各 safeX；原本就在安全区外的，以原位置为界。
  const edgeL = Math.min(safeX, ...rects.map((r) => r.x));
  const edgeR = Math.max(canvas.width - safeX, ...rects.map((r) => r.x + r.w));
  // 1. 整组平移：找到最小的整体位移，使每条都和障碍留出 gap。
  let shift = 0;
  for (let guard = 0; guard <= placed.length * rects.length; guard++) {
    let next = shift;
    for (const r of rects) for (const p of placed) {
      if (!overlaps({ ...r, x: r.x + shift }, p, gap)) continue;
      const need = dir < 0 ? p.x - gap - r.w - r.x : p.x + p.w + gap - r.x;
      next = dir < 0 ? Math.min(next, need) : Math.max(next, need);
    }
    if (next === shift) break;
    shift = next;
  }
  // 2. 外侧那条不越过安全区边。
  const outer = dir < 0 ? Math.min(...rects.map((r) => r.x)) : Math.max(...rects.map((r) => r.x + r.w));
  shift = dir < 0 ? Math.max(shift, Math.min(0, edgeL - outer)) : Math.min(shift, Math.max(0, edgeR - outer));
  // 3. 从靠近障碍的一侧逐条往外推：仍碰到障碍的推到障碍旁，块与块之间至少留 pairGap。
  const order = rects.map((_, i) => i).sort((a, b) => dir < 0 ? rects[b].x - rects[a].x : rects[a].x - rects[b].x);
  const xs = rects.map((r) => r.x + shift);
  let limit = dir < 0 ? Infinity : -Infinity;
  for (const i of order) {
    const r = rects[i];
    let x = dir < 0 ? Math.min(xs[i], limit - r.w) : Math.max(xs[i], limit);
    for (let guard = 0; guard < placed.length + 1; guard++) {
      const blocker = placed.find((p) => overlaps({ ...r, x }, p, gap));
      if (!blocker) break;
      x = dir < 0 ? blocker.x - gap - r.w : blocker.x + blocker.w + gap;
    }
    xs[i] = x;
    limit = dir < 0 ? x - pairGap : x + r.w + pairGap;
  }
  const moved = rects.map((r, i) => ({ ...r, x: xs[i] }));
  const fits = moved.every((r) => r.x >= edgeL - 0.5 && r.x + r.w <= edgeR + 0.5) && inside(moved, 0, 0, canvas) && !hits(moved, placed, gap);
  return fits ? xs : null;
}

function findSpot(rects, placed, gap, canvas) {
  const valid = (dx, dy) => inside(rects, dx, dy, canvas) && !hits(shifted(rects, dx, dy), placed, gap);
  // 1. 先试上下移动（位移最小的优先）。
  const ys = axisCandidates(rects, placed, gap, 'y');
  for (const dy of ys) if (valid(0, dy)) return { dx: 0, dy };
  // 2. 再试左右移动。
  const xs = axisCandidates(rects, placed, gap, 'x');
  for (const dx of xs) if (valid(dx, 0)) return { dx, dy: 0 };
  // 3. 都不行时斜向移动，取直线距离最短的位置。
  let best = null;
  for (const dy of ys) for (const dx of xs) {
    if ((!best || Math.hypot(dx, dy) < Math.hypot(best.dx, best.dy)) && valid(dx, dy)) best = { dx, dy };
  }
  return best;
}

/* ---------- 页面部分：量取模块实际尺寸并套用偏移 ---------- */

function offsetWithin(node, root) {
  let x = 0;
  let y = 0;
  for (let n = node; n && n !== root; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
  return { x, y };
}

/** 模块在画布上的占用矩形（不含避让偏移和出入场动画）。看不见的模块返回 null。 */
export function measureModule(moduleId, renderer, module) {
  const element = renderer.element;
  if (!module?.visible || element.hidden) return null;
  if (['lyrics', 'speech'].includes(moduleId) && element.dataset.hasContent !== 'true') return null;
  if (moduleId === 'logo') {
    const { width: w, height: h } = renderer.getBounds();
    return [{ x: element.offsetLeft, y: element.offsetTop, w, h }];
  }
  const scale = Number(module.scale) || 1;
  const rect = (node, fit = 1, anchorRight = false) => {
    const { x, y } = offsetWithin(node, element);
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    // 人物条按 transform-origin（左下或右下）整体缩小，补上缩小后空出的位置。
    const left = x + (anchorRight ? w * (1 - fit) : 0);
    const top = y + h * (1 - fit);
    return { x: element.offsetLeft + left * scale, y: element.offsetTop + top * scale, w: w * fit * scale, h: h * fit * scale };
  };
  if (moduleId === 'hosts') {
    const plate = element.querySelector('.solo-name:not([hidden])');
    if (plate) return [rect(plate)];
    const rects = [];
    const nodes = [];
    for (const content of element.querySelectorAll('.host-slot:not([hidden]) > .slot-content[aria-hidden=false]')) {
      const visual = content.querySelector('.host-visual');
      if (!visual) continue;
      const fit = Number(/scale\(([\d.]+)\)/u.exec(visual.style.transform)?.[1] ?? 1);
      rects.push(rect(visual, fit, content.parentElement.classList.contains('is-right')));
      nodes.push(content);
    }
    rects.nodes = nodes;
    return rects.length ? rects : null;
  }
  const target = moduleId === 'lyrics' ? element.querySelector('.lyrics-viewport') ?? renderer.body :
    moduleId === 'speech' ? element.querySelector('.speech-viewport') ?? renderer.body : renderer.body;
  return [rect(target)];
}

const STYLE_ID = 'yanzhou-stage-avoidance-style';
const CSS = `
.module-layer.avoid-animate, .module-layer.avoid-animate .slot-content { transition: translate 350ms cubic-bezier(.25, .8, .3, 1); }
.dragging .module-layer, .dragging .module-layer .slot-content, .module-layer.avoid-still, .module-layer.avoid-still .slot-content { transition: none !important; }
@media (prefers-reduced-motion: reduce) { .module-layer.avoid-animate, .module-layer.avoid-animate .slot-content { transition-duration: 1ms; } }
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
  const observer = new ResizeObserver(() => schedule());
  // 退场动画放完、模块真正隐藏时重新计算（时长取模块自己的退场设置）。
  const hiddenObserver = new MutationObserver(() => schedule());
  for (const renderer of Object.values(renderers)) {
    if (animate) renderer.element.classList.add('avoid-animate');
    observer.observe(renderer.body ?? renderer.element);
    hiddenObserver.observe(renderer.element, { attributes: true, attributeFilter: ['hidden'] });
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
    const partNodes = {};
    const fixed = fixedElements.map(({ offsetLeft: x, offsetTop: y, offsetWidth: w, offsetHeight: h }) => ({ x, y, w, h }));
    const exiting = new Set();
    if (enabled) {
      for (const [id, renderer] of Object.entries(renderers)) {
        const module = settings.modules[id];
        // 正在淡出的模块（已关闭显示、退场动画还没放完）：保持当前位置，仍算作障碍，
        // 等它完全消失后，被它挡住的人物条才滑回原位；途中重新显示则照常保持避让。
        if (module && !module.visible && !renderer.element.hidden) {
          const rects = measureModule(id, renderer, { ...module, visible: true });
          const { dx = 0, dy = 0 } = offsets[id] ?? {};
          if (rects) fixed.push(...shifted(rects, dx, dy));
          exiting.add(id);
          continue;
        }
        const rects = measureModule(id, renderer, module);
        if (rects) { boxes[id] = rects; partNodes[id] = rects.nodes ?? []; }
      }
    }
    const previous = offsets;
    offsets = enabled ? resolveAvoidance(boxes, showOrder ?? Object.keys(renderers), { ...settings.canvas, lean: ['hosts'], fixed }) : {};
    for (const id of exiting) if (previous[id]) offsets[id] = previous[id];
    const appearing = [];
    for (const [id, renderer] of Object.entries(renderers)) {
      const { element } = renderer;
      if (exiting.has(id)) continue; // 淡出中的模块原样淡出，不改它的位移
      const { dx = 0, dy = 0 } = offsets[id] ?? {};
      const value = dx || dy ? `${Math.round(dx)}px ${Math.round(dy)}px` : '';
      // 刚出现（或隐藏中）的模块直接放到避让位置，不从原位滑过去。
      const still = element.hidden || !onScreen.has(id);
      if (still) element.classList.add('avoid-still');
      if (element.style.translate !== value) element.style.translate = value;
      // 分块位移（人物条横向靠拢）写在各条自己身上；不再需要时清掉，各条滑回原来对称的位置。
      const parts = offsets[id]?.parts ?? [];
      const nodes = partNodes[id] ?? [];
      const partValues = new Map(nodes.map((node, i) => [node, parts[i]?.dx ? `${Math.round(parts[i].dx)}px 0px` : '']));
      for (const node of element.querySelectorAll('[data-avoid-part]')) if (!partValues.get(node)) { node.style.translate = ''; node.removeAttribute('data-avoid-part'); }
      for (const [node, part] of partValues) if (part) { if (node.style.translate !== part) node.style.translate = part; node.setAttribute('data-avoid-part', ''); }
      element.toggleAttribute('data-avoiding', Boolean(value || parts.some((part) => part.dx)));
      if (still && !element.hidden) appearing.push(element);
    }
    onScreen = new Set(Object.keys(renderers).filter((id) => settings.modules[id]?.visible && !renderers[id].element.hidden));
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
    dispose() { observer.disconnect(); hiddenObserver.disconnect(); cancelAnimationFrame(frame); },
  };
}
