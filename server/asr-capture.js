import { WebSocket } from 'ws';
import { ASR_MODELS, FRAME_SAMPLES, QWEN_SERVICE_URL, SAMPLE_RATE, readQwenHealth, serviceUrl } from './asr-models.js';

const FRAME_MS = FRAME_SAMPLES * 1000 / SAMPLE_RATE;
const MAX_PENDING = 150; // Bound queued audio to six seconds.

export async function createAsrCapture({ onStatus, onResult, serviceBase = QWEN_SERVICE_URL,
  token = process.env.YZ_QWEN_ASR_TOKEN || '', connectTimeoutMs = 10_000 } = {}) {
  const available = Object.fromEntries(Object.keys(ASR_MODELS).map((id) => [id, false]));
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  serviceUrl(serviceBase, '/health');
  let active;
  let closed = false;
  let message = '';
  let connected = false;
  let refreshTask;

  async function checkHealth() {
    let ready;
    try {
      const health = await readQwenHealth(serviceBase, token);
      connected = true;
      if (health.ready) ready = health.model;
      message = ready ? '' : (typeof health.message === 'string' && health.message.slice(0, 500) || 'Qwen 模型正在加载…');
    } catch {
      connected = false;
      message = '未连接 Qwen 识别服务。';
    }
    for (const id of Object.keys(available)) available[id] = id === ready;
    return { ...available };
  }
  function refresh() {
    if (!refreshTask) refreshTask = checkHealth().finally(() => { refreshTask = undefined; });
    return refreshTask;
  }
  await refresh();

  function reject(socket, reason) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'error', message: reason }));
      socket.close(1008);
    }
  }
  function stop(session, reason = '') {
    if (active !== session) return;
    active = undefined;
    clearTimeout(session.timeout);
    session.upstream.terminate();
    if (session.socket.readyState === WebSocket.OPEN) {
      if (reason) session.socket.send(JSON.stringify({ type: 'error', message: reason }));
      session.socket.close(1000);
    }
    onStatus({ phase: reason ? 'error' : 'idle', mode: session.mode, owner: null, message: reason });
  }

  function attach(socket, mode, owner = 'lyrics') {
    if (closed || active || !['lyrics', 'speech'].includes(owner) || !Object.hasOwn(ASR_MODELS, mode)) {
      reject(socket, active ? '已有页面在采集音频；主持人和歌词识别共用该音源，无需重复启动。' : '识别请求无效。');
      return;
    }
    // Health is refreshable; starting Qwen never requires a Node restart.
    const url = serviceUrl(serviceBase, '/asr');
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('model', mode);
    const upstream = new WebSocket(url, { headers, maxPayload: 32 * 1024, handshakeTimeout: connectTimeoutMs });
    const session = { socket, upstream, mode, owner, ready: false, pending: 0, frames: 0, startAt: null };
    active = session;
    onStatus({ phase: 'loading', mode, owner, message: '' });
    session.timeout = setTimeout(() => stop(session, 'Qwen 识别服务连接超时，请检查服务状态。'), connectTimeoutMs);
    upstream.on('error', () => stop(session, '无法连接 Qwen 识别服务，请检查服务地址、模型和访问令牌。'));
    upstream.on('close', () => stop(session, 'Qwen 识别服务已断开，已停止采集。'));
    upstream.on('message', (data, binary) => {
      if (active !== session) return;
      try {
        if (binary) throw new Error('Qwen 服务返回了无效消息。');
        const packet = JSON.parse(data.toString());
        if (packet.type === 'error') {
          stop(session, String(packet.message || 'Qwen 识别失败。').slice(0, 500));
        } else if (packet.type === 'ready') {
          if (session.ready || packet.model !== mode || packet.sampleRate !== SAMPLE_RATE) throw new Error('Qwen 服务模型或音频格式不匹配。');
          clearTimeout(session.timeout);
          session.timeout = setTimeout(() => stop(session, '未收到音频或识别服务无响应，请检查音源后重新启动。'), 15_000);
          session.ready = true;
          available[mode] = true;
          socket.send(JSON.stringify({ type: 'ready' }));
          onStatus({ phase: 'listening', mode, owner, message: '' });
        } else if (packet.type === 'frame' && session.ready) {
          if (session.pending <= 0) throw new Error('Qwen 服务的音频回执无效。');
          session.pending -= 1;
          session.timeout.refresh();
          if (!packet.event) return;
          const event = packet.event;
          if (typeof event.text !== 'string' || !event.text.trim() || event.text.length > 500 ||
              /[\u0000-\u001F\u007F]/u.test(event.text) || typeof event.final !== 'boolean' ||
              !Number.isFinite(event.audioMs) || event.audioMs < 0 || event.audioMs > session.frames * FRAME_MS) {
            throw new Error('Qwen 服务返回的识别结果无效。');
          }
          // Streaming has no word times. Use audio time, not inference completion time.
          onResult({ text: event.text.trim(), final: event.final,
            at: Math.min(Date.now(), session.startAt + event.audioMs), estimated: true });
        } else throw new Error('Qwen 服务返回了未知消息。');
      } catch (error) { stop(session, error.message); }
    });
    socket.on('close', () => stop(session));
    socket.on('message', (pcm, binary) => {
      if (active !== session) return;
      if (!binary || pcm.length !== FRAME_SAMPLES * 2 || !session.ready) {
        stop(session, '音频格式无效，需使用 16 kHz 单声道。');
        return;
      }
      const now = Date.now();
      session.startAt ??= now - FRAME_MS;
      session.frames += 1;
      if (session.pending >= MAX_PENDING || upstream.bufferedAmount > MAX_PENDING * FRAME_SAMPLES * 2 ||
          session.frames * FRAME_MS > now - session.startAt + 1500) {
        stop(session, 'Qwen 识别积压超过安全范围，已停止采集；请减少直播负载后重试。');
        return;
      }
      session.pending += 1;
      upstream.send(pcm, { binary: true }, (error) => { if (error) stop(session, '音频无法发送到 Qwen 服务。'); });
    });
  }
  return { available, get message() { return message; }, get connected() { return connected; }, refresh, attach,
    stop() { if (active) stop(active); },
    close() { closed = true; if (active) stop(active); },
  };
}
