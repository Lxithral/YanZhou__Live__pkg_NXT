const MARK_GAP = 24;
const MIN_WIDTH = 360;

/**
 * Width a caption board may use without running under the corner event mark.
 * The board starts at the module's x, so the limit is measured from the mark's
 * left edge. When the mark is hidden the full width is available again.
 */
export function markLimitedWidth(container, layerElement, maxWidth) {
  const x = Number.parseFloat(layerElement.style.left) || 0;
  const mark = container.querySelector('.event-mark-board');
  const limit = mark && !mark.hidden ? mark.offsetLeft - MARK_GAP - x : Infinity;
  return Math.max(MIN_WIDTH, Math.round(Math.min(maxWidth, limit)));
}
