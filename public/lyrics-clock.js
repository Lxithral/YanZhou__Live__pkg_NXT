export function createLyricsClock() {
  let state;
  let anchor;
  let doc = [];
  let manualSource = [];
  let documentLines = [];
  let asr;
  let asrLines = [];
  return {
    get state() { return state; },
    get doc() { return doc; },
    get lines() { return manualSource ?? documentLines; },
    get asr() { return asr; },
    get asrLines() { return asrLines; },
    applyAsr(message) {
      const latest = message.finals.at(-1);
      const previous = asr?.finals.at(-1);
      if (latest?.at !== previous?.at || message.finals.length !== asrLines.length) {
        asrLines = message.finals.map(({ text }) => text);
      }
      asr = message;
    },
    apply(message) {
      const transit = Math.max(0, Math.min(2000, Date.now() - message.serverTime));
      anchor = performance.now() - transit;
      state = message;
      if (message.doc) {
        doc = message.doc;
        documentLines = doc.map((line) => line.text);
      }
      if (Object.hasOwn(message.manual, 'lines')) manualSource = message.manual.lines;
    },
    position(now = performance.now()) {
      if (!state) return 0;
      const { position, end, playing, rate, adjustment } = state.transport;
      const elapsed = playing ? Math.max(0, now - anchor) : 0;
      const correction = adjustment ? adjustment.delta * Math.min(1, elapsed / adjustment.duration) : 0;
      return Math.min(end, Math.max(0, position + elapsed * rate + correction));
    },
    remaining() {
      if (state?.manual.remaining == null) return null;
      return Math.max(0, state.manual.remaining - (performance.now() - anchor));
    },
  };
}
