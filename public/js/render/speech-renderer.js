import { createModuleLayer } from '../core/module-layer.js';

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
    className: 'speech-board', bodyHTML: '<div class="speech-viewport"><div class="speech-text"></div></div>',
  });
  layer.element.setAttribute('aria-label', '主持人语音字幕');
  const text = layer.body.querySelector('.speech-text');
  let module;
  let state;
  let timer;
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
    if (disposed) return;
    text.textContent = Array.from(state?.text || (sample ? '主持人语音将在这里显示' : '')).slice(-120).join('');
    layer.element.dataset.hasContent = String(Boolean(text.textContent.trim()));
    layer.body.style.visibility = text.textContent ? '' : 'hidden';
    fit();
  }
  document.fonts?.ready.then(draw);
  return {
    ...layer,
    update(settings) {
      module = settings;
      layer.update({ ...module, y: Math.min(module.y, Math.max(0, 1080 - HEIGHT * module.scale)) });
      layer.element.style.setProperty('--speech-text', settings.textColor);
      draw();
    },
    updateSpeech(message) {
      clearTimeout(timer);
      state = message;
      if (message.text && message.expiresAt) {
        const transit = Math.max(0, Math.min(2000, Date.now() - message.serverTime));
        const remaining = message.expiresAt - message.serverTime - transit;
        if (remaining <= 0) state = { ...message, text: '' };
        else timer = setTimeout(() => { state = { ...message, text: '' }; draw(); }, remaining);
      }
      draw();
    },
    dispose() { disposed = true; clearTimeout(timer); },
  };
}
