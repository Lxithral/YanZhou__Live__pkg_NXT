export function createLyricsClock() {
  let state;
  let anchor;
  let doc = [];
  let lines = [];
  return {
    get state() { return state; },
    get doc() { return doc; },
    get lines() { return lines; },
    apply(message) {
      const transit = Math.max(0, Math.min(2000, Date.now() - message.serverTime));
      anchor = performance.now() - transit;
      state = message;
      if (message.doc) doc = message.doc;
      if (message.manual.lines) lines = message.manual.lines;
    },
    position(now = performance.now()) {
      if (!state) return 0;
      const { position, end, playing, rate } = state.transport;
      return Math.min(end, position + (playing ? Math.max(0, now - anchor) * rate : 0));
    },
    remaining() {
      if (state?.manual.remaining == null) return null;
      return Math.max(0, state.manual.remaining - (performance.now() - anchor));
    },
  };
}
