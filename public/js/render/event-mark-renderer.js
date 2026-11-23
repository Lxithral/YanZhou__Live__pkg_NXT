import { createModuleLayer } from '../core/module-layer.js';

const STYLE_ID = 'yanzhou-event-mark-renderer-style';

const STYLES = `
.event-mark-board .event-mark-image { display: block; width: 420px; height: auto; aspect-ratio: 1720 / 346; }
`;

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.append(style);
}

export function createEventMarkRenderer(container) {
  installStyles();
  const layer = createModuleLayer(container, {
    className: 'event-mark-board',
    bodyHTML: '<img class="event-mark-image" src="/assets/singing-competition-mark-4th.png?v=3" alt="烟洲中学 · 第四届歌手大赛" width="1720" height="346">',
  });
  return {
    element: layer.element,
    body: layer.body,
    update(settings) { layer.update(settings); },
    getBounds: () => layer.getBounds(),
  };
}
