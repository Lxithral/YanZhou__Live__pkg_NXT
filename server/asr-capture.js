import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { WebSocket } from 'ws';
import { STREAMING_MODEL, validateAsrOptions } from '../public/js/asr/asr-settings.js';

const SAMPLE_RATE = 16_000;
const FRAME_MS = 40;
const FRAME_BYTES = SAMPLE_RATE * FRAME_MS / 1000 * 2;
const SESSION_OPTIONS = {
  modalities: ['text'],
  input_audio_format: 'pcm',
  sample_rate: SAMPLE_RATE,
  turn_detection: { type: 'server_vad', threshold: 0.0, silence_duration_ms: 400 },
};
const MISSING_KEY = '请在项目的 .env 中填写 DASHSCOPE_API_KEY，然后重启启动窗口。';
const CONNECTION_FAILED = '无法连接百炼实时识别，请检查网络后重试。';
const PROTOCOL_FAILED = '百炼实时识别返回了无法处理的消息，请重试。';

export async function readDashScopeConfig(file, env = process.env) {
  let values = {};
  try {
    values = parseEnv((await readFile(file, 'utf8')).replace(/^\uFEFF/u, ''));
  } catch (error) {
    if (error.code !== 'ENOENT') return { configError: '无法读取 .env，请检查文件后重启。' };
  }
  return {
    apiKey: env.DASHSCOPE_API_KEY ?? values.DASHSCOPE_API_KEY,
    workspaceId: env.DASHSCOPE_WORKSPACE_ID ?? values.DASHSCOPE_WORKSPACE_ID,
  };
}

function cloudError(code) {
  const value = typeof code === 'number' || typeof code === 'string' ? String(code) : '';
  if (/^(401|403)$|auth|api.?key|permission|access.?denied|forbidden|unauthori[sz]ed/i.test(value)) {
    return '百炼鉴权失败，请检查北京区 API Key、业务空间和模型权限。';
  }
  if (/^(402|429)$|limit|quota|billing|balance|payment|throttl|arrear|free.?tier/i.test(value)) {
    return '百炼实时识别额度不足或请求受限，请检查百炼账单、余额和限流。';
  }
  return '百炼实时识别失败，请检查网络和百炼服务状态后重试。';
}

function transcript(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]/gu, ' ').trim().slice(-500).trim();
}

