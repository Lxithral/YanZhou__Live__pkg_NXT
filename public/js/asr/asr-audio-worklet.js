class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.phase = 0;
    this.sum = 0;
    this.offset = 0;
    this.pcm = new DataView(new ArrayBuffer(1280));
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let index = 0; index < channels[0].length; index += 1) {
      let mono = 0;
      for (const channel of channels) mono += channel[index] / channels.length;
      let remaining = 1;
      while (remaining > 1e-8) {
        const weight = Math.min(remaining, this.ratio - this.phase);
        this.phase += weight;
        this.sum += mono * weight;
        remaining -= weight;
        if (this.phase + 1e-8 < this.ratio) continue;
        const value = Math.max(-1, Math.min(1, this.sum / this.ratio));
        this.pcm.setInt16(this.offset, Math.round(value * (value < 0 ? 32768 : 32767)), true);
        this.phase = 0;
        this.sum = 0;
        this.offset += 2;
        if (this.offset === this.pcm.byteLength) {
          this.port.postMessage(this.pcm.buffer, [this.pcm.buffer]);
          this.pcm = new DataView(new ArrayBuffer(1280));
          this.offset = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('yanzhou-pcm-capture', PcmCapture);
