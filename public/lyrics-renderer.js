import { animateModuleElement, createModuleLayer } from './module-layer.js';
import { timelineIndex } from './lyrics-model.js';

const STYLE_ID = 'yanzhou-lyrics-renderer-style';
const BOARD_HEIGHT = 290;
const VIEWPORT_HEIGHT = 152;
const FONT_SIZE = 52;
const TRANSLATION_RATIO = 0.6;
const MIN_FONT = 16;
const STYLES = `
.lyrics-board .module-body { position: relative; width: 1440px; height: ${BOARD_HEIGHT}px; display: grid; align-items: center; }
.lyrics-board .lyrics-viewport { position: relative; height: ${VIEWPORT_HEIGHT}px; overflow: hidden; display: grid; align-items: center; }
.lyrics-board :is(.lyrics-text, .lyrics-outgoing-text) { display: grid; justify-items: center; align-content: center; gap: 4px; min-width: 0; max-width: 100%; }
.lyrics-board :is(.lyrics-main, .lyrics-translation) { min-width: 0; max-width: 100%; white-space: pre; line-height: 1.16; overflow: hidden; text-overflow: ellipsis; text-align: center; color: var(--lyrics-text); text-shadow: 0 2px 12px rgba(0,0,0,.55); }
.lyrics-board .lyrics-main { font-weight: 650; }
.lyrics-board .lyrics-translation { font-weight: 600; color: color-mix(in srgb, var(--lyrics-text) 82%, transparent); }
.lyrics-board .lyrics-translation:empty { display: none; }
.lyrics-board .lyrics-outgoing { position: absolute; inset: 0; display: grid; align-items: center; pointer-events: none; }
`;

export function createLyricsRenderer(container, { sample = false } = {}) {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLES;
    document.head.append(style);
  }
  const layer = createModuleLayer(container, {
    className: 'lyrics-board',
    bodyHTML: '<div class="lyrics-viewport"><div class="lyrics-text"><span class="lyrics-main"></span><span class="lyrics-translation"></span></div></div>',
  });
  layer.element.setAttribute('aria-label', '歌词字幕');
  const viewport = layer.body.firstElementChild;
  const line = viewport.firstElementChild;
  const main = line.firstElementChild;
  const translation = line.lastElementChild;
  let module;
  let clock;
  let raf;
  let lastText = '';
  let lastTranslation = '';
  let lastSource;
  let lastItems;
  let lastIndex;
  let outgoing;
  let transitionTimer;

  function clearTransition() {
    clearTimeout(transitionTimer);
    outgoing?.remove();
    outgoing = undefined;
    line.getAnimations().forEach((animation) => animation.cancel());
    line.style.animation = '';
  }

  function fit() {
    main.style.fontSize = `${FONT_SIZE}px`;
    let size = FONT_SIZE;
    if (main.scrollWidth > main.clientWidth) {
      size = Math.max(MIN_FONT, Math.floor(FONT_SIZE * main.clientWidth / main.scrollWidth));
      main.style.fontSize = `${size}px`;
    }
    let sub = Math.max(MIN_FONT, Math.round(size * TRANSLATION_RATIO));
    translation.style.fontSize = `${sub}px`;
    if (translation.scrollWidth > translation.clientWidth) {
      sub = Math.max(12, Math.floor(sub * translation.clientWidth / translation.scrollWidth));
      translation.style.fontSize = `${sub}px`;
    }
  }

  function draw() {
    cancelAnimationFrame(raf);
    if (!module) return;
    const state = clock?.state;
    const selected = state?.armed ? state.source : null;
    let text = '';
    let sub = '';
    let position;
    let items;
    let index;
    if (sample && !selected) {
      text = '歌词将在这里显示';
    } else if (selected === 'timeline') {
      position = clock.position();
      items = clock.doc;
      index = timelineIndex(clock.doc, position, state.transport.end);
      const current = clock.doc[index];
      text = current?.text ?? '';
      sub = current?.translation ?? '';
      if (state.transport.playing && position < state.transport.end && module.visible && layer.element.isConnected) {
        raf = requestAnimationFrame(draw);
      }
    } else if (selected === 'manual') {
      text = state.manual.current;
      items = clock.lines;
      index = state.manual.index;
    } else if (selected === 'asr' && clock.asr?.phase === 'listening') {
      text = clock.asrLines.at(-1) ?? '';
      items = clock.asrLines;
      index = items.length - 1;
    }

    const changed = lastText !== text || lastTranslation !== sub || lastSource !== selected ||
      lastItems !== items || lastIndex !== index;
    const previous = lastText;
    const switching = Boolean(lastSource && selected && lastSource !== selected && previous && text);
    const stepping = lastSource === selected && items === lastItems &&
      Number.isInteger(index) && Number.isInteger(lastIndex) && Math.abs(index - lastIndex) === 1;
    const scrolling = stepping && module.animation.enter === 'none' && module.animation.exit === 'none' && previous && text;
    const direction = index > lastIndex ? 1 : -1;
    if (changed) {
      const previousOpacity = switching ? getComputedStyle(line).opacity : '1';
      clearTransition();
      if (previous && text && (switching || scrolling || stepping && module.animation.exit !== 'none')) {
        outgoing = document.createElement('div');
        outgoing.className = 'lyrics-outgoing';
        outgoing.setAttribute('aria-hidden', 'true');
        const oldLine = line.cloneNode(true);
        oldLine.className = 'lyrics-outgoing-text';
        oldLine.style.animation = 'none';
        outgoing.append(oldLine);
        viewport.append(outgoing);
        if (switching) oldLine.animate([{ opacity: previousOpacity }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
        else if (scrolling) oldLine.animate([
          { opacity: 1, transform: 'translateY(0)' },
          { opacity: 0, transform: `translateY(${-direction * 56}px)` },
        ], { duration: 220, easing: 'cubic-bezier(.2,.68,.28,1)', fill: 'forwards' });
        else animateModuleElement(oldLine, 'exit', module.animation);
        transitionTimer = setTimeout(() => {
          outgoing?.remove();
          outgoing = undefined;
        }, (switching ? 300 : scrolling ? 220 : module.animation.duration) + 32);
      }
    }
    layer.element.dataset.hasContent = String(Boolean(text.trim()));
    lastText = text;
    lastTranslation = sub;
    lastSource = selected;
    lastItems = items;
    lastIndex = index;
    if (main.textContent !== text) main.textContent = text;
    if (translation.textContent !== sub) translation.textContent = sub;
    if (!changed) return;
    fit();
    if (switching) line.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
    else if (scrolling) line.animate([
      { opacity: 0, transform: `translateY(${direction * 56}px)` },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 220, easing: 'cubic-bezier(.2,.68,.28,1)' });
    else if (text && previous && selected && stepping) animateModuleElement(line, 'enter', module.animation);
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
