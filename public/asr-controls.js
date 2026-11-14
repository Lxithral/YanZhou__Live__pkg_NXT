const CABLE = /cable output|vb-audio|vb-cable/i;
const MODE_NAMES = { bilingual: '普通话／英语', trilingual: '普通话／粤语／英语' };
const AUDIO_CONSTRAINTS = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
const stopTracks = (stream) => stream?.getTracks().forEach((track) => track.stop());

function explain(error) {
  if (error.name === 'NotAllowedError') return '音频权限被拒绝，或你取消了共享。';
  if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') return '所选音频设备不可用，请检查连接。';
  if (error.name === 'NotReadableError') return '无法打开音频设备，设备可能正被占用。';
  return error.message || '音频采集启动失败。';
}

export function bindAsrControls({ correct, timecode }) {
  const $ = (id) => document.getElementById(id);
  const media = navigator.mediaDevices;
  const source = $('audio-source');
  const device = $('audio-device');
  const model = $('asr-model');
  const start = $('asr-start');
  const stop = $('asr-stop');
  let shared;
  let online = false;
  let local;
  let failure = '';
  let lastFinals;
  let lastHistory;

  async function refreshDevices() {
    const previous = device.value;
    const inputs = (await media.enumerateDevices()).filter(({ kind, label }) =>
      kind === 'audioinput' && (source.value === 'cable' ? CABLE.test(label) : !CABLE.test(label)));
    device.replaceChildren(new Option(source.value === 'cable' ? '自动选择 CABLE Output' : '系统默认麦克风', ''));
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
    const busy = phase === 'listening' || phase === 'loading';
    const available = shared?.available?.[model.value];
    start.disabled = !online || !media || !available || Boolean(local) || busy;
    stop.disabled = !local;
    model.disabled = Boolean(local);
    source.disabled = Boolean(local);
    device.disabled = Boolean(local) || source.value === 'tab';
    $('asr-correct').disabled = !online;
    $('asr-correct').checked = Boolean(shared?.correction?.enabled);
    $('asr-status').textContent = failure || (!media ? '当前浏览器不支持音频采集，请用 Chrome 打开本机地址。' :
      phase === 'error' ? shared.message :
      phase === 'listening' ? `正在识别 · ${MODE_NAMES[shared.mode]}` :
      local || phase === 'loading' ? '正在打开音源与离线模型…' :
      available ? '离线引擎就绪' : '模型未安装 · npm run asr:setup');
    $('asr-partial').textContent = shared?.partial || '等待语音';
    const finals = shared?.finals;
    if (finals !== lastFinals) {
      lastFinals = finals;
      $('asr-finals').replaceChildren(...(finals ?? []).slice(-8).map(({ text, at }) => {
        const row = document.createElement('li');
        row.textContent = `${new Date(at).toLocaleTimeString()}  ${text}`;
        return row;
      }).reverse());
    }
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
    const session = { mode: model.value };
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
      url.searchParams.set('mode', session.mode);
      const socket = new WebSocket(url);
      session.socket = socket;
      socket.onmessage = ({ data }) => {
        if (local !== session) return;
        const packet = JSON.parse(data);
        if (packet.type === 'error') stopCapture(packet.message);
        if (packet.type !== 'ready') return;
        clearTimeout(session.startTimer);
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
      socket.onclose = () => { if (local === session) stopCapture('本机识别连接已结束。'); };
    } catch (error) {
      if (local === session) stopCapture(explain(error));
    }
  }

  start.onclick = startCapture;
  stop.onclick = () => stopCapture();
  source.onchange = () => { refreshDevices().catch(() => {}); render(); };
  model.onchange = () => { failure = ''; render(); };
  $('asr-correct').onchange = ({ target }) => correct(target.checked);
  media?.addEventListener('devicechange', () => refreshDevices().catch(() => {}));
  if (media) refreshDevices().catch(() => {});
  return {
    update(state, connected) {
      shared = state;
      online = connected;
      if (!online && local) stopCapture('与本机服务断开，已停止采集。');
      render();
    },
  };
}
