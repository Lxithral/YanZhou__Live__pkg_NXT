import { createModuleLayer } from './module-layer.js';

const STYLE_ID = 'yanzhou-program-renderer-style';

const STYLES = `
.program-panel { display: flex; flex-direction: column; gap: 9px; width: max-content; min-width: min(280px, var(--program-width)); max-width: var(--program-width); padding: 14px 16px; border-inline-start: 3px solid var(--program-accent); border-radius: 4px; background: rgba(18, 22, 31, .96); }
.program-head { display: flex; align-items: center; gap: 9px; }
.program-label { font-size: 14px; font-weight: 550; color: var(--program-accent); }
.program-current { font-size: 27px; font-weight: 650; line-height: 1.2; color: var(--program-text-color); }
.program-next { display: flex; align-items: baseline; gap: 8px; padding-top: 9px; border-top: 1px solid rgba(255, 255, 255, .17); font-size: 16px; line-height: 1.2; color: #c7ceda; }
.program-next-label { color: var(--program-accent); }
.program-label, .program-current, .program-next-name, .program-next-label { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.program-head[hidden], .program-next[hidden], .program-next-label[hidden], .program-next-name[hidden] { display: none; }
`;

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

export function createProgramRenderer(container) {
  installStyles();
  const layer = createModuleLayer(container, {
    className: 'program-board',
    bodyHTML: '<div class="program-panel"><div class="program-head"><span class="program-label"></span></div><div class="program-current"></div><div class="program-next"><span class="program-next-label"></span><span class="program-next-name"></span></div></div>',
  });
  const { element, body } = layer;
  const label = body.querySelector('.program-label');
  const current = body.querySelector('.program-current');
  const next = body.querySelector('.program-next');
  const nextLabel = body.querySelector('.program-next-label');
  const nextName = body.querySelector('.program-next-name');
  let shown = false;

  return {
    element,
    body,
    update(program, { animate = true } = {}) {
      const visible = program.visible && Boolean(program.current.trim() || program.next.trim());
      layer.update({ ...program, visible });
      element.style.setProperty('--program-accent', program.accentColor);
      element.style.setProperty('--program-text-color', program.textColor);
      element.style.setProperty('--program-width', `${480 / Math.max(1, program.scale)}px`);
      const changed = current.textContent !== program.current || nextName.textContent !== program.next;
      label.textContent = program.label;
      current.textContent = program.current;
      nextLabel.textContent = program.nextLabel;
      nextName.textContent = program.next;
      label.parentElement.hidden = !program.label.trim();
      current.hidden = !program.current.trim();
      nextLabel.hidden = !program.nextLabel;
      nextName.hidden = !program.next;
      next.hidden = !program.next.trim();
      if (changed && shown && visible && animate) {
        for (const row of [current, next]) {
          row.getAnimations().forEach((animation) => animation.cancel());
          if (!row.hidden) row.animate([
            { opacity: .3, transform: 'translateY(5px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ], { duration: 240, easing: 'ease-out' });
        }
      }
      shown = visible;
      element.setAttribute('aria-label', [program.label, program.current, program.nextLabel, program.next].filter(Boolean).join(' · ') || '节目单');
    },
    getBounds: () => layer.getBounds(),
  };
}
