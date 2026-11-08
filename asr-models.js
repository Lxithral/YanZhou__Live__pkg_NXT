import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const MODEL_ROOT = path.resolve(process.env.YZ_ASR_MODELS_DIR ||
  fileURLToPath(new URL('./.asr-models/', import.meta.url)));
export const SAMPLE_RATE = 16000;
export const FRAME_SAMPLES = 640;
export const ASR_MODELS = {
  bilingual: {
    name: 'sherpa-onnx-x-asr-160ms-streaming-zipformer-transducer-zh-en-int8-2026-06-05',
    type: 'transducer',
    model: { encoder: 'encoder.int8.onnx', decoder: 'decoder.onnx', joiner: 'joiner.int8.onnx' },
    archiveHash: 'bdf2c0f2474d34bf479871b0f298c74a6f6bf15f24a492dc5401aa3041811915',
  },
  trilingual: {
    name: 'sherpa-onnx-streaming-paraformer-trilingual-zh-cantonese-en',
    type: 'paraformer',
    model: { encoder: 'encoder.int8.onnx', decoder: 'decoder.int8.onnx' },
    revision: '86931b152d37c908528b44d30b431c24a19770da',
    files: {
      'encoder.int8.onnx': { size: 166362800, sha256: '6047a644b41b236d9d8e89e3b94ef39d1b7037daab028131b722ca52e10b0357' },
      'decoder.int8.onnx': { size: 72062549, sha256: '545427acf508452b7d89969be082c8128c681e3432ff43aef09f6159f4b61a7e' },
      'tokens.txt': { size: 81289, gitSha1: 'd2a387e28f387785496c1446816e8c78abfc6cb0' },
    },
  },
};

export async function modelAvailable(mode, root = MODEL_ROOT) {
  const model = ASR_MODELS[mode];
  const files = await Promise.all(['tokens.txt', ...Object.values(model.model)].map(async (file) => {
    const info = await stat(path.join(root, model.name, file)).catch(() => null);
    return info?.isFile() && info.size > 0 && (!model.files || info.size === model.files[file].size);
  }));
  return files.every(Boolean);
}
