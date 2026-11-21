import { createModuleLayer } from '../core/module-layer.js';

const STYLE_ID = 'yanzhou-logo-renderer-style';

const STYLES = `
.logo-body { display: flex; align-items: center; gap: 18px; width: max-content; }
.logo-emblem { display: block; flex: 0 0 88px; width: 88px; height: 88px; object-fit: contain; filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.28)); }
.logo-copy { display: flex; flex-direction: column; justify-content: center; gap: 11px; color: var(--logo-text-color); white-space: pre; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.38); font-weight: var(--logo-weight, 500); }
.logo-copy.is-stretched { height: 88px; justify-content: space-between; gap: 0; }
.logo-emblem[hidden], .logo-copy[hidden], .logo-title[hidden], .logo-subtitle[hidden] { display: none; }
.logo-title { font-size: calc(30px * var(--logo-fit, 1)); font-weight: inherit; line-height: 1.2; letter-spacing: 1px; }
.logo-subtitle { font-size: calc(13px * var(--logo-fit, 1)); font-weight: inherit; line-height: 1.2; letter-spacing: 2.4px; }
`;

const EMBLEM_SIZE = 88;

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
    bodyHTML: '<div class="logo-body"><img class="logo-emblem" src="/assets/A12.png" alt="" width="88" height="88"><div class="logo-copy"><div class="logo-title"></div><div class="logo-subtitle"></div></div></div>',
  });
  const { element, body } = layer;
  const copy = body.querySelector('.logo-copy');
  const emblem = body.querySelector('.logo-emblem');
  const title = body.querySelector('.logo-title');
  const subtitle = body.querySelector('.logo-subtitle');
  let lastLogo = null;

  function update(logo) {
    lastLogo = logo;
    layer.update(logo);
    element.style.setProperty('--logo-text-color', logo.textColor);
    element.style.setProperty('--logo-weight', String(logo.weight ?? 500));
    title.textContent = logo.title;
    subtitle.textContent = logo.subtitle;
    title.hidden = !logo.title;
    subtitle.hidden = !logo.subtitle;
    emblem.hidden = logo.showMark === false;
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
      if (natural > 0) fit = EMBLEM_SIZE / natural;
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
