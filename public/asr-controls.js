import { CONTEST_HOTWORDS_2025, MAX_HOTWORD_TEXT, MAX_HOTWORDS, SCHOOL_HOTWORDS, STREAMING_MODEL,
  splitHotwords, validateAsrOptions } from './asr-settings.js';

const CABLE = /cable output|vb-audio|vb-cable/i;
const AUDIO_CONSTRAINTS = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
const ASR_OPTIONS_KEY = 'yanzhou-asr-options';
const stopTracks = (stream) => stream?.getTracks().forEach((track) => track.stop());

function explain(error) {
  if (error.name === 'NotAllowedError') return '音频权限被拒绝，或你取消了共享。';
  if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') return '所选音频设备不可用，请检查连接。';
  if (error.name === 'NotReadableError') return '无法打开音频设备，设备可能正被占用。';
  return error.message || '音频采集启动失败。';
}

export function bindAsrControls({ correct, timecode, prefix = '', owner = 'lyrics', command = () => {} }) {
  const $ = (id) => document.getElementById(prefix + id);
  const media = navigator.mediaDevices;
  const source = $('audio-source');
  const device = $('audio-device');
  const start = $('asr-start');
  const stop = $('asr-stop');
  const test = $('asr-test');
  const model = $('asr-model');
  const hotwords = $('asr-hotwords');
  const preset = $('asr-hotword-preset');
  const hotwordHint = $('asr-hotword-hint');
  const defaultHotwordHint = hotwordHint.textContent;
  let shared;
  let online = false;
  let local;
  let failure = '';
  let lastFinals;
  let lastHistory;

  function options() {
    const selected = { model: model.value, hotwords: model.value === STREAMING_MODEL ? hotwords.value : '' };
    validateAsrOptions(selected);
    return selected;
  }

  function restoreOptions() {
    hotwords.value = SCHOOL_HOTWORDS.join('\n');
    try {
      const saved = JSON.parse(localStorage.getItem(ASR_OPTIONS_KEY) ?? '{}');
      if ([...model.options].some((option) => option.value === saved?.model)) model.value = saved.model;
      if (typeof saved?.hotwords === 'string') hotwords.value = saved.hotwords.slice(0, MAX_HOTWORD_TEXT);
    } catch {}
  }
  function saveOptions() {
    try { localStorage.setItem(ASR_OPTIONS_KEY, JSON.stringify({ model: model.value, hotwords: hotwords.value })); }
    catch {}
  }

  async function refreshDevices() {
    const previous = device.value;
    const inputs = (await media.enumerateDevices()).filter(({ kind, label }) =>
      kind === 'audioinput' && (source.value === 'cable' ? CABLE.test(label) : !CABLE.test(label)));
    device.replaceChildren(...device.querySelectorAll(':scope > button'),
      new Option(source.value === 'cable' ? '自动选择 CABLE Output' : '系统默认麦克风', ''));
    for (const [index, input] of inputs.entries()) {
      if (input.deviceId && input.deviceId !== 'default') {
        device.add(new Option(input.label || `音频输入 ${index + 1}`, input.deviceId));
      }
    }
    if ([...device.options].some((option) => option.value === previous)) device.value = previous;
    return inputs;
  }

  function render() {
    const phase = shared?.phase;
    const busy = ['listening', 'loading', 'stopping'].includes(phase) || shared?.testing;
    start.disabled = !online || !media || !shared?.configured || Boolean(local) || busy;
    stop.disabled = !online || (!local && !['listening', 'loading'].includes(phase));
    source.disabled = Boolean(local) || busy;
    device.disabled = Boolean(local) || busy || source.value === 'tab';
    test.disabled = !online || !shared?.configured || busy || Boolean(local);
    model.disabled = Boolean(local) || busy;
    hotwords.disabled = model.disabled;
    preset.disabled = model.disabled;
    $('asr-hotword-field').hidden = model.value !== STREAMING_MODEL;
    if ($('asr-correct')) {
      $('asr-correct').disabled = !online;
      $('asr-correct').checked = Boolean(shared?.correction?.enabled);
    }
    $('asr-status').textContent = !online ? '等待连接本机服务…' : failure || (
      phase === 'error' && !local ? shared.message :
      phase === 'listening' ? `正在识别 · 共用${shared.owner === 'speech' ? '主控台' : '歌词台'}音源` :
      phase === 'stopping' ? '正在完成最后一句…' :
      local || phase === 'loading' ? '正在连接音源与百炼…' :
      !media && shared?.configured ? '当前浏览器无法采集音频，请用 Edge 或 Chrome 打开本机地址。' :
      shared?.serviceMessage || '正在读取百炼配置…');
    $('asr-partial').textContent = shared?.partial || (owner === 'speech' ? shared?.finals?.at(-1)?.text : '') || '等待语音';
    const finals = shared?.finals;
    if ($('asr-finals') && finals !== lastFinals) {
      lastFinals = finals;
      $('asr-finals').replaceChildren(...(finals ?? []).slice(-8).map(({ text, at }) => {
        const row = document.createElement('li');
        row.textContent = `${new Date(at).toLocaleTimeString()}  ${text}`;
        return row;
      }).reverse());
    }
    if (!$('asr-alignment')) return;
    const correction = shared?.correction;
    const offset = correction?.offset == null ? '—' : `${correction.offset > 0 ? '+' : ''}${(correction.offset / 1000).toFixed(2)} 秒`;
    const score = correction?.confidence == null ? '—' : `${Math.round(correction.confidence * 100)}%`;
    $('asr-alignment').textContent = `偏移 ${offset} · 对齐置信度 ${score}${correction?.estimated && correction.offset != null ? ' · 时间估算' : ''}`;
    const history = correction?.history;
    if (history !== lastHistory) {
      lastHistory = history;
      $('asr-history').replaceChildren(...(history ?? []).map(({ at, from, to, smooth, estimated }) => {
        const row = document.createElement('li');
        row.textContent = `${new Date(at).toLocaleTimeString()}  ${timecode(from)} → ${timecode(to)} · ${smooth ? '平滑' : '跳转'}${estimated ? ' · 时间估算' : ''}`;
        return row;
      }));
    }
  }

  function stopCapture(message = '') {
    const session = local;
    if (!session) return;
    local = undefined;
    clearTimeout(session.startTimer);
    if (message) failure = message;
    session.worklet?.disconnect();
    session.socket?.close();
    stopTracks(session.stream);
    session.context?.close().catch(() => {});
    render();
  }

  async function inputStream(session) {
    if (source.value === 'tab') {
      const stream = await media.getDisplayMedia({
        video: { displaySurface: 'browser' }, audio: true,
        systemAudio: 'exclude', surfaceSwitching: 'exclude',
      });
      if (!stream.getAudioTracks().length) {
        stopTracks(stream);
        throw new Error('共享未带音轨，请选浏览器标签页并勾选「共享标签页音频」。');
      }
      if (stream.getVideoTracks()[0]?.getSettings().displaySurface !== 'browser') {
        stopTracks(stream);
        throw new Error('请选择浏览器标签页作为音源。');
      }
      return stream;
    }
    let id = device.value;
    if (source.value === 'cable' && !id) {
      let inputs = await refreshDevices();
      if (!inputs.length && (await media.enumerateDevices()).some((entry) => entry.kind === 'audioinput' && !entry.label)) {
        const probe = await media.getUserMedia({ audio: AUDIO_CONSTRAINTS });
        stopTracks(probe);
        if (local !== session) return undefined;
        inputs = await refreshDevices();
      }
      id = inputs[0]?.deviceId;
      if (!id) throw new Error('未找到 VB-CABLE 的 CABLE Output，请检查虚拟声卡。');
    }
    return media.getUserMedia({ audio: { ...AUDIO_CONSTRAINTS, ...(id && { deviceId: { exact: id } }) } });
  }

  async function startCapture() {
    if (start.disabled) return;
    failure = '';
    let selected;
    try { selected = options(); }
    catch (error) { failure = error.message; render(); return; }
    const session = { options: selected };
    local = session;
    render();
    try {
      session.context = new AudioContext({ sinkId: { type: 'none' } });
      const resumed = session.context.resume();
      resumed.catch(() => {});
      const stream = await inputStream(session);
      if (local !== session) {
        stopTracks(stream);
        return;
      }
      session.stream = stream;
      session.startTimer = setTimeout(() => {
        if (local === session) stopCapture('音频采集启动超时，请检查音源后重试。');
      }, 40_000);
      for (const track of stream.getTracks()) track.addEventListener('ended', () => {
        if (local === session) stopCapture('音源已断开或停止共享。');
      });
      await resumed;
      await session.context.audioWorklet.addModule('/asr-audio-worklet.js');
      if (local !== session) return;
      const url = new URL('/asr', location.href.replace(/^http/, 'ws'));
      url.searchParams.set('owner', owner);
      url.searchParams.set('options', '1');
      const socket = new WebSocket(url);
      session.socket = socket;
      socket.onopen = () => { if (local === session) socket.send(JSON.stringify(session.options)); };
      socket.onmessage = ({ data }) => {
        if (local !== session) return;
        let packet;
        try { packet = JSON.parse(data); } catch { stopCapture('本机识别服务返回了无效消息。'); return; }
        if (packet.type === 'error') { stopCapture(packet.message); return; }
        if (packet.type !== 'ready') return;
        clearTimeout(session.startTimer);
        session.started = true;
        try {
          const input = session.context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
          const worklet = new AudioWorkletNode(session.context, 'yanzhou-pcm-capture');
          const mute = session.context.createGain();
          mute.gain.value = 0;
          worklet.port.onmessage = ({ data: pcm }) => {
            if (socket.readyState !== WebSocket.OPEN) return;
            if (socket.bufferedAmount > 32000) stopCapture('音频发送积压，请重新启动识别。');
            else socket.send(pcm);
          };
          input.connect(worklet).connect(mute).connect(session.context.destination);
          session.worklet = worklet;
          refreshDevices().catch(() => {});
        } catch (error) {
          stopCapture(explain(error));
        }
      };
      socket.onerror = () => { if (local === session) stopCapture('无法连接本机识别服务。'); };
      socket.onclose = ({ wasClean }) => {
        if (local === session) stopCapture(wasClean ? '' : '本机识别连接已断开。');
      };
    } catch (error) {
      if (local === session) stopCapture(explain(error));
    }
  }

  start.onclick = startCapture;
  stop.onclick = () => { if (local) stopCapture(); else command('asr:stop'); };
  test.onclick = () => {
    failure = '';
    try { command('asr:test', options()); }
    catch (error) { failure = error.message; }
    render();
  };
  restoreOptions();
  model.onchange = () => { saveOptions(); failure = ''; render(); };
  hotwords.oninput = () => {
    saveOptions();
    hotwordHint.textContent = defaultHotwordHint;
    if (failure) { failure = ''; render(); }
  };
  preset.onclick = () => {
    const existing = splitHotwords(hotwords.value);
    const combined = [...new Set([...existing, ...CONTEST_HOTWORDS_2025])];
    if (combined.length > MAX_HOTWORDS) {
      hotwordHint.textContent = `合并后有 ${combined.length} 项。请删减一些热词再补入，最多 ${MAX_HOTWORDS} 项。`;
      return;
    }
    const draft = combined.join('\n');
    try { validateAsrOptions({ model: STREAMING_MODEL, hotwords: draft }); }
    catch (error) { hotwordHint.textContent = error.message; return; }
    hotwords.value = draft;
    hotwords.oninput();
    const added = combined.length - existing.length;
    hotwordHint.textContent = added ? `已补入 ${added} 项，共 ${combined.length} 项，下次启动识别生效。` : '2025 赛稿词表已在列表中。';
  };
  window.addEventListener('storage', ({ key }) => {
    if (key === ASR_OPTIONS_KEY) { restoreOptions(); hotwordHint.textContent = defaultHotwordHint; render(); }
  });
  source.onchange = () => { refreshDevices().catch(() => {}); render(); };
  if ($('asr-correct')) $('asr-correct').onchange = ({ target }) => correct?.(target.checked);
  window.addEventListener('pagehide', () => stopCapture());
  media?.addEventListener('devicechange', () => refreshDevices().catch(() => {}));
  if (media) refreshDevices().catch(() => {});
  return {
    update(state, connected) {
      shared = state;
      online = connected;
      if (!online && local) stopCapture('与本机服务断开，已停止采集。');
      else if (local?.started && !['listening', 'loading'].includes(shared?.phase)) stopCapture(shared?.phase === 'error' ? shared.message : '');
      render();
    },
  };
}
