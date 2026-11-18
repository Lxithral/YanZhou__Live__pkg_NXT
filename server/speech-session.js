// Transcripts are ephemeral: never save or restore speech after a restart.
export function createSpeechSession({ holdSeconds, onChange, now = Date.now }) {
  let current = '';
  let partial = false;
  let updatedAt = 0;
  let expiresAt = 0;
  let timer;
  const snapshot = () => ({ type: 'speech:state', text: current, partial, updatedAt, expiresAt, serverTime: now() });
  function clear() {
    clearTimeout(timer);
    if (!current) return;
    current = '';
    partial = false;
    expiresAt = 0;
    onChange(snapshot());
  }
  return {
    snapshot,
    accept(event) {
      current = event.text;
      partial = !event.final;
      updatedAt = now();
      expiresAt = updatedAt + holdSeconds() * 1000;
      clearTimeout(timer);
      timer = setTimeout(clear, expiresAt - updatedAt);
      timer.unref?.();
      onChange(snapshot());
    },
    clear,
    close() { clearTimeout(timer); },
  };
}
