import { animateModuleElement, createModuleLayer } from './module-layer.js';
import { timelineIndex } from './lyrics-model.js';

const STYLE_ID = 'yanzhou-lyrics-renderer-style';
const ROW_HEIGHT = 56;
const BOARD_HEIGHT = 290;
const RADIUS = 2;
const STYLES = `
.lyrics-board .module-body { position: relative; width: 1440px; height: ${BOARD_HEIGHT}px; }
.lyrics-board .lyrics-frame { position: absolute; inset: 0; overflow: hidden; color: var(--lyrics-text); text-shadow: 0 2px 12px rgba(0,0,0,.55); }
.lyrics-board .lyrics-row { position: absolute; left: 0; right: 0; top: 50%; height: 66px; margin-top: -33px; display: grid; align-items: center; text-align: center; }
.lyrics-board .lyrics-frame.is-scrolling .lyrics-row { transition: transform 220ms cubic-bezier(.2,.68,.28,1), opacity 200ms ease, filter 200ms ease; }
.lyrics-board .lyrics-row[data-distance="0"] { opacity: 1; z-index: 1; }
.lyrics-board .lyrics-row[data-distance="1"] { opacity: .57; filter: blur(.45px); }
.lyrics-board .lyrics-row[data-distance="2"] { opacity: .33; filter: blur(1.2px); }
.lyrics-board .lyrics-text { min-width: 0; white-space: pre; line-height: 1.18; overflow: hidden; text-overflow: ellipsis; font-weight: 650; }
.lyrics-board .lyrics-token { position: relative; display: inline-block; opacity: .5; }
.lyrics-board .lyrics-token-fill { position: absolute; inset: 0; color: transparent; text-shadow: none; background: linear-gradient(90deg, var(--lyrics-accent) var(--fill, 0%), transparent var(--fill, 0%)); background-clip: text; }
.lyrics-board .lyrics-token.is-reached { opacity: 1; color: color-mix(in srgb, var(--lyrics-text) 55%, transparent); }
@media (prefers-reduced-motion: reduce) {
  .lyrics-board .lyrics-frame.is-scrolling .lyrics-row { transition: none; }
}
`;

const DEMO = ['前一句歌词', '接近当前的一句', '歌词将在这里显示', '接下来的一句', '后续歌词'];

function makeFrame() {
  const node = document.createElement('div');
  node.className = 'lyrics-frame';
  return { node, rows: new Map(), items: null, index: null };
}

function makeRow() {
  const node = document.createElement('div');
  const text = document.createElement('div');
  node.className = 'lyrics-row';
  text.className = 'lyrics-text';
  node.append(text);
  return { node, text, value: null, tokens: null, spans: [], active: -1, lastPosition: -1 };
}

function writeRow(row, text, tokens, fontSize) {
  if (row.value !== text || row.tokens !== tokens) {
    row.value = text;
    row.tokens = tokens;
    row.active = -1;
    row.lastPosition = -1;
    row.spans = [];
    if (!tokens?.length) row.text.textContent = text;
    else {
      for (const token of tokens) {
        const span = document.createElement('span');
        span.className = 'lyrics-token';
        span.append(token.text);
        const fill = document.createElement('span');
        fill.className = 'lyrics-token-fill';
        fill.setAttribute('aria-hidden', 'true');
        fill.textContent = token.text;
        span.append(fill);
        row.spans.push(span);
      }
      row.text.replaceChildren(...row.spans);
    }
  }
  row.text.style.fontSize = `${fontSize}px`;
  const { scrollWidth, clientWidth } = row.text;
  if (clientWidth && scrollWidth > clientWidth) {
    row.text.style.fontSize = `${Math.max(16, Math.floor(fontSize * clientWidth / scrollWidth))}px`;
  }
}

function updateTokens(row, position, lineEnd) {
  if (!row?.spans.length || row.lastPosition === position) return;
  let active = position < row.lastPosition ? -1 : row.active;
  while (row.tokens[active + 1]?.start <= position) active += 1;
  if (active !== row.active || row.lastPosition < 0) {
    for (const [index, span] of row.spans.entries()) {
      span.classList.toggle('is-reached', index <= active);
      span.style.setProperty('--fill', index < active ? '100%' : '0%');
    }
  }
  if (active >= 0) {
    const start = row.tokens[active].start;
    const end = row.tokens[active + 1]?.start ?? lineEnd;
    const fraction = Math.min(1, (position - start) / Math.max(1, end - start));
    row.spans[active].style.setProperty('--fill', `${fraction * 100}%`);
  }
  row.active = active;
  row.lastPosition = position;
}

