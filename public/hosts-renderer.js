import { createModuleLayer, isLightColor } from './module-layer.js';
// 原项目的三款人物字幕实现（H 烟洲新闻 / G 烟洲校色 / I 烟洲印记），原样引入，提供 window.HostAppearance。
import './host-appearance.js';

const HostAppearance = globalThis.HostAppearance;
const STYLE_ID = 'yanzhou-hosts-renderer-style';
const SHEETS = ['/host-appearance.css', '/school-watermark.css'];
// 原项目由全局样式提供的字号（见参考项目 index.html），只作用于信息条内部。
const STYLES = `
.hosts-board .host-visual { font-family: 'Microsoft YaHei', 'MiSans', sans-serif; font-size: 30px; line-height: normal; }
.hosts-board .host-visual .names { font-size: 44px; line-height: 1.3; }
.hosts-board .host-visual .sub { font-size: 22px; }
.hosts-board .host-visual .hidden { display: none; }
`;

export const HOSTS_STYLES = [
  { id: 'h', name: 'H · 烟洲新闻', hint: '白底长条，深蓝标签居中、底栏贯穿；最多两人' },
  { id: 'g', name: 'G · 烟洲校色', hint: '暖白底、绛红双线边框' },
  { id: 'i', name: 'I · 烟洲印记', hint: '白底、左侧绛红边、右侧淡校徽' },
];
export const DEFAULT_HOSTS_STYLE = 'h';

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  for (const href of SHEETS) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.append(link);
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.append(style);
}

function parseEntries(names) {
  return String(names ?? '').split(/\r?\n/).map((line) => {
    const separator = line.search(/[｜|]/u);
    return separator < 0 ? { name: line.trim(), title: '' } : {
      name: line.slice(0, separator).trim(),
      title: line.slice(separator + 1).trim(),
    };
  }).filter(({ name }) => name);
}

/** 原项目的样式配置；勾选「自定义颜色」时用强调色 / 文字颜色覆盖标签与姓名颜色。 */
export function hostsAppearance(hosts) {
  const style = HOSTS_STYLES.some(({ id }) => id === hosts.style) ? hosts.style : DEFAULT_HOSTS_STYLE;
  const appearance = HostAppearance.template(style);
  if (hosts.customColors) {
    appearance.tagColor = hosts.accentColor.toLowerCase();
    appearance.tagTextColor = isLightColor(hosts.accentColor) ? '#10131f' : '#ffffff';
    appearance.textColor = hosts.textColor.toLowerCase();
    if (style !== 'h') appearance.borderColor = hosts.accentColor.toLowerCase();
    appearance.customized = true;
  }
  return appearance;
}

export function createHostsRenderer(container) {
  installStyles();
  const layer = createModuleLayer(container, {
    className: 'hosts-board',
    bodyHTML: '<div class="host-visual"><span class="tag"></span><span class="names"></span><span class="sub"></span></div>',
  });
  const visual = layer.body.firstElementChild;
  let shown = false;

  function getPositionLimits() {
    const { width, height } = layer.getBounds();
    return {
      minX: 96, maxX: Math.max(96, Math.floor(1824 - width)),
      minY: 54, maxY: Math.max(54, Math.floor(1026 - height)),
    };
  }

  return {
    ...layer,
    getPositionLimits,
    update(hosts, { animate = true, constrain = true } = {}) {
      const entries = parseEntries(hosts.names).slice(0, Math.round(hosts.slotCount || 2));
      const visible = hosts.visible && entries.length > 0;
      layer.update({ ...hosts, visible });
      const wasHidden = layer.element.hidden;
      if (wasHidden) layer.element.hidden = false;
      HostAppearance.update(visual, {
        title: hosts.label,
        names: entries.map(({ name }) => name).join('、'),
        subtitle: '',
        appearance: hostsAppearance(hosts),
        // 画面上已显示时用原项目的平滑过渡（换人、换样式），其余情况直接切换。
        animation: visible && shown && animate ? 'rise' : 'none',
      });
      if (wasHidden) layer.element.hidden = true;
      if (constrain) {
        const limits = getPositionLimits();
        layer.element.style.left = `${Math.min(limits.maxX, Math.max(limits.minX, hosts.x))}px`;
        layer.element.style.top = `${Math.min(limits.maxY, Math.max(limits.minY, hosts.y))}px`;
      }
      shown = visible;
      layer.element.setAttribute('aria-label', [hosts.label, ...entries.map(({ name }) => name)].filter(Boolean).join(' · ') || '人物信息条');
    },
  };
}
