// 票根卡「介绍」区域：3 行可视区，放不下时按阅读速度竖向慢慢上滚 + 右侧细竖条（类似滚动条）。
// 纯计算部分，无 DOM，可单元测试。
//
// 速度依据（详见 README）：Netflix 简体中文字幕成人上限 9 字/秒、儿童 7 字/秒；
// 眼动研究中成人中文句子阅读约 260 字/分（≈4.3 字/秒）；滚动文字比静态文字更难读。
// 直播画面里介绍是次要信息，取舒适偏慢的 3.5 字/秒（210 字/分）。
// 竖向换算：每行字数 = 可视宽 ÷ 字宽；读完一行用时 = 每行字数 ÷ 3.5；速度 = 行高 ÷ 读完一行用时。

export const INTRO_SCROLL = Object.freeze({
  charsPerSecond: 3.5,  // 阅读速度：每秒多少个汉字
  fontSize: 14.25,      // 介绍字号（卡片 100% 时，一个汉字宽 = 字号）
  lineHeight: 1.65,     // 行高倍数
  lines: 3,             // 可视行数
  pause: 1500,          // 入场动画结束 / 切换节目后先静止多久（毫秒，和表演者一致）
  holdEnd: 2500,        // 滚到文末后停留
  fadeOut: 300,         // 文末淡出
  fadeIn: 300,          // 回到开头淡入
  holdStart: 1500,      // 回到开头后再停留，然后开始下一轮
  fade: 5,              // 上下渐隐高度（像素）
  minThumb: 0.12,       // 竖条亮段最短占比，太长的介绍也保证看得见
});

const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;

/** 阅读速度（字/秒）→ 竖向滚动速度（像素/秒）。 */
export function introSpeed({
  viewportWidth, charsPerSecond = INTRO_SCROLL.charsPerSecond,
  fontSize = INTRO_SCROLL.fontSize, lineHeight = fontSize * INTRO_SCROLL.lineHeight,
} = {}) {
  if (!(viewportWidth > 0) || !(fontSize > 0) || !(charsPerSecond > 0)) return 0;
  const charsPerLine = viewportWidth / fontSize;
  const secondsPerLine = charsPerLine / charsPerSecond;
  return round(lineHeight / secondsPerLine);
}

/** 放得下（1px 容差）返回 null；放不下返回一轮的时间表：上滚 → 文末停留 → 淡出 → 回开头淡入 → 开头停留。 */
export function introPlan({ contentHeight, viewportHeight, speed, timing = INTRO_SCROLL }) {
  if (!(contentHeight > 0) || !(viewportHeight > 0) || !(speed > 0)) return null;
  if (contentHeight <= viewportHeight + 1) return null;
  const distance = Math.round((contentHeight - viewportHeight) * 100) / 100;
  const scroll = Math.round(distance / speed * 1000);
  const total = scroll + timing.holdEnd + timing.fadeOut + timing.fadeIn + timing.holdStart;
  return {
    distance, scroll, total, speed,
    offsets: {
      scrolled: scroll / total,
      fadeStart: (scroll + timing.holdEnd) / total,
      reset: (scroll + timing.holdEnd + timing.fadeOut) / total,
      back: (scroll + timing.holdEnd + timing.fadeOut + timing.fadeIn) / total,
    },
  };
}

/** 竖条：滑块长度 = 可视高度 ÷ 全文高度（最短 minThumb）；barLength 是竖条底轨的高度，位置随滚动进度从顶部走到底部。 */
export function introBar({ contentHeight, viewportHeight, barLength = viewportHeight, minThumb = INTRO_SCROLL.minThumb }) {
  if (!(contentHeight > 0) || !(barLength > 0)) return { ratio: 1, thumb: barLength || 0, travel: 0 };
  const ratio = Math.min(1, Math.max(minThumb, viewportHeight / contentHeight));
  const thumb = Math.round(barLength * ratio * 100) / 100;
  return { ratio, thumb, travel: Math.round((barLength - thumb) * 100) / 100 };
}

/** 滑块在滚动进度 progress（0–1）时离顶部的偏移。 */
export function introBarOffset(progress, travel) {
  return Math.round(Math.min(1, Math.max(0, progress)) * travel * 100) / 100;
}

/** 文字轨道和竖条滑块的关键帧（都是竖向），两者用同一时长 / 延迟播放，始终同步。 */
export function introKeyframes(plan, travel) {
  const { scrolled, fadeStart, reset, back } = plan.offsets;
  const y = (v) => `translate3d(0, ${v}px, 0)`;
  const d = -plan.distance;
  return {
    track: [
      { offset: 0, transform: y(0), opacity: 1 },
      { offset: scrolled, transform: y(d), opacity: 1 },
      { offset: fadeStart, transform: y(d), opacity: 1 },
      { offset: reset, transform: y(d), opacity: 0 },
      { offset: reset, transform: y(0), opacity: 0 },
      { offset: back, transform: y(0), opacity: 1 },
      { offset: 1, transform: y(0), opacity: 1 },
    ],
    thumb: [
      { offset: 0, transform: y(0) },
      { offset: scrolled, transform: y(travel) },
      { offset: fadeStart, transform: y(travel) },
      { offset: back, transform: y(0) },
      { offset: 1, transform: y(0) },
    ],
  };
}
