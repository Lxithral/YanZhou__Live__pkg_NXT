export const SAMPLE_RATE = 16000;
export const FRAME_SAMPLES = 640;
export const ASR_MODELS = {
  'qwen3-asr-0.6b': { name: 'Qwen/Qwen3-ASR-0.6B', label: 'Qwen3-ASR · 0.6B' },
  'qwen3-asr-1.7b': { name: 'Qwen/Qwen3-ASR-1.7B', label: 'Qwen3-ASR · 1.7B' },
};
export const DEFAULT_QWEN_MODEL = '0.6b';
export const DEFAULT_QWEN_SERVICE_URL = 'http://127.0.0.1:8765';
export const QWEN_SERVICE_URL = process.env.YZ_QWEN_ASR_URL || DEFAULT_QWEN_SERVICE_URL;
export function serviceUrl(base, endpoint) {
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('YZ_QWEN_ASR_URL 应为 http 或 https 服务地址。');
  }
  return new URL(endpoint, url);
}

export async function readQwenHealth(base = QWEN_SERVICE_URL, token = process.env.YZ_QWEN_ASR_TOKEN) {
  const response = await fetch(serviceUrl(base, '/health'), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(1500),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const state = await response.json();
  if (!Object.hasOwn(ASR_MODELS, state?.model) || state.sampleRate !== SAMPLE_RATE || typeof state.ready !== 'boolean') {
    throw new Error('服务协议或模型不匹配');
  }
  return state;
}
