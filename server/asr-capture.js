import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { ASR_MODELS, FRAME_SAMPLES, MODEL_ROOT, SAMPLE_RATE, modelAvailable } from './asr-models.js';

const ENGINE = fileURLToPath(new URL('./asr-engine.js', import.meta.url));
const require = createRequire(import.meta.url);
const FRAME_MS = FRAME_SAMPLES * 1000 / SAMPLE_RATE;
const MAX_PENDING = 25;

export async function createAsrCapture({ onStatus, onResult, modelRoot = MODEL_ROOT }) {
  const available = {};
  let addonAvailable = true;
  try { require.resolve('sherpa-onnx-node'); } catch { addonAvailable = false; }
  for (const mode of Object.keys(ASR_MODELS)) available[mode] = addonAvailable && await modelAvailable(mode, modelRoot);
  let active;

  function stop(session, message = '') {
    if (active !== session) return;
    active = undefined;
    clearTimeout(session.timeout);
    session.child.kill();
    if (session.socket.readyState === WebSocket.OPEN) {
      if (message) session.socket.send(JSON.stringify({ type: 'error', message }));
      session.socket.close(1000);
    }
    onStatus({ phase: message ? 'error' : 'idle', mode: session.mode, message });
  }

  function attach(socket, mode) {
    if (!Object.hasOwn(available, mode) || !available[mode] || active) {
      const message = active ? '已有一个歌词台正在采集音频。' : '该离线模型未安装，请运行 npm run asr:setup 后重启。';
      socket.send(JSON.stringify({ type: 'error', message }));
      socket.close(1008);
      return;
    }
    const child = fork(ENGINE, [mode, modelRoot], {
      execArgv: [], windowsHide: true, serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const session = { socket, child, mode, pending: 0, ready: false, frames: 0, startAt: null };
    active = session;
    onStatus({ phase: 'loading', mode, message: '' });
    session.timeout = setTimeout(() => stop(session, '离线引擎启动超时。'), 30_000);
    child.on('error', () => stop(session, '离线引擎启动失败，请检查模型和 Node 原生依赖。'));
    child.on('exit', () => stop(session, '离线引擎已退出，请检查模型或重新启动识别。'));
    child.on('message', (data) => {
      if (active !== session) return;
      if (data.type === 'ready') {
        clearTimeout(session.timeout);
        session.timeout = setTimeout(() => stop(session, '未收到音频，请检查音源后重新启动。'), 15_000);
        session.ready = true;
        socket.send(JSON.stringify({ type: 'ready' }));
        onStatus({ phase: 'listening', mode, message: '' });
      } else if (data.type === 'frame') {
        session.pending -= 1;
        if (data.event) onResult(data.event);
      }
    });
    socket.on('close', () => stop(session));
    socket.on('message', (pcm, binary) => {
      if (!binary || pcm.length !== FRAME_SAMPLES * 2 || !session.ready) {
        stop(session, '音频格式无效，需使用 16 kHz 单声道。');
        return;
      }
      const receivedAt = Date.now();
      session.timeout.refresh();
      session.startAt ??= receivedAt;
      session.frames += 1;
      if (session.pending >= MAX_PENDING || session.frames * FRAME_MS > receivedAt - session.startAt + 1500) {
        stop(session, '离线识别来不及处理音频，请重新启动或减少电脑负载。');
        return;
      }
      session.pending += 1;
      child.send({ pcm, receivedAt }, (error) => {
        if (error) stop(session, '音频无法交给离线引擎。');
      });
    });
  }

  return { available, attach, close() { if (active) stop(active); } };
}
