// 票根卡「表演者」区域的竖向无缝循环滚动：纯计算部分（无 DOM，可单元测试）。
// 做法参考直播字幕 ticker 的常见写法：内容复制一份接在后面，整条轨道用 transform 匀速平移
// 「一份内容 + 间隔」的距离后无缝回到起点（等同 translate -50% 的经典 marquee 替代方案）。

export const PERF_SCROLL = Object.freeze({
  speed: 24,      // 每秒滚动像素（卡片 100% 尺寸下）
  pause: 1500,    // 入场动画结束 / 切换节目后，先静止多久再开始滚（毫秒）
  gap: 22,        // 两份内容之间的空白（像素，约一行）
  fade: 5,        // 上下边缘渐隐遮罩高度（像素）
  lines: 2,       // 可视区域行数（和原来的 2 行一致）
});

/** 放得下（含 1px 容差）返回 null，静止显示；放不下返回滚动距离和一圈时长。 */
export function scrollPlan({ contentHeight, viewportHeight, gap = PERF_SCROLL.gap, speed = PERF_SCROLL.speed }) {
  if (!(contentHeight > 0) || !(viewportHeight > 0) || !(speed > 0)) return null;
  if (contentHeight <= viewportHeight + 1) return null;
  const distance = Math.round((contentHeight + Math.max(0, gap)) * 100) / 100;
  return { distance, duration: Math.round(distance / speed * 1000) };
}

/** 开始滚动前的等待：卡片刚入场时先等入场动画放完，再静止 pause 毫秒。 */
export function startDelay({ entering = false, enter = 'none', duration = 0 } = {}, pause = PERF_SCROLL.pause) {
  const enterTime = entering && enter && enter !== 'none' ? Math.max(0, Number(duration) || 0) : 0;
  return enterTime + pause;
}

/** 循环关键帧：从 0 平移到 -distance，正好对上第二份内容的起点。 */
export function scrollKeyframes(distance) {
  return [{ transform: 'translate3d(0, 0, 0)' }, { transform: `translate3d(0, ${-distance}px, 0)` }];
}
