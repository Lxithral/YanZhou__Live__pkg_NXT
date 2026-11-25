import { CONTEST_HOTWORDS_2026, CUSTOM_MODEL, MAX_HOTWORD_TEXT, MAX_HOTWORDS, REALTIME_MODEL, SCHOOL_HOTWORDS, STREAMING_MODEL,
  splitHotwords, usesStreamingProtocol, validateAsrOptions } from './asr-settings.js';
import { createDeviceMeter } from './device-meter.js';

const CABLE = /cable output|vb-audio|vb-cable/i;
const AUDIO_CONSTRAINTS = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
const ASR_OPTIONS_KEY = 'yanzhou-asr-options';
const stopTracks = (stream) => stream?.getTracks().forEach((track) => track.stop());

function explain(error) {
  if (error.name === 'NotAllowedError') return '权限被拒绝或共享已取消。';
  if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') return '音频设备不可用，请检查连接。';
  if (error.name === 'NotReadableError') return '设备可能被占用，无法打开。';
  return error.message || '音频采集启动失败。';
}

export function bindAsrControls({ correct, timecode, prefix = '', owner = 'lyrics', command = () => {} }) {
  const $ = (id) => document.getElementById(prefix + id);
  const optionsKey = `${ASR_OPTIONS_KEY}-${owner}`;
  const defaultModel = owner === 'speech' ? STREAMING_MODEL : REALTIME_MODEL;
  const media = navigator.mediaDevices;
  const source = $('audio-source');
  const device = $('audio-device');
  const deviceMeter = createDeviceMeter({ select: device, list: $('device-list'), constraints: AUDIO_CONSTRAINTS,
    onDevicesChanged: () => { refreshDevices().catch(() => {}); } });
  const start = $('asr-start');
  const stop = $('asr-stop');
  const test = $('asr-test');
  const model = $('asr-model');
  const modelCustom = $('model-custom');
  const modelCustomWrap = $('model-custom-wrap');
  const hotwordField = $('asr-hotword-field');
  const hotwords = $('asr-hotwords');
  const preset = $('asr-hotword-preset');
  const hotwordHint = $('asr-hotword-hint');
  const defaultHotwordHint = hotwordHint?.textContent;
  const apiKey = $('asr-api-key');
  const workspaceId = $('asr-workspace-id');
  const configSave = $('asr-config-save');
  const configStatus = $('asr-config-status');
  const keyToggle = $('asr-key-toggle');
  let shared;
  let online = false;
  let local;
  let failure = '';
  let lastFinals;
  let lastHistory;
  let configPending = false;
  let configMessage = '';
  let configDirty = false;

  function chosenModel() {
    return model.value === CUSTOM_MODEL ? modelCustom?.value.trim() ?? '' : model.value;
  }

  function options() {
    const modelId = chosenModel();
    const selected = { model: modelId, hotwords: usesStreamingProtocol(modelId) ? hotwords?.value ?? '' : '' };
    validateAsrOptions(selected);
    return selected;
  }

  function readSavedOptions(key = optionsKey) {
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch { return null; }
  }
  function restoreOptions() {
    const saved = readSavedOptions();
    const savedModel = typeof saved?.model === 'string' ? saved.model : '';
    const preset = [...model.options].some((option) => option.value === savedModel && option.value !== CUSTOM_MODEL);
    model.value = !savedModel ? defaultModel : preset ? savedModel : CUSTOM_MODEL;
    if (modelCustom) modelCustom.value = preset ? '' : savedModel;
    if (modelCustomWrap) modelCustomWrap.hidden = model.value !== CUSTOM_MODEL;
    const savedHotwords = typeof saved?.hotwords === 'string' ? saved.hotwords : readSavedOptions(ASR_OPTIONS_KEY)?.hotwords;
    if (hotwords) hotwords.value = typeof savedHotwords === 'string'
      ? savedHotwords.slice(0, MAX_HOTWORD_TEXT)
      : SCHOOL_HOTWORDS.join('\n');
  }
  function saveOptions() {
    // 模型和热词按页面分开保存，互不影响。
    try {
      localStorage.setItem(optionsKey, JSON.stringify({
        model: chosenModel(), ...(hotwords && { hotwords: hotwords.value }),
      }));
    }
    catch {}
  }

  async function refreshDevices() {
    const previous = device.value;
    const inputs = (await media.enumerateDevices()).filter(({ kind, label }) =>
      kind === 'audioinput' && (source.value === 'cable' ? CABLE.test(label) : !CABLE.test(label)));
    device.replaceChildren(...device.querySelectorAll(':scope > button'),
      new Option(source.value === 'cable' ? '自动选择 CABLE Output' : '默认麦克风', ''));
    for (const [index, input] of inputs.entries()) {
      if (input.deviceId && input.deviceId !== 'default') {
        device.add(new Option(input.label || `音频输入 ${index + 1}`, input.deviceId));
      }
    }
    if ([...device.options].some((option) => option.value === previous)) device.value = previous;
    deviceMeter.refresh();
    return inputs;
  }

  function render() {
    const phase = shared?.phase;
    const busy = ['listening', 'loading', 'stopping'].includes(phase) || shared?.testing || configPending;
    const ownCapture = shared?.owner === owner;
    if (configSave) {
      const editable = shared?.credentialsEditable === true;
      configSave.disabled = !online || !editable || busy || Boolean(local) || configPending;
      apiKey.disabled = workspaceId.disabled = busy || Boolean(local) || configPending;
      keyToggle.disabled = apiKey.disabled;
      configSave.textContent = configPending ? '保存中…' : '保存 API Key';
      apiKey.placeholder = shared?.configured ? '已配置，填写新 Key 可替换' : '北京区百炼 API Key';
      if (!configDirty) workspaceId.value = shared?.workspaceId ?? '';
      configStatus.textContent = !online ? '等待连接…' :
        !editable ? '重启服务后可保存 API Key。' :
        configPending ? '保存中…' : configMessage ||
        (shared?.configured ? '已配置，可测试连接。' : '未配置 API Key。');
    }
    start.disabled = !online || !media || !shared?.configured || Boolean(local) || busy;
    stop.disabled = !online || (!local && !['listening', 'loading'].includes(phase));
    source.disabled = Boolean(local) || busy;
    device.disabled = Boolean(local) || busy || source.value === 'tab';
    deviceMeter.setTab(source.value === 'tab');
    deviceMeter.setPaused(device.disabled);
    test.disabled = !online || !shared?.configured || busy || Boolean(local);
    model.disabled = Boolean(local) || busy;
    if (modelCustom) modelCustom.disabled = model.disabled;
    if (hotwordField) {
      hotwords.disabled = model.disabled;
      preset.disabled = model.disabled;
      hotwordField.hidden = !usesStreamingProtocol(chosenModel());
    }
    if ($('asr-correct')) {
      $('asr-correct').disabled = !online;
      $('asr-correct').checked = Boolean(shared?.correction?.enabled);
    }
    $('asr-status').textContent = !online ? '等待连接…' : failure || (
      phase === 'error' && !local ? shared.message :
      phase === 'listening' ? (shared.owner === 'speech' ? '语音字幕采集中' : '歌词纠偏采集中') :
      phase === 'stopping' ? '结束最后一句…' :
      local || phase === 'loading' ? '连接音源与百炼…' :
      !media && shared?.configured ? '请用 Chrome 或 Edge 打开本机地址采集音频。' :
      shared && !shared.configured ? '先保存 API Key，再启动识别。' :
      shared?.serviceMessage || '读取百炼配置…');
    $('asr-partial').textContent = (ownCapture && (shared.partial || (owner === 'speech' ? shared.finals?.at(-1)?.text : ''))) || '等待语音';
    const finals = shared?.resultOwner === owner ? shared.finals : undefined;
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
    $('asr-alignment').textContent = `偏移 ${offset} · 匹配度 ${score}${correction?.estimated && correction.offset != null ? ' · 时间估算' : ''}`;
    const history = correction?.history;
    $('clear-correction-log').disabled = !online || !history?.length;
    $('asr-history-empty').hidden = Boolean(history?.length);
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
        throw new Error('未共享音频，请选择标签页并勾选「共享标签页音频」。');
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
        if (local === session) stopCapture('采集超时，请检查音源后重试。');
      }, 40_000);
      for (const track of stream.getTracks()) track.addEventListener('ended', () => {
        if (local === session) stopCapture('音源已断开或停止共享。');
      });
      await resumed;
      await session.context.audioWorklet.addModule('/js/asr/asr-audio-worklet.js');
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
            if (socket.bufferedAmount > 32000) stopCapture('音频发送积压，请重启识别。');
            else socket.send(pcm);
          };
          input.connect(worklet).connect(mute).connect(session.context.destination);
          session.worklet = worklet;
          refreshDevices().catch(() => {});
        } catch (error) {
          stopCapture(explain(error));
        }
      };
      socket.onerror = () => { if (local === session) stopCapture('识别服务连接失败。'); };
      socket.onclose = ({ wasClean }) => {
        if (local === session) stopCapture(wasClean ? '' : '识别服务已断开。');
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
  if (configSave) {
    const changed = () => { configDirty = true; configMessage = '配置已修改，请保存。'; render(); };
    apiKey.oninput = workspaceId.oninput = changed;
    keyToggle.onclick = () => {
      const visible = apiKey.type === 'password';
      apiKey.type = visible ? 'text' : 'password';
      keyToggle.textContent = visible ? '隐藏' : '显示';
      keyToggle.setAttribute('aria-label', visible ? '隐藏 API Key' : '显示 API Key');
      keyToggle.setAttribute('aria-pressed', String(visible));
    };
    configSave.onclick = () => {
      if (configSave.disabled) return;
      const key = apiKey.value.trim();
      const workspace = workspaceId.value.trim();
      if (!/^[\x21-\x7E]{1,1024}$/u.test(key)) {
        configMessage = '请填写有效的 API Key。'; apiKey.focus(); render(); return;
      }
      if (workspace && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(workspace)) {
        configMessage = '业务空间 ID 格式无效。'; workspaceId.focus(); render(); return;
      }
      configPending = true;
      configMessage = '';
      try { command('asr:configure', { apiKey: key, workspaceId: workspace }); }
      catch { configPending = false; configMessage = '保存失败，请检查服务连接。'; }
      render();
    };
  }
  restoreOptions();
  model.onchange = () => {
    if (modelCustomWrap) modelCustomWrap.hidden = model.value !== CUSTOM_MODEL;
    if (modelCustom && model.value === CUSTOM_MODEL) modelCustom.focus();
    saveOptions(); failure = ''; render();
  };
  if (modelCustom) modelCustom.oninput = () => { saveOptions(); failure = ''; render(); };
  if (hotwordField) {
    hotwords.oninput = () => {
      saveOptions();
      hotwordHint.textContent = defaultHotwordHint;
      if (failure) { failure = ''; render(); }
    };
    preset.onclick = () => {
      const existing = splitHotwords(hotwords.value);
      const combined = [...new Set([...existing, ...CONTEST_HOTWORDS_2026])];
      if (combined.length > MAX_HOTWORDS) {
        hotwordHint.textContent = `共 ${combined.length} 项，超过 ${MAX_HOTWORDS} 项上限，请删减。`;
        return;
      }
      const draft = combined.join('\n');
      try { validateAsrOptions({ model: STREAMING_MODEL, hotwords: draft }); }
      catch (error) { hotwordHint.textContent = error.message; return; }
      hotwords.value = draft;
      hotwords.oninput();
      const added = combined.length - existing.length;
      hotwordHint.textContent = added ? `新增 ${added} 项，共 ${combined.length} 项；重启识别生效。` : '活动词表已在列表中。';
    };
  }
  window.addEventListener('storage', ({ key }) => {
    if (key !== optionsKey) return;
    restoreOptions();
    if (hotwordHint) hotwordHint.textContent = defaultHotwordHint;
    render();
  });
  source.onchange = () => { refreshDevices().catch(() => {}); render(); };
  if ($('asr-correct')) $('asr-correct').onchange = ({ target }) => correct?.(target.checked);
  window.addEventListener('pagehide', () => { stopCapture(); deviceMeter.stop(); });
  media?.addEventListener('devicechange', () => refreshDevices().catch(() => {}));
  if (media) refreshDevices().catch(() => {});
  return {
    configResult(result) {
      if (!configSave) return;
      configPending = false;
      configMessage = result.message || (result.ok ? '已保存，可测试连接。' : '保存失败，请重试。');
      if (result.ok) {
        apiKey.value = '';
        apiKey.type = 'password';
        keyToggle.textContent = '显示';
        keyToggle.setAttribute('aria-label', '显示 API Key');
        keyToggle.setAttribute('aria-pressed', 'false');
        configDirty = false;
      }
      render();
    },
    update(state, connected) {
      shared = state;
      online = connected;
      if (!online && configPending) { configPending = false; configMessage = '已断线，重连后检查配置。'; }
      if (!online && local) stopCapture('服务已断线，采集已停止。');
      else if (local?.started && !['listening', 'loading'].includes(shared?.phase)) stopCapture(shared?.phase === 'error' ? shared.message : '');
      render();
    },
  };
}
