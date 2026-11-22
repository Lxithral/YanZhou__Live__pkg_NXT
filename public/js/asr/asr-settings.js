export const REALTIME_MODEL = 'qwen3-asr-flash-realtime';
export const STREAMING_MODEL = 'qwen-audio-3.0-asr-flash-streaming';
export const MAX_HOTWORDS = 50;
export const MAX_HOTWORD_TEXT = 3000;
// 下拉列表里代表「自己填模型 ID」的占位值，不会发给服务端。
export const CUSTOM_MODEL = '__custom';
const MODEL_ID = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/iu;

// 百炼的两类实时接口：型号名里带 streaming 的走流式任务，其余走实时会话。
export function usesStreamingProtocol(model) {
  return model === STREAMING_MODEL || /streaming/iu.test(model);
}

export const SCHOOL_HOTWORDS = Object.freeze([
  '烟洲', '烟洲中学', '中山市烟洲中学',
  '烟洲中学广播电视总台', '中山市烟洲中学广播电视总台',
]);

// 本届主持人姓名和节目单中的节目名称。
export const CONTEST_HOTWORDS_2026 = Object.freeze([
  ...SCHOOL_HOTWORDS,
  '罗智健', '周子谈', '瞿洁', '程紫芸',
  "任我行",
  "至少还有你",
  "Rolling in the Deep",
  "天若有情",
  "天上掉下个林妹妹",
  "那些你很冒险的梦",
  "雨天",
  "For the First Time in Forever",
  "野心家",
  "素颜",
  "身骑白马",
  "刻在我心底的名字",
]);

export function splitHotwords(text) {
  return [...new Set(text.split(/[,，、\n]/u).map((word) => word.trim()).filter(Boolean))];
}

export function validateAsrOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some((key) => !['model', 'hotwords'].includes(key))) {
    throw new Error('识别设置格式无效。');
  }
  const { model = REALTIME_MODEL, hotwords = '' } = options;
  if (typeof model !== 'string' || !MODEL_ID.test(model) ||
      typeof hotwords !== 'string' || hotwords.length > MAX_HOTWORD_TEXT) {
    throw new Error('识别模型 ID 或热词格式无效。');
  }
  const words = splitHotwords(hotwords);
  if (words.length && !usesStreamingProtocol(model)) throw new Error('请切换到流式模型再使用热词。');
  if (words.length > MAX_HOTWORDS || words.some((word) =>
    /[\u0000-\u001f\u007f]/u.test(word) ||
    (/[^\x00-\x7f]/u.test(word) ? [...word].length > 15 : word.length > 80 || word.split(/ +/u).length > 7))) {
    throw new Error(`最多 ${MAX_HOTWORDS} 个热词。含中文时每项最多 15 字，英文每项最多 7 个单词、80 字符。`);
  }
  return { model, vocabulary: Object.fromEntries(words.map((word) => [word, 5])) };
}
