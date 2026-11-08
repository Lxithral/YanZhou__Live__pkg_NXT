import { createModuleLayer } from './module-layer.js';

const STYLE_ID = 'yanzhou-program-renderer-style';

const STYLES = `
.program-panel { display: flex; flex-direction: column; gap: 9px; width: max-content; min-width: 300px; padding: 15px 22px 16px; border: 1px solid rgba(255, 255, 255, 0.09); border-radius: 6px; background: linear-gradient(115deg, rgba(11, 15, 22, 0.93), rgba(16, 21, 30, 0.82)); box-shadow: 0 14px 34px rgba(0, 0, 0, 0.38); }
.program-head { display: flex; align-items: center; gap: 9px; }
.program-accent { width: 18px; height: 2px; flex: 0 0 18px; background: var(--program-accent); }
.program-label { font-size: 11px; font-weight: 500; line-height: 1; letter-spacing: 3.5px; color: var(--program-accent); white-space: pre; }
.program-current { font-size: 27px; font-weight: 500; line-height: 1.15; letter-spacing: 1.5px; color: var(--program-text-color); white-space: pre; }
.program-next { display: flex; align-items: baseline; gap: 10px; padding-top: 9px; border-top: 1px solid rgba(255, 255, 255, 0.13); font-size: 14px; letter-spacing: 1px; color: rgba(255, 255, 255, 0.66); white-space: pre; }
.program-next-label { font-size: 11px; letter-spacing: 2.5px; color: var(--program-accent); white-space: pre; }
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
    bodyHTML: '<div class="program-panel"><div class="program-head"><span class="program-accent" aria-hidden="true"></span><span class="program-label"></span></div><div class="program-current"></div><div class="program-next"><span class="program-next-label"></span><span class="program-next-name"></span></div></div>',
  });
  const { element, body } = layer;
  const label = body.querySelector('.program-label');
  const current = body.querySelector('.program-current');
  const next = body.querySelector('.program-next');
  const nextLabel = body.querySelector('.program-next-label');
  const nextName = body.querySelector('.program-next-name');

  return {
    element,
    body,
    update(program) {
      layer.update(program);
      element.style.setProperty('--program-accent', program.accentColor);
      element.style.setProperty('--program-text-color', program.textColor);
      label.textContent = program.label;
      current.textContent = program.current;
      nextLabel.textContent = program.nextLabel;
      nextName.textContent = program.next;
      label.hidden = !program.label;
      nextLabel.hidden = !program.nextLabel;
      nextName.hidden = !program.next;
      next.hidden = !program.nextLabel && !program.next;
      element.setAttribute('aria-label', [program.label, program.current, program.nextLabel, program.next].filter(Boolean).join(' · ') || '节目单');
    },
    getBounds: () => layer.getBounds(),
  };
}
