import { animateModuleElement, createModuleLayer } from './module-layer.js';
import { timelineIndex } from './lyrics-model.js';

const STYLE_ID = 'yanzhou-lyrics-renderer-style';
const STYLES = `
.lyrics-board .module-body { position: relative; width: 1440px; height: 146px; }
.lyrics-board .lyrics-frame { position: absolute; inset: 0; display: grid; align-content: center; gap: 10px; text-align: center; color: var(--lyrics-text); text-shadow: 0 2px 12px rgba(0,0,0,.55); }
.lyrics-board .lyrics-current, .lyrics-board .lyrics-next { min-width: 0; white-space: pre; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; }
.lyrics-board .lyrics-current { font-size: 58px; min-height: 72.5px; }
.lyrics-board .lyrics-next { font-size: 34.8px; min-height: 43.5px; opacity: .7; }
.lyrics-board .lyrics-highlight { color: var(--lyrics-accent); }
.lyrics-board .lyrics-token { position: relative; display: inline-block; transition: transform 150ms ease; }
.lyrics-board .lyrics-token.is-current { transform: scale(1.06); }
.lyrics-board .lyrics-token-fill { position: absolute; inset: 0; color: transparent; text-shadow: none; background: linear-gradient(90deg, var(--lyrics-accent) var(--fill, 0%), transparent var(--fill, 0%)); background-clip: text; }
`;

export function createLyricsRenderer(container, { sample = false } = {}) {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLES;
    document.head.append(style);
  }
  const layer = createModuleLayer(container, { className: 'lyrics-board' });
  const sampleLine = { text: '歌词将在这里显示', tokens: [] };
  let module;
  let clock;
  let frame;
  let source;
  let current;
  let next;
  let spans = [];
  let active = -1;
  let previousPosition = -1;
  let raf;
  let fadeUntil = 0;

  function makeFrame() {
    const node = document.createElement('div');
    node.className = 'lyrics-frame';
    const primary = document.createElement('div');
    const secondary = document.createElement('div');
    primary.className = 'lyrics-current';
    secondary.className = 'lyrics-next';
    node.append(primary, secondary);
    return { node, primary, secondary };
  }

  function replaceFrame(crossfade, lineAnimation) {
    const old = frame;
    const oldOpacity = crossfade && getComputedStyle(old.node).opacity;
    for (const node of [...layer.body.children]) {
      if (node !== old?.node) node.remove();
    }
    frame = makeFrame();
    layer.body.append(frame.node);
    if (old && crossfade) {
      fadeUntil = performance.now() + 300;
      old.node.getAnimations().forEach((animation) => animation.cancel());
      old.node.style.animation = 'none';
      const exit = old.node.animate([{ opacity: oldOpacity }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
      exit.onfinish = () => old.node.remove();
      frame.node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: 'backwards' });
    } else {
      fadeUntil = 0;
      if (lineAnimation) {
        animateModuleElement(frame.node, 'enter', module.animation);
        if (module.animation.exit !== 'none') {
          animateModuleElement(old.node, 'exit', module.animation);
          old.node.addEventListener('animationend', () => old.node.remove(), { once: true });
        } else old.node.remove();
      } else old?.node.remove();
    }
  }

  function fit(element, fontSize) {
    element.style.fontSize = '';
    if (element.clientWidth && element.scrollWidth > element.clientWidth) {
      element.style.fontSize = `${Math.max(18, Math.floor(fontSize * element.clientWidth / element.scrollWidth))}px`;
    }
  }

  function writeFrame(line, following, timeline) {
    spans = [];
    active = -1;
    previousPosition = -1;
    frame.primary.replaceChildren();
    frame.primary.classList.toggle('lyrics-highlight', Boolean(timeline && line && !line.credit && !line.tokens.length));
    if (timeline && line?.tokens.length && !line.credit) {
      const fragment = document.createDocumentFragment();
      for (const token of line.tokens) {
        const span = document.createElement('span');
        span.className = 'lyrics-token';
        span.append(token.text);
        const fill = document.createElement('span');
        fill.className = 'lyrics-token-fill';
        fill.setAttribute('aria-hidden', 'true');
        fill.textContent = token.text;
        span.append(fill);
        fragment.append(span);
        spans.push(span);
      }
      frame.primary.append(fragment);
    } else frame.primary.textContent = line?.text ?? '';
    frame.secondary.textContent = following;
    fit(frame.primary, 58);
    fit(frame.secondary, 34.8);
  }

  function draw() {
    cancelAnimationFrame(raf);
    if (!module) return;
    const state = clock?.state;
    const selected = state?.armed ? state.source : null;
    const timeline = selected === 'timeline';
    const position = clock?.position() ?? 0;
    const index = timeline ? timelineIndex(clock.doc, position, state.transport.end) : -1;
    const row = timeline ? clock.doc[index] : undefined;
    const text = selected === 'manual' ? state.manual.current : '';
    const line = sample ? sampleLine : row ?? (text ? { text, tokens: [] } : null);
    const following = sample ? '下一句预览' : timeline ? clock.doc[index + 1]?.text ?? '' : selected === 'manual' ? state.manual.next : '';
    const key = row ?? (sample ? sampleLine : text);
    const sourceChanged = source !== selected;
    if (!frame || sourceChanged || key !== current || following !== next) {
      const crossfade = Boolean(source && selected && sourceChanged);
      if (!frame || sourceChanged || performance.now() >= fadeUntil) {
        replaceFrame(crossfade, Boolean(frame && !sourceChanged && row && current));
      }
      writeFrame(line, following, timeline);
      source = selected;
      current = key;
      next = following;
    }
    if (spans.length && position !== previousPosition) {
      let indexOfToken = active;
      const lineEnd = clock.doc[index + 1]?.start ?? state.transport.end;
      if (position < previousPosition) indexOfToken = -1;
      while (indexOfToken + 1 < spans.length && row.tokens[indexOfToken + 1].start <= position) indexOfToken += 1;
      if (indexOfToken !== active || previousPosition < 0) {
        for (const [tokenIndex, span] of spans.entries()) {
          span.classList.toggle('is-current', tokenIndex === indexOfToken);
          span.style.setProperty('--fill', tokenIndex < indexOfToken ? '100%' : '0%');
        }
      }
      if (indexOfToken >= 0) {
        const start = row.tokens[indexOfToken].start;
        const end = row.tokens[indexOfToken + 1]?.start ?? lineEnd;
        const fraction = Math.min(1, (position - start) / Math.max(1, end - start));
        spans[indexOfToken].style.setProperty('--fill', `${fraction * 100}%`);
      }
      active = indexOfToken;
      previousPosition = position;
    }
    if (!sample && timeline && state.transport.playing && position < state.transport.end && module.visible) {
      raf = requestAnimationFrame(draw);
    }
  }

  return {
    ...layer,
    update(settings) {
      module = settings;
      layer.update(settings);
      layer.element.style.setProperty('--lyrics-accent', settings.accentColor);
      layer.element.style.setProperty('--lyrics-text', settings.textColor);
      layer.element.setAttribute('aria-label', '歌词字幕');
      draw();
    },
    updateLyrics(nextClock) { clock = nextClock; draw(); },
  };
}
