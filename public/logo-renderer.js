import { createModuleLayer } from './module-layer.js';

const STYLE_ID = 'yanzhou-logo-renderer-style';

const STYLES = `
.logo-body { display: flex; align-items: center; gap: 18px; width: max-content; }
.logo-emblem { display: block; flex: 0 0 88px; width: 88px; height: 88px; background: var(--logo-color); -webkit-mask: url('/assets/logo-mask.png') center / contain no-repeat; mask: url('/assets/logo-mask.png') center / contain no-repeat; filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.28)); }
.logo-copy { display: flex; flex-direction: column; justify-content: center; gap: 11px; color: var(--logo-text-color); white-space: pre; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.38); }
.logo-copy.is-stretched { height: 88px; justify-content: space-between; gap: 0; }
.logo-copy[hidden], .logo-title[hidden], .logo-subtitle[hidden] { display: none; }
.logo-title { font-size: 30px; font-weight: 500; line-height: 1.2; letter-spacing: 1px; }
.logo-subtitle { font-size: 13px; font-weight: 500; line-height: 1.2; letter-spacing: 2.4px; }
`;

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
    bodyHTML: '<div class="logo-body"><span class="logo-emblem" aria-hidden="true"></span><div class="logo-copy"><div class="logo-title"></div><div class="logo-subtitle"></div></div></div>',
  });
  const { element, body } = layer;
  const copy = body.querySelector('.logo-copy');
  const emblem = body.querySelector('.logo-emblem');
  const title = body.querySelector('.logo-title');
  const subtitle = body.querySelector('.logo-subtitle');

  return {
    element,
    body,
    update(logo) {
      layer.update(logo);
      element.style.setProperty('--logo-color', logo.color);
      element.style.setProperty('--logo-text-color', logo.textColor);
      title.textContent = logo.title;
      subtitle.textContent = logo.subtitle;
      title.hidden = !logo.title;
      subtitle.hidden = !logo.subtitle;
      emblem.hidden = logo.showMark === false;
      // With the emblem shown and both lines present, stretch the text block to
      // the emblem height: title on the top edge, subtitle on the bottom edge.
      copy.classList.toggle('is-stretched', emblem.hidden === false && !!logo.title && !!logo.subtitle);
      copy.hidden = !logo.title && !logo.subtitle;
      element.setAttribute('aria-label', [logo.title, logo.subtitle].filter(Boolean).join(' · ') || '烟洲中学校徽');
    },
    getBounds: () => layer.getBounds(),
  };
}
