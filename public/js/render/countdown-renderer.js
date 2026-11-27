import { createModuleLayer } from '../core/module-layer.js';

const STYLE_ID = 'yanzhou-countdown-renderer-style';
const TICK_MS = 250;

const STYLES = `
.countdown-board .countdown-stack { display: grid; justify-items: center; row-gap: 10px; color: var(--countdown-color, #F4F0E8); }
.countdown-board .countdown-label { font-size: 34px; font-weight: 600; letter-spacing: .18em; opacity: .82; white-space: nowrap; text-shadow: 0 2px 10px rgba(0,0,0,.55); }
.countdown-board .countdown-label[hidden] { display: none; }
.countdown-board .countdown-value { display: flex; align-items: baseline; font-size: 96px; font-weight: 650; line-height: 1; font-variant-numeric: tabular-nums; text-shadow: 0 4px 18px rgba(0,0,0,.6); }
.countdown-board .countdown-number { min-width: 1.32em; text-align: center; }
.countdown-board .countdown-unit { font-size: 32px; font-weight: 600; letter-spacing: .06em; opacity: .78; margin: 0 .34em 0 .08em; }
.countdown-board .countdown-unit:last-child { margin-right: 0; }
`;

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.append(style);
}

const pad = (value) => String(value).padStart(2, '0');

/** 支持 datetime-local（2026-11-27T19:30）和只写钟点（19:30 / 19:30:00，按今天算）。 */
export function parseCountdownTarget(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/u.exec(text);
  if (clock) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(),
      Number(clock[1]), Number(clock[2]), Number(clock[3] ?? 0));
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function createCountdownRenderer(container) {
  installStyles();
  const layer = createModuleLayer(container, {
    className: 'countdown-board',
    bodyHTML: `<div class="countdown-stack">
      <div class="countdown-label" hidden></div>
      <div class="countdown-value" role="timer">
        <span class="countdown-number" data-part="minutes">--</span><span class="countdown-unit">分</span><span class="countdown-number" data-part="seconds">--</span><span class="countdown-unit">秒</span>
      </div>
    </div>`,
  });
  const label = layer.body.querySelector('.countdown-label');
  const minutesEl = layer.body.querySelector('[data-part="minutes"]');
  const secondsEl = layer.body.querySelector('[data-part="seconds"]');
  let module = null;
  let target = null;
  let disposed = false;

  function tick() {
    if (disposed || !module) return;
    let minutes = '--';
    let seconds = '--';
    if (target) {
      const totalSeconds = Math.max(0, Math.ceil((target.getTime() - Date.now()) / 1000));
      minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
      seconds = pad(totalSeconds % 60);
    }
    if (minutesEl.textContent !== minutes) minutesEl.textContent = minutes;
    if (secondsEl.textContent !== seconds) secondsEl.textContent = seconds;
  }

  const timer = setInterval(tick, TICK_MS);
  document.fonts?.ready.then(tick);

  return {
    element: layer.element,
    body: layer.body,
    update(settings) {
      module = settings;
      layer.update(settings);
      layer.element.style.setProperty('--countdown-color', settings.textColor || '#F4F0E8');
      const text = String(settings.label ?? '').trim();
      label.textContent = text;
      label.hidden = !text;
      target = parseCountdownTarget(settings.target);
      tick();
    },
    getBounds: () => layer.getBounds(),
    dispose() {
      disposed = true;
      clearInterval(timer);
    },
  };
}