export function createAsrCapture({
  apiKey, workspaceId, configError, onStatus = () => {}, onResult = () => {}, onService = () => {},
  connect = (url, options) => new WebSocket(url, options), connectTimeoutMs = 10_000, finishTimeoutMs = 2500,
} = {}) {
  const key = apiKey?.trim() || '';
  const workspace = workspaceId?.trim() || '';
  const invalid = configError || (!key ? MISSING_KEY :
    !/^[\x21-\x7E]{1,1024}$/u.test(key) ? '百炼 API Key 格式无效，请检查 .env。' :
    workspace && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(workspace) ? '百炼业务空间 ID 格式无效，请检查 .env。' : '');
  const configured = !invalid;
  const endpoint = 'wss://' + (configured && workspace ? `${workspace}.cn-beijing.maas.aliyuncs.com` : 'dashscope.aliyuncs.com');
  let message = invalid || '百炼已配置 · 可测试连接或启动识别';
  let active;
  let closed = false;

  function send(socket, payload) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }

  function done(session, reason = '', force = false) {
    if (active !== session) return;
    active = undefined;
    clearTimeout(session.timer);
    clearInterval(session.heartbeat);
    if (force || reason || session.upstream.readyState === WebSocket.CONNECTING) session.upstream.terminate();
    if (session.socket?.readyState === WebSocket.OPEN) {
      if (reason) send(session.socket, { type: 'error', message: reason });
      session.socket.close(1000);
    }
    message = reason || (session.ready ? '百炼连接正常' : '百炼已配置 · 可测试连接或启动采集');
    if (session.probe) onService();
    else onStatus({ phase: reason ? 'error' : 'idle', owner: null, message: reason });
    session.resolveFinished();
    if (!force && !reason && session.upstream.readyState === WebSocket.OPEN) session.upstream.close(1000);
  }

  function getItem(session, id) {
    let item = session.items.get(id);
    if (!item) {
      item = { order: ++session.itemOrder };
      session.items.set(id, item);
      if (session.items.size > 64) session.items.delete(session.items.keys().next().value);
    }
    return item;
  }

  function emit(session, packet, final) {
    if (!session.ready || (!final && session.finishing) || !session.frames || typeof packet.item_id !== 'string') return;
    const item = getItem(session, packet.item_id);
    if (item.final || item.order < session.lastResultOrder) return;
    if (final) item.final = true;
    const text = transcript(final ? packet.transcript :
      [packet.text, packet.stash].filter((value) => typeof value === 'string').join(''));
    if (!text) return;
    session.lastResultOrder = item.order;
    const end = item.end;
    const at = final && Number.isFinite(end) && end >= 0 && end <= session.frames * FRAME_MS
      ? Math.min(Date.now(), session.startAt + end) : null;
    onResult({ text, final, at, estimated: true });
  }

  function stop(session) {
    if (active !== session || session.finishing) return;
    if (!session.ready) {
      done(session);
      return;
    }
    session.finishing = true;
    clearTimeout(session.timer);
    session.timer = setTimeout(() => done(session, session.probe ? '百炼会话测试超时，请稍后重试。' : '', true), finishTimeoutMs);
    if (!session.probe) {
      onStatus({ phase: 'stopping', owner: session.owner, message: '' });
      if (session.socket.readyState === WebSocket.OPEN) session.socket.close(1000);
    }
    send(session.upstream, session.taskId
      ? { header: { action: 'finish-task', task_id: session.taskId, streaming: 'duplex' }, payload: { input: {} } }
      : { type: 'session.finish', event_id: randomUUID() });
  }

  function start({ socket, owner, probe = false, model, vocabulary }) {
    const taskId = model === STREAMING_MODEL ? randomUUID() : null;
    const url = new URL(taskId ? '/api-ws/v1/inference' : '/api-ws/v1/realtime', endpoint);
    if (!taskId) url.searchParams.set('model', model);
    let upstream;
    try {
      upstream = connect(url, {
        headers: { Authorization: `Bearer ${key}` },
        handshakeTimeout: connectTimeoutMs,
        closeTimeout: 1000,
        followRedirects: false, perMessageDeflate: false, maxPayload: 64 * 1024,
      });
    } catch {
      message = CONNECTION_FAILED;
      if (probe) onService();
      else {
        send(socket, { type: 'error', message });
        socket.close(1008);
        onStatus({ phase: 'error', owner: null, message });
      }
      return;
    }
    const session = {
      upstream, socket, owner, probe, taskId, model, startAt: null, frames: 0, items: new Map(),
      itemOrder: 0, lastResultOrder: 0, alive: true, ready: false, finishing: false,
    };
    session.finished = new Promise((resolve) => { session.resolveFinished = resolve; });
    active = session;
    if (probe) {
      message = '正在测试百炼连接…';
      onService();
    } else onStatus({ phase: 'loading', owner, message: '' });

    session.timer = setTimeout(() => done(session, '百炼连接超时，请检查直播机网络后重试。'), connectTimeoutMs);
    upstream.on('unexpected-response', (request, response) => {
      const reason = cloudError(response.statusCode);
      response.destroy();
      request.destroy();
      done(session, reason);
    });
    upstream.on('error', () => done(session, CONNECTION_FAILED));
    upstream.on('close', () => done(session, session.finishing && !probe ? '' : '百炼连接已断开，请重新启动识别。'));
    upstream.on('open', () => {
      if (active !== session) return;
      send(upstream, taskId ? {
        header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
        payload: { task_group: 'audio', task: 'asr', function: 'recognition', model,
          parameters: { format: 'pcm', sample_rate: SAMPLE_RATE, ...(Object.keys(vocabulary).length && { vocabulary }) },
          input: {} },
      } : { type: 'session.update', event_id: randomUUID(), session: SESSION_OPTIONS });
      session.heartbeat = setInterval(() => {
        if (!session.alive) return done(session, CONNECTION_FAILED);
        session.alive = false;
        if (upstream.readyState === WebSocket.OPEN) upstream.ping();
      }, 15_000);
    });
    upstream.on('pong', () => { session.alive = true; });
    upstream.on('message', (data, binary) => {
      if (active !== session) return;
      try {
        if (binary) return done(session, PROTOCOL_FAILED);
        const packet = JSON.parse(data.toString());
        const event = taskId ? packet?.header?.event : packet?.type;
        if (typeof event !== 'string') return done(session, PROTOCOL_FAILED);
        if (taskId && packet.header.task_id !== taskId) return;
        if (event === (taskId ? 'task-started' : 'session.updated') && !session.ready) {
          session.ready = true;
          clearTimeout(session.timer);
          if (probe) return taskId ? done(session) : stop(session);
          session.timer = setTimeout(() => done(session, '未收到音频，请检查音源后重新启动识别。'), 15_000);
          message = '百炼连接正常';
          send(socket, { type: 'ready' });
          onStatus({ phase: 'listening', owner, message: '' });
        } else if (event === (taskId ? 'task-finished' : 'session.finished')) {
          done(session, session.finishing ? '' : '百炼会话已结束，请重新启动识别。');
        } else if (event === 'task-failed' || event === 'error' || event === 'conversation.item.input_audio_transcription.failed') {
          done(session, cloudError(packet.header?.error_code ?? packet.error?.code));
        } else if (taskId && !probe && event === 'result-generated') {
          const sentence = packet.payload?.output?.sentence;
          if (!sentence || sentence.heartbeat || typeof sentence.text !== 'string' || !sentence.text.trim()) return;
          const itemId = sentence.sentence_id ?? sentence.begin_time;
          if (!Number.isSafeInteger(itemId)) return;
          const final = sentence.sentence_end === true;
          const item_id = String(itemId);
          if (final) getItem(session, item_id).end = sentence.end_time;
          emit(session, { item_id, text: sentence.text, transcript: sentence.text }, final);
        } else if (!probe && packet.type === 'input_audio_buffer.speech_started' && typeof packet.item_id === 'string') {
          getItem(session, packet.item_id);
        } else if (!probe && packet.type === 'input_audio_buffer.speech_stopped' && typeof packet.item_id === 'string') {
          getItem(session, packet.item_id).end = packet.audio_end_ms;
        } else if (!probe && packet.type === 'conversation.item.input_audio_transcription.text') {
          emit(session, packet, false);
        } else if (!probe && packet.type === 'conversation.item.input_audio_transcription.completed') {
          emit(session, packet, true);
        }
      } catch { done(session, PROTOCOL_FAILED); }
    });
    socket?.on('close', () => stop(session));
    socket?.on('message', (pcm, binary) => {
      if (active !== session || session.finishing) return;
      if (!binary || pcm.length !== FRAME_BYTES || !session.ready) {
        done(session, '音频格式无效，需使用 16 kHz 单声道 PCM16。');
        return;
      }
      const now = Date.now();
      session.startAt ??= now - FRAME_MS;
      session.frames += 1;
      if (upstream.readyState !== WebSocket.OPEN) return done(session, CONNECTION_FAILED);
      if (upstream.bufferedAmount > 64 * 1024 || session.frames * FRAME_MS > now - session.startAt + 1500) {
        return done(session, '音频发送积压，请检查网络或直播负载后重试。');
      }
      session.timer.refresh();
      upstream.send(taskId ? pcm : JSON.stringify({
        type: 'input_audio_buffer.append', event_id: randomUUID(), audio: pcm.toString('base64'),
      }), (error) => { if (error) done(session, CONNECTION_FAILED); });
    });
  }

  return {
    configured,
    get testing() { return Boolean(active?.probe); },
    get model() { return active?.model ?? null; },
    get message() { return message; },
    test(options) {
      if (!closed && !active && configured) start({ probe: true, ...validateAsrOptions(options) });
    },
    attach(socket, owner, options) {
      if (closed || active || !configured || !['lyrics', 'speech'].includes(owner)) {
        send(socket, { type: 'error', message: invalid || (active?.probe ? '正在测试百炼连接，请稍候。' :
          active ? '已有页面使用共用音源，请先停止当前识别。' : '识别请求无效。') });
        socket.close(1008);
        return;
      }
      try {
        start({ socket, owner, ...validateAsrOptions(options) });
      } catch (error) {
        send(socket, { type: 'error', message: error.message });
        socket.close(1008);
      }
    },
    stop() { if (active && !active.probe) stop(active); },
    async close() {
      closed = true;
      const session = active;
      if (session) {
        stop(session);
        await session.finished;
      }
    },
  };
}
