import { createModuleLayer } from '../core/module-layer.js';
import { createCaptionBounds, measureCaptionText } from './caption-bounds.js';
import { markLimitedWidth } from './corner-limit.js';

const STYLE_ID = 'yanzhou-speech-style';
const HEIGHT = 184;
const BOARD_WIDTH = 1440;
// 单行显示：保留最近这些字用于向左滚动，超出部分靠左裁掉。
const MAX_TEXT = 240;
const SCROLL_MS = 180;
const JUMP = 260;

export function createSpeechRenderer(container, { sample = false } = {}) {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .speech-board .module-body { width: ${BOARD_WIDTH}px; height: ${HEIGHT}px; display: grid; align-items: center; }
      .speech-board .speech-viewport { position: relative; height: 152px; display: grid; align-items: center; padding: 12px 20px; overflow: hidden; }
      .speech-board .speech-text { position: relative; width: 100%; overflow: hidden; color: var(--speech-text); font-size: 48px; font-weight: 650; line-height: 1.45; white-space: nowrap; text-shadow: 0 2px 12px rgba(0,0,0,.65); -webkit-mask-image: linear-gradient(to right, transparent 0, #000 56px); mask-image: linear-gradient(to right, transparent 0, #000 56px); }
      .speech-board .speech-copy { display: inline-block; transition: transform ${SCROLL_MS}ms ease-out; will-change: transform; }
    `;
    document.head.append(style);
  }
  const layer = createModuleLayer(container, {
    className: 'speech-board', bodyHTML: '<div class="speech-viewport"><div class="speech-text"><span class="speech-copy"></span></div></div>',
  });
  layer.element.setAttribute('aria-label', '语音字幕');
  const viewport = layer.body.querySelector('.speech-viewport');
  const text = layer.body.querySelector('.speech-text');
  const copy = text.firstElementChild;
  const footprint = createCaptionBounds(layer.element);
  let constrained = true;
  let module;
  let state;
  let disposed = false;
  let lastShift = 0;
  let lastCount = 0;

  // 先按活动角标的位置收窄字幕板：单行字幕最右也只顶到角标左侧，不会压住角标。
  function boardWidth() {
    return markLimitedWidth(container, layer.element, BOARD_WIDTH);
  }
  function layout() {
    const width = boardWidth();
    if (layer.body.style.width !== `${width}px`) layer.body.style.width = `${width}px`;
    const inner = text.clientWidth;
    const natural = copy.scrollWidth;
    // 放得下就居中；放不下就右端贴住字幕板，多出来的字从左边裁掉（新字不断往左推）。
    const shift = natural > inner ? inner - natural : (inner - natural) / 2;
    const animate = copy.textContent.length >= lastCount && Math.abs(shift - lastShift) <= JUMP;
    if (!animate) copy.style.transition = 'none';
    copy.style.transform = `translateX(${shift}px)`;
    if (!animate) {
      void copy.offsetWidth;
      copy.style.transition = '';
    }
    lastShift = shift;
    lastCount = copy.textContent.length;
  }
  function draw() {
    if (disposed || !module) return;
    const next = Array.from(state?.text || (sample ? '等待语音字幕' : '')).slice(-MAX_TEXT).join('');
    if (copy.textContent !== next) copy.textContent = next;
    const hasContent = Boolean(next.trim());
    if (layer.element.dataset.hasContent !== String(hasContent)) layer.element.dataset.hasContent = String(hasContent);
    layer.body.style.visibility = hasContent ? '' : 'hidden';
    if (hasContent && !layer.element.hidden) layout();
    updateBounds();
  }
  function updateBounds() {
    if (disposed || !module) return;
    const hasContent = Boolean(copy.textContent.trim());
    const rects = hasContent ? measureCaptionText(layer.element, text, [copy.firstChild], { clip: viewport }) : [];
    footprint.update(rects, module, constrained);
  }
  // 活动角标可能是稍后才上屏的模块，下一帧按它的实际位置再收一次板宽。
  function recheckWidth() {
    requestAnimationFrame(() => {
      if (disposed || !module) return;
      if (layer.body.style.width === `${boardWidth()}px`) return;
      layout();
      updateBounds();
    });
  }
  document.fonts?.load('650 48px MiSans').then(draw, () => {});
  return {
    ...layer,
    getCaptionRects: footprint.rects,
    update(settings, { constrain = true } = {}) {
      constrained = constrain;
      const y = constrain ? Math.min(settings.y, Math.max(0, 1080 - HEIGHT * settings.scale)) : settings.y;
      module = { ...settings, y };
      layer.update(module);
      layer.element.style.setProperty('--speech-text', settings.textColor);
      draw();
      recheckWidth();
    },
    updateSpeech(message) {
      state = message;
      draw();
    },
    dispose() { disposed = true; },
  };
}
