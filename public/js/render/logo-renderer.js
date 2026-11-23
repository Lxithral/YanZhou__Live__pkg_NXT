import { createModuleLayer } from '../core/module-layer.js';

const STYLE_ID = 'yanzhou-logo-renderer-style';

const STYLES = `
.logo-lockup.module-layer { will-change: auto; }
.logo-body { display: flex; align-items: center; gap: calc(18px * var(--logo-scale)); width: max-content; }
.logo-rhythm { display: block; width: calc(340px * var(--logo-scale)); height: auto; }
.logo-body[hidden], .logo-rhythm[hidden] { display: none; }
.logo-emblem { display: block; flex: none; width: var(--logo-mark-size); height: var(--logo-mark-size); filter: drop-shadow(0 calc(1px * var(--logo-scale)) calc(3px * var(--logo-scale)) rgba(0, 0, 0, 0.28)); }
.logo-emblem > :is(img, canvas) { display: block; width: 100%; height: 100%; object-fit: contain; }
.logo-emblem > [hidden] { display: none; }
.logo-copy { display: flex; flex-direction: column; justify-content: center; gap: calc(11px * var(--logo-scale)); color: var(--logo-text-color); white-space: pre; text-shadow: 0 calc(1px * var(--logo-scale)) calc(4px * var(--logo-scale)) rgba(0, 0, 0, 0.38); font-weight: var(--logo-weight, 500); }
.logo-copy.is-stretched { height: var(--logo-mark-size); justify-content: space-between; gap: 0; }
.logo-emblem[hidden], .logo-copy[hidden], .logo-title[hidden], .logo-subtitle[hidden] { display: none; }
.logo-title { font-size: calc(30px * var(--logo-scale) * var(--logo-fit, 1)); font-weight: inherit; line-height: 1.2; letter-spacing: calc(1px * var(--logo-scale)); }
.logo-subtitle { font-size: calc(13px * var(--logo-scale) * var(--logo-fit, 1)); font-weight: inherit; line-height: 1.2; letter-spacing: calc(2.4px * var(--logo-scale)); }
`;

const EMBLEM_SIZE = 88;
let emblemLevels;

function emblemLevel(image, targetSize) {
  if (!emblemLevels) emblemLevels = [{ source: image, width: image.naturalWidth, height: image.naturalHeight }];
  let level = emblemLevels[0];
  // Cache half-size images for large reductions so thin lettering is sampled at each step.
  for (let index = 1; level.height >= targetSize * 2; index += 1) {
    if (!emblemLevels[index]) {
      const source = document.createElement('canvas');
      source.width = Math.ceil(level.width / 2);
      source.height = Math.ceil(level.height / 2);
      const context = source.getContext('2d');
      if (!context) break;
      context.imageSmoothingQuality = 'high';
      context.drawImage(level.source, 0, 0, source.width, source.height);
      emblemLevels[index] = { source, width: source.width, height: source.height };
    }
    level = emblemLevels[index];
  }
  return level;
}

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

export function createLogoRenderer(container) {
  installStyles();
  const layer = createModuleLayer(container, {
    className: 'logo-lockup',
    bodyHTML: '<img class="logo-rhythm" src="/assets/yanzhou-rhythm.png" alt="" width="1038" height="267" hidden><div class="logo-body"><span class="logo-emblem" aria-hidden="true"><img src="/assets/A12.png" alt="" width="88" height="88"><canvas hidden></canvas></span><div class="logo-copy"><div class="logo-title"></div><div class="logo-subtitle"></div></div></div>',
  });
  const { element, body } = layer;
  const rhythm = body.querySelector('.logo-rhythm');
  const school = body.querySelector('.logo-body');
  const copy = body.querySelector('.logo-copy');
  const emblem = body.querySelector('.logo-emblem');
  const source = emblem.querySelector('img');
  const canvas = emblem.querySelector('canvas');
  const markContext = canvas.getContext('2d');
  const title = body.querySelector('.logo-title');
  const subtitle = body.querySelector('.logo-subtitle');
  let lastLogo = null;
  let markSize = EMBLEM_SIZE;

  function drawEmblem() {
    if (!lastLogo?.visible || school.hidden || emblem.hidden || !markContext || !source.complete || !source.naturalWidth) return;
    const pixels = Math.max(1, Math.round(markSize * (globalThis.devicePixelRatio || 1)));
    if (!canvas.hidden && canvas.width === pixels) return;
    const level = emblemLevel(source, pixels);
    canvas.width = pixels;
    canvas.height = pixels;
    markContext.imageSmoothingQuality = 'high';
    const width = pixels * level.width / level.height;
    markContext.drawImage(level.source, (pixels - width) / 2, 0, width, pixels);
    source.hidden = true;
    canvas.hidden = false;
  }
  source.addEventListener('load', drawEmblem);

  function update(logo) {
    lastLogo = logo;
    const showRhythm = logo.variant === 'rhythm';
    rhythm.hidden = !showRhythm;
    school.hidden = showRhythm;
    element.style.setProperty('--logo-scale', String(logo.scale));
    layer.update({ ...logo, scale: 1 });
    if (showRhythm) {
      element.setAttribute('aria-label', 'YZBTVS 节拍线');
      return;
    }
    // Lay out the original badge directly at its output size before compositing.
    markSize = Math.round(EMBLEM_SIZE * logo.scale);
    element.style.setProperty('--logo-mark-size', `${markSize}px`);
    element.style.setProperty('--logo-text-color', logo.textColor);
    element.style.setProperty('--logo-weight', String(logo.weight ?? 500));
    title.textContent = logo.title;
    subtitle.textContent = logo.subtitle;
    title.hidden = !logo.title;
    subtitle.hidden = !logo.subtitle;
    emblem.hidden = logo.showMark === false;
    drawEmblem();
    copy.hidden = !logo.title && !logo.subtitle;
    const markShown = !emblem.hidden;
    // Stretch positions two lines onto the emblem's edges; auto-fit scales the
    // type so the text block spans the emblem height either way.
    const stretched = markShown && !!logo.title && !!logo.subtitle;
    let fit = 1;
    if (markShown && !copy.hidden) {
      copy.classList.remove('is-stretched');
      copy.style.setProperty('--logo-fit', '1');
      copy.style.height = 'auto';
      const natural = copy.offsetHeight;
      if (natural > 0) fit = markSize / natural;
      copy.style.height = '';
    }
    copy.classList.toggle('is-stretched', stretched);
    copy.style.setProperty('--logo-fit', fit.toFixed(4));
    element.setAttribute('aria-label', [logo.title, logo.subtitle].filter(Boolean).join(' · ') || '烟洲中学校徽');
  }

  // The variable font may finish loading after the first render; measure again
  // once it does, so the height fit is computed against the real typeface.
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => { if (lastLogo) update(lastLogo); }).catch(() => {});
  }

  return {
    element,
    body,
    update,
    getBounds: () => layer.getBounds(),
  };
}
