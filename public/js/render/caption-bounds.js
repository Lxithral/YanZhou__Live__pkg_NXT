import { stageSafeArea } from '../core/stage-area.js';

const TEXT_PADDING = 4;
const rounded = (value) => Math.round(value * 2) / 2;

export function offsetWithin(node, root) {
  let x = 0;
  let y = 0;
  for (let current = node; current && current !== root; current = current.offsetParent) {
    x += current.offsetLeft;
    y += current.offsetTop;
  }
  return { x, y };
}

/** Text range rectangles in unscaled layer coordinates, with optional animation travel. */
export function measureCaptionText(root, group, nodes, { clip, travel = {} } = {}) {
  const frame = group.getBoundingClientRect();
  const zoom = frame.width / group.offsetWidth;
  if (!(zoom > 0)) return [];
  const origin = offsetWithin(group, root);
  const limits = clip && offsetWithin(clip, root);
  const range = document.createRange();
  const boxes = [];
  for (const node of nodes) {
    if (!node?.textContent.trim()) continue;
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (!rect.width || !rect.height) continue;
      const x = origin.x + (rect.left - frame.left) / zoom;
      const y = origin.y + (rect.top - frame.top) / zoom;
      const left = Math.max(limits?.x ?? -Infinity, x - TEXT_PADDING - (travel.left ?? 0));
      const top = Math.max(limits?.y ?? -Infinity, y - TEXT_PADDING - (travel.top ?? 0));
      const right = Math.min(limits ? limits.x + clip.offsetWidth : Infinity, x + rect.width / zoom + TEXT_PADDING + (travel.right ?? 0));
      const bottom = Math.min(limits ? limits.y + clip.offsetHeight : Infinity, y + rect.height / zoom + TEXT_PADDING + (travel.bottom ?? 0));
      if (right > left && bottom > top) {
        boxes.push({ x: rounded(left), y: rounded(top), w: rounded(right) - rounded(left), h: rounded(bottom) - rounded(top) });
      }
    }
  }
  return boxes;
}

export function createCaptionBounds(element) {
  let rects = [];
  return {
    rects: () => rects,
    update(next, { x, y, scale }, constrain) {
      rects = next;
      if (next.length) {
        const left = Math.min(...next.map((r) => r.x));
        const top = Math.min(...next.map((r) => r.y));
        const right = Math.max(...next.map((r) => r.x + r.w));
        const bottom = Math.max(...next.map((r) => r.y + r.h));
        element.style.setProperty('--caption-left', left + 'px');
        element.style.setProperty('--caption-top', top + 'px');
        element.style.setProperty('--caption-width', (right - left) + 'px');
        element.style.setProperty('--caption-height', (bottom - top) + 'px');
        if (constrain) {
          const area = stageSafeArea();
          const minX = area.left - left * scale;
          const maxX = area.right - right * scale;
          const minY = area.top - top * scale;
          const maxY = area.bottom - bottom * scale;
          x = minX <= maxX ? Math.min(maxX, Math.max(minX, x)) : (minX + maxX) / 2;
          y = Math.min(maxY, Math.max(minY, y));
        }
      }
      element.style.left = x + 'px';
      element.style.top = y + 'px';
      const signature = next.length ? JSON.stringify(next) : '';
      if (signature && element.dataset.captionBounds !== signature) element.dataset.captionBounds = signature;
      else if (!signature && element.hasAttribute('data-caption-bounds')) element.removeAttribute('data-caption-bounds');
    },
  };
}
