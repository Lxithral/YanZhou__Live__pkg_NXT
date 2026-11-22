// Transcripts are ephemeral: never save or restore speech after a restart.
export function createSpeechSession({ onChange }) {
  let current = '';
  let partial = false;
  const snapshot = () => ({ type: 'speech:state', text: current, partial });
  function clear() {
    if (!current) return;
    current = '';
    partial = false;
    onChange(snapshot());
  }
  return {
    snapshot,
    accept(event) {
      current = event.text;
      partial = !event.final;
      onChange(snapshot());
    },
    clear,
  };
}
