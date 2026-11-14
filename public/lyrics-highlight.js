const rows = new WeakMap();

// Ordinary LRC has line times only. Spread its characters across that line's
// interval, while enhanced LRC keeps the supplied word or character times.
export function highlightLyrics(element, line, position, end) {
  let row = rows.get(element);
  if (row?.line !== line || row?.end !== end) {
    const tokens = line && !line.credit ? line.tokens : [];
    const characters = line && !line.credit ? [...line.text] : [];
    const timing = tokens?.length ? tokens : characters.map((text, index) => ({
      text, start: line.start + (end - line.start) * index / characters.length,
    }));
    const spans = timing.map(({ text }) => {
      const span = document.createElement('span');
      span.className = 'lyric-highlight-token';
      span.textContent = text;
      return span;
    });
    if (line?.credit) element.textContent = line.text;
    else element.replaceChildren(...spans);
    row = { line, end, timing, spans, fills: [] };
    rows.set(element, row);
  }
  for (const [index, token] of row.timing.entries()) {
    if (!row.spans[index]) continue;
    const until = row.timing[index + 1]?.start ?? end;
    const fill = Math.max(0, Math.min(100, (position - token.start) / Math.max(1, until - token.start) * 100)).toFixed(1);
    if (row.fills[index] === fill) continue;
    row.spans[index].style.setProperty('--fill', fill + '%');
    row.fills[index] = fill;
  }
}

export function clearLyricHighlight(element, text) {
  rows.delete(element);
  element.textContent = text;
}

export const LYRIC_HIGHLIGHT_CSS = `
.lyric-highlight-token {
  color: transparent;
  background-image: linear-gradient(90deg, var(--highlight-color) var(--fill, 0%), var(--highlight-base) var(--fill, 0%));
  background-clip: text;
  -webkit-background-clip: text;
  text-shadow: none;
}
`;
