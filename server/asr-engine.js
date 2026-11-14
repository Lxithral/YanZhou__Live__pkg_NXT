import { createRequire } from 'node:module';
import path from 'node:path';
import { ASR_MODELS, SAMPLE_RATE } from './asr-models.js';

const require = createRequire(import.meta.url);
const [mode, modelRoot] = process.argv.slice(2);
const { OnlineRecognizer } = require('sherpa-onnx-node');
const spec = ASR_MODELS[mode];
const folder = path.join(modelRoot, spec.name);
const recognizer = new OnlineRecognizer({
  featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
  modelConfig: {
    [spec.type]: Object.fromEntries(Object.entries(spec.model).map(([key, file]) => [key, path.join(folder, file)])),
    tokens: path.join(folder, 'tokens.txt'),
    provider: 'cpu', numThreads: 2, debug: false,
  },
  enableEndpoint: true, rule2MinTrailingSilence: 1.2, rule3MinUtteranceLength: 15,
  decodingMethod: 'greedy_search',
});

let stream = recognizer.createStream();
let segmentSamples = 0;
let observation;
let lastVoiceAt;

function accept(samples) {
  stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
  while (recognizer.isReady(stream)) recognizer.decode(stream);
}

process.on('message', ({ pcm, receivedAt }) => {
  const samples = new Float32Array(pcm.length / 2);
  let energy = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = pcm.readInt16LE(index * 2) / 32768;
    samples[index] = sample;
    energy += sample * sample;
  }
  if (energy / samples.length >= .000064) lastVoiceAt = receivedAt;
  segmentSamples += samples.length;
  accept(samples);
  const final = recognizer.isEndpoint(stream);
  if (final && spec.type === 'paraformer') accept(new Float32Array(SAMPLE_RATE * .8));
  const result = recognizer.getResult(stream);
  const text = result.text.trim().slice(-500);
  const changed = text && text !== observation?.text;
  if (changed) {
    const timestamp = result.timestamps?.at(-1);
    const timed = Number.isFinite(timestamp) && timestamp >= 0 && result.timestamps.length === result.tokens?.length;
    // Paraformer has no token times. Estimate from the audio frame that yielded
    // the new suffix, capped at the last audible frame for endpoint results.
    const elapsed = segmentSamples * 1000 / SAMPLE_RATE;
    const stamp = ((result.start_time ?? 0) + timestamp) * 1000;
    const useTimestamp = timed && stamp <= elapsed;
    const at = useTimestamp ? receivedAt - (elapsed - stamp) :
      Math.min(receivedAt - 500, lastVoiceAt ?? receivedAt);
    observation = { text, at, estimated: !useTimestamp };
  }
  const event = text && (changed || final) ? { ...observation, final } : undefined;
  if (final) {
    stream = recognizer.createStream();
    segmentSamples = 0;
    lastVoiceAt = undefined;
    observation = undefined;
  }
  process.send({ type: 'frame', event });
});
process.send({ type: 'ready' });
