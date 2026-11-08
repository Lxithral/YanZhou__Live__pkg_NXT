const STYLE_ID = 'yanzhou-module-layer-style';

const BASE_CSS = `
@font-face { font-family: 'MiSans'; src: url('/assets/fonts/MiSans-Medium.ttf') format('truetype'); font-style: normal; font-weight: 100 900; font-display: block; }
.module-layer { position: absolute; left: 0; top: 0; transform-origin: top left; will-change: transform, opacity; font-family: 'MiSans', sans-serif; line-height: 1; user-select: none; -webkit-user-select: none; }
.module-layer[hidden] { display: none !important; }
.module-body { display: block; }
@keyframes enter-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes exit-fade { from { opacity: 1; } to { opacity: 0; } }
@keyframes enter-fade-up { from { opacity: 0; transform: translateY(26px); } to { opacity: 1; transform: translateY(0); } }
@keyframes exit-fade-up { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-22px); } }
@keyframes enter-fade-down { from { opacity: 0; transform: translateY(-26px); } to { opacity: 1; transform: translateY(0); } }
@keyframes exit-fade-down { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(22px); } }
@keyframes enter-slide-left { from { opacity: 0; transform: translateX(-64px); } to { opacity: 1; transform: translateX(0); } }
@keyframes exit-slide-left { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(-64px); } }
@keyframes enter-slide-right { from { opacity: 0; transform: translateX(64px); } to { opacity: 1; transform: translateX(0); } }
@keyframes exit-slide-right { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(64px); } }
@keyframes enter-scale-in { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
@keyframes exit-scale-in { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.94); } }
`;

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = BASE_CSS;
  document.head.appendChild(style);
}

/**
 * Shared positioned layer used by every packaging module.
 * The outer element carries position / scale / opacity; the inner body runs
 * enter and exit animations, so both transforms never fight each other.
 */
export function createModuleLayer(container, { className = '', bodyHTML = '' } = {}) {
  installStyles();
  const element = document.createElement('div');
  element.className = `module-layer ${className}`.trim();
  const body = document.createElement('div');
  body.className = 'module-body';
  body.innerHTML = bodyHTML;
  element.appendChild(body);
  container.appendChild(element);

  let scale = 1;
  let initialized = false;
  let shown = false;
  let animation = { enter: 'none', exit: 'none', duration: 600 };
  let hideTimer;

  function play(kind) {
    const preset = animation[kind];
    if (!preset || preset === 'none') return;
    body.style.animation = 'none';
    void body.offsetWidth;
    body.style.animation = `${kind}-${preset} ${animation.duration}ms cubic-bezier(0.22, 0.61, 0.36, 1) both`;
  }

  return {
    element,
    body,
    update(module) {
      if (module.animation && typeof module.animation === 'object') animation = module.animation;
      scale = module.scale;
      element.style.left = `${module.x}px`;
      element.style.top = `${module.y}px`;
      element.style.transform = `scale(${scale})`;
      element.style.opacity = `${module.opacity / 100}`;

      const nextShown = Boolean(module.visible);
      if (!initialized) {
        initialized = true;
        shown = nextShown;
        element.hidden = !nextShown;
        return;
      }
      if (nextShown === shown) return;

      clearTimeout(hideTimer);
      shown = nextShown;
      if (nextShown) {
        element.hidden = false;
        play('enter');
      } else if (animation.exit && animation.exit !== 'none') {
        play('exit');
        hideTimer = setTimeout(() => { element.hidden = true; }, animation.duration + 32);
      } else {
        element.hidden = true;
      }
    },
    getBounds() {
      const wasHidden = element.hidden;
      if (wasHidden) element.hidden = false;
      const bounds = { width: body.offsetWidth * scale, height: body.offsetHeight * scale };
      if (wasHidden) element.hidden = true;
      return bounds;
    },
  };
}