export function createLyricsRenderer(container, { sample = false } = {}) {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLES;
    document.head.append(style);
  }
  const layer = createModuleLayer(container, { className: 'lyrics-board' });
  layer.element.setAttribute('aria-label', '歌词字幕');
  let module;
  let clock;
  let frame;
  let source;
  let raf;

  function setSource(selected) {
    if (frame && source === selected) return;
    const old = frame;
    const fade = Boolean(old && source && selected);
    const oldOpacity = fade ? getComputedStyle(old.node).opacity : 1;
    layer.body.replaceChildren();
    frame = makeFrame();
    layer.body.append(frame.node);
    if (fade) {
      old.node.getAnimations().forEach((animation) => animation.cancel());
      layer.body.prepend(old.node);
      const exit = old.node.animate([{ opacity: oldOpacity }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
      exit.onfinish = () => old.node.remove();
      frame.node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: 'backwards' });
    }
    source = selected;
  }

  function updateWindow(items, index, current, tokens) {
    if (frame.items === items && frame.index === index && frame.current === current && frame.tokens === tokens) return;
    const sameList = frame.items === items;
    const moved = sameList && frame.index !== null && index !== null && Math.abs(frame.index - index) === 1;
    const previous = frame.index;
    frame.items = items;
    frame.index = index;
    frame.current = current;
    frame.tokens = tokens;
    frame.node.classList.toggle('is-scrolling', moved);

    if (!current || !sameList) {
      frame.node.replaceChildren();
      frame.rows.clear();
    }
    if (!current) return;

    for (const [key, row] of frame.rows) {
      if (index === null || key === null || Math.abs(key - index) > RADIUS) {
        row.node.remove();
        frame.rows.delete(key);
      }
    }

    const keys = index === null ? [null] : [];
    if (index !== null) {
      for (let key = Math.max(0, index - RADIUS); key <= Math.min(items.length - 1, index + RADIUS); key += 1) keys.push(key);
    }
    for (const key of keys) {
      const offset = index === null ? 0 : key - index;
      const distance = Math.abs(offset);
      const active = offset === 0;
      const row = frame.rows.get(key) ?? makeRow();
      if (!frame.rows.has(key)) {
        frame.rows.set(key, row);
        frame.node.append(row.node);
      }
      row.node.dataset.distance = distance;
      row.node.style.transform = `translateY(${offset * ROW_HEIGHT}px)`;
      const item = items[key];
      const text = active ? current : (typeof item === 'string' ? item : item.text);
      writeRow(row, text, active ? tokens : null, active ? 52 : distance === 1 ? 36 : 29);
      if (moved && previous !== null && key === previous) {
        animateModuleElement(row.text, 'exit', module.animation);
        row.text.addEventListener('animationend', () => { row.text.style.animation = ''; }, { once: true });
      } else if (moved && active) animateModuleElement(row.text, 'enter', module.animation);
    }
  }

  function draw() {
    cancelAnimationFrame(raf);
    if (!module) return;
    const state = clock?.state;
    const selected = state?.armed ? state.source : null;
    setSource(selected);
    if (sample && !state?.armed) {
      updateWindow(DEMO, 2, DEMO[2], null);
      return;
    }
    if (selected === 'timeline') {
      const position = clock.position();
      const index = timelineIndex(clock.doc, position, state.transport.end);
      const line = clock.doc[index];
      updateWindow(clock.doc, index, line?.text ?? '', line && !line.credit ? line.tokens : null);
      updateTokens(frame.rows.get(index), position, clock.doc[index + 1]?.start ?? state.transport.end);
      if (state.transport.playing && position < state.transport.end && module.visible && layer.element.isConnected) {
        raf = requestAnimationFrame(draw);
      }
    } else if (selected === 'manual') {
      updateWindow(clock.lines, state.manual.index, state.manual.current, null);
    } else if (selected === 'asr' && clock.asr?.phase === 'listening') {
      const lines = clock.asrLines;
      updateWindow(lines, lines.length - 1, lines.at(-1) ?? '', null);
    } else updateWindow(null, null, '', null);
  }

  return {
    ...layer,
    update(settings) {
      module = settings;
      const y = Math.min(settings.y, Math.max(0, 1080 - BOARD_HEIGHT * settings.scale));
      layer.update({ ...settings, y });
      layer.element.style.setProperty('--lyrics-accent', settings.accentColor);
      layer.element.style.setProperty('--lyrics-text', settings.textColor);
      draw();
    },
    updateLyrics(nextClock) { clock = nextClock; draw(); },
  };
}
