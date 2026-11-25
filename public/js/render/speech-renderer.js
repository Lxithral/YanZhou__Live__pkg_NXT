import { createModuleLayer } from '../core/module-layer.js';
import { createCaptionBounds, measureCaptionText } from './caption-bounds.js';

const STYLE_ID = 'yanzhou-speech-style';
const HEIGHT = 184;

export function createSpeechRenderer(container, { sample = false } = {}) {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .speech-board .module-body { width: 1440px; height: ${HEIGHT}px; display: grid; align-items: center; }
      .speech-board .speech-viewport { height: 152px; display: grid; align-items: center; padding: 12px 20px; }
      .speech-board .speech-text { color: var(--speech-text); font-size: 48px; font-weight: 650; line-height: 1.45; text-align: center; overflow-wrap: anywhere; white-space: pre-wrap; text-shadow: 0 2px 12px rgba(0,0,0,.65); }
    `;
    document.head.append(style);
  }
  const layer = createModuleLayer(container, {
    className: 'speech-board', bodyHTML: '<div class="speech-viewport"><div class="speech-text"><span class="speech-copy"></span></div></div>',
  });
  layer.element.setAttribute('aria-label', '语音字幕');
  const text = layer.body.querySelector('.speech-text');
  const copy = text.firstElementChild;
  const footprint = createCaptionBounds(layer.element);
  let constrained = true;
  let module;
  let state;
  let disposed = false;

  function fit() {
    let size = 48;
    text.style.fontSize = `${size}px`;
    while (size > 24 && (text.scrollHeight > size * 1.45 * 2 + 1 || text.scrollWidth > text.clientWidth)) {
      size -= 2;
      text.style.fontSize = `${size}px`;
    }
  }
  function draw() {
    if (disposed || !module) return;
    const next = Array.from(state?.text || (sample ? '等待语音字幕' : '')).slice(-120).join('');
    if (copy.textContent !== next) copy.textContent = next;
    const hasContent = Boolean(next.trim());
    if (layer.element.dataset.hasContent !== String(hasContent)) layer.element.dataset.hasContent = String(hasContent);
    layer.body.style.visibility = hasContent ? '' : 'hidden';
    if (hasContent && !layer.element.hidden) fit();
    const rects = hasContent ? measureCaptionText(layer.element, text, [copy.firstChild]) : [];
    footprint.update(rects, module, constrained);
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
    },
    updateSpeech(message) {
      state = message;
      draw();
    },
    dispose() { disposed = true; },
  };
}
