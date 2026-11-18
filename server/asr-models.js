export const SAMPLE_RATE = 16000;
export const FRAME_SAMPLES = 640;
export const ASR_MODELS = {
  'qwen3-asr-0.6b': { name: 'Qwen/Qwen3-ASR-0.6B', label: 'Qwen3-ASR · 0.6B' },
  'qwen3-asr-1.7b': { name: 'Qwen/Qwen3-ASR-1.7B', label: 'Qwen3-ASR · 1.7B' },
};
export const QWEN_SERVICE_URL = process.env.YZ_QWEN_ASR_URL || 'http://127.0.0.1:8765';
export function serviceUrl(base, endpoint) {
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('YZ_QWEN_ASR_URL 应为 http 或 https 服务地址。');
  }
  return new URL(endpoint, url);
}
