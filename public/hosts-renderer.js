import { createModuleLayer } from './module-layer.js';

const STYLE_ID = 'yanzhou-hosts-renderer-style';

const STYLES = `
.hosts-panel { display: flex; align-items: stretch; width: max-content; min-width: 280px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.09); border-radius: 5px; background: linear-gradient(100deg, rgba(11, 15, 22, 0.93), rgba(16, 21, 30, 0.82)); box-shadow: 0 14px 34px rgba(0, 0, 0, 0.38); }
.hosts-accent { flex: 0 0 4px; background: var(--hosts-accent); }
.hosts-main { display: flex; flex-direction: column; gap: 6px; padding: 12px 26px 13px; }
.hosts-label { font-size: 12px; font-weight: 500; line-height: 1; letter-spacing: 4px; color: var(--hosts-accent); white-space: pre; }
.hosts-names { font-size: 26px; font-weight: 500; line-height: 1.1; letter-spacing: 2px; color: var(--hosts-text-color); white-space: pre; }
.hosts-label[hidden], .hosts-names[hidden] { display: none; }
`;

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

function formatNames(names) {
  return String(names || '')
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean)
    .join('  ');
}

export function createHostsRenderer(container) {
  installStyles();
  const layer = createModuleLayer(container, {
    className: 'hosts-lowerthird',
    bodyHTML: '<div class="hosts-panel"><span class="hosts-accent" aria-hidden="true"></span><div class="hosts-main"><div class="hosts-label"></div><div class="hosts-names"></div></div></div>',
  });
  const { element, body } = layer;
  const label = body.querySelector('.hosts-label');
  const names = body.querySelector('.hosts-names');

  return {
    element,
    body,
    update(hosts) {
      layer.update(hosts);
      element.style.setProperty('--hosts-accent', hosts.accentColor);
      element.style.setProperty('--hosts-text-color', hosts.textColor);
      const formattedNames = formatNames(hosts.names);
      label.textContent = hosts.label;
      names.textContent = formattedNames;
      label.hidden = !hosts.label;
      names.hidden = !formattedNames;
      element.setAttribute('aria-label', [hosts.label, formattedNames].filter(Boolean).join('：') || '主持字幕');
    },
    getBounds: () => layer.getBounds(),
  };
}
