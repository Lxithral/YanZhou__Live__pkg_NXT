import { animateModuleElement, createModuleLayer, moduleMotionInsets } from '../core/module-layer.js';
import { createCaptionBounds, measureCaptionText } from './caption-bounds.js';
import { timelineIndex } from '../lyrics/lyrics-model.js';

const STYLE_ID = 'yanzhou-lyrics-renderer-style';
const BOARD_HEIGHT = 290;
const VIEWPORT_TOP = 69;
const VIEWPORT_HEIGHT = 168;
const FONT_SIZE = 52;
const MAIN_ROW_HEIGHT = FONT_SIZE * 1.4;
const MAIN_ROW_TOP = BOARD_HEIGHT / 2 - VIEWPORT_TOP - MAIN_ROW_HEIGHT / 2;
const TRANSLATION_RATIO = 0.6;
const MIN_FONT = 16;
const STYLES = `
.lyrics-board .module-body { position: relative; width: 1440px; height: ${BOARD_HEIGHT}px; display: grid; align-items: start; }
.lyrics-board .lyrics-viewport { position: relative; height: ${VIEWPORT_HEIGHT}px; margin-top: ${VIEWPORT_TOP}px; overflow: hidden; display: grid; align-items: start; }
.lyrics-board :is(.lyrics-text, .lyrics-outgoing-text) { display: grid; justify-items: center; align-content: start; align-items: center; grid-template-rows: ${MAIN_ROW_HEIGHT}px auto; margin-top: ${MAIN_ROW_TOP}px; gap: 4px; min-width: 0; max-width: 100%; }
/* MiSans 的下伸部和阴影会超出紧凑行框；统一由外层 viewport 裁剪换行动画。 */
.lyrics-board :is(.lyrics-main, .lyrics-translation) { min-width: 0; max-width: 100%; white-space: pre; line-height: 1.4; overflow: visible; text-align: center; color: var(--lyrics-text); text-shadow: 0 2px 12px rgba(0,0,0,.55); }
.lyrics-board .lyrics-main { font-weight: 650; }
.lyrics-board .lyrics-translation { font-weight: 600; color: color-mix(in srgb, var(--lyrics-text) 82%, transparent); }
.lyrics-board .lyrics-translation:empty { display: none; }
.lyrics-board .lyrics-outgoing { position: absolute; inset: 0; display: grid; align-items: start; pointer-events: none; }
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
  const footprint = createCaptionBounds(layer.element);
  let constrained = true;
  let disposed = false;
  let clock;
  let raf;
  let lastText = '';
  let lastTranslation = '';
  let lastSource;
  let lastItems;
  let lastIndex;
  let outgoing;
  let incomingTravel;
  let outgoingTravel;

  function clearTransition() {
    incomingTravel = undefined;
    outgoingTravel = undefined;
    outgoing?.remove();
    outgoing = undefined;
    line.getAnimations().forEach((animation) => animation.cancel());
    line.style.animation = '';
  }

  function refreshBounds() {
    if (!module || disposed) return;
    const rects = measureCaptionText(layer.element, line, [main.firstChild, translation.firstChild], { clip: viewport, travel: incomingTravel });
    const oldLine = outgoing?.firstElementChild;
    if (oldLine) {
      rects.push(...measureCaptionText(layer.element, oldLine, [...oldLine.children].map((node) => node.firstChild),
        { clip: viewport, travel: outgoingTravel }));
    }
    footprint.update(rects, module, constrained);
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
    if (!module || disposed) return;
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
        const departing = outgoing;
        if (scrolling) outgoingTravel = direction > 0 ? { top: 56 } : { bottom: 56 };
        else if (!switching) outgoingTravel = moduleMotionInsets({ exit: module.animation.exit });
        if (switching) oldLine.animate([{ opacity: previousOpacity }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
        else if (scrolling) oldLine.animate([
          { opacity: 1, transform: 'translateY(0)' },
          { opacity: 0, transform: `translateY(${-direction * 56}px)` },
        ], { duration: 220, easing: 'cubic-bezier(.2,.68,.28,1)', fill: 'forwards' });
        else animateModuleElement(oldLine, 'exit', module.animation);
        const finish = () => {
          if (outgoing !== departing) return;
          departing.remove();
          outgoing = undefined;
          outgoingTravel = undefined;
          refreshBounds();
        };
        const animation = oldLine.getAnimations()[0];
        if (animation) animation.finished.then(finish, () => {});
        else finish();
      }
    }
    const hasContent = String(Boolean(text.trim()));
    if (layer.element.dataset.hasContent !== hasContent) layer.element.dataset.hasContent = hasContent;
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
    if (scrolling) incomingTravel = direction > 0 ? { bottom: 56 } : { top: 56 };
    else if (text && previous && selected && stepping && !switching) incomingTravel = moduleMotionInsets({ enter: module.animation.enter });
    const travel = incomingTravel;
    const animation = travel && line.getAnimations()[0];
    if (animation) animation.finished.then(() => {
      if (incomingTravel !== travel) return;
      incomingTravel = undefined;
      refreshBounds();
    }, () => {});
    else incomingTravel = undefined;
    refreshBounds();
    return true;
  }
  document.fonts?.load('650 52px MiSans').then(() => {
    if (!disposed && module && !layer.element.hidden) { fit(); refreshBounds(); }
  }, () => {});

  return {
    ...layer,
    getCaptionRects: footprint.rects,
    update(settings, { constrain = true } = {}) {
      const wasHidden = layer.element.hidden;
      constrained = constrain;
      const y = constrain ? Math.min(settings.y, Math.max(0, 1080 - BOARD_HEIGHT * settings.scale)) : settings.y;
      module = { ...settings, y };
      layer.update(module);
      layer.element.style.setProperty('--lyrics-accent', settings.accentColor);
      layer.element.style.setProperty('--lyrics-text', settings.textColor);
      if (!draw()) {
        if (wasHidden && !layer.element.hidden) fit();
        refreshBounds();
      }
    },
    updateLyrics(nextClock) { clock = nextClock; draw(); },
    dispose() { disposed = true; cancelAnimationFrame(raf); clearTransition(); },
  };
}
