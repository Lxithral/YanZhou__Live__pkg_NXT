const STYLE_ID = 'yanzhou-device-meter-style';

const STYLES = `
.device-list { display: grid; gap: 6px; min-width: 0; }
.device-row { display: grid; grid-template-columns: 12px minmax(0, 1fr) 84px; align-items: center; gap: 10px; width: 100%; min-height: 34px; padding: 0 10px; border: 0; border-radius: 8px; background: var(--raised, #ffffff0d); box-shadow: inset 0 0 0 1px var(--line-2, #ffffff1f); color: var(--text, inherit); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.device-row:hover { box-shadow: inset 0 0 0 1px var(--line-3, #ffffff33); }
.device-row[aria-checked=true] { background: var(--accent-soft, #6ba4ff26); box-shadow: inset 0 0 0 1px var(--accent, #6ba4ff); }
.device-row:disabled { opacity: .5; cursor: default; }
.device-row[aria-checked=true]:disabled { opacity: .75; }
.device-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--faint, #ffffff3d); }
.device-row[aria-checked=true] .device-dot { background: var(--accent, #6ba4ff); box-shadow: 0 0 0 3px var(--accent-soft, #6ba4ff33); }
.device-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.device-meter { height: 6px; border-radius: 3px; background: var(--line-2, #ffffff1f); overflow: hidden; }
.device-fill { display: block; width: 0; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #57c777 0%, #d6cf4b 68%, #ef6a5d 100%); transition: width 90ms linear; }
.device-row[data-meter=none] .device-meter { visibility: hidden; }
.device-hint { flex: 1 1 100%; margin: 8px 0 0; color: var(--muted, #9aa0a6); font-size: 12px; line-height: 1.55; }
.tool-row > .device-list { flex: 1 1 100%; }
.device-hint button { margin-inline-start: 6px; padding: 0; border: 0; background: none; color: var(--accent, #6ba4ff); font: inherit; text-decoration: underline; cursor: pointer; }
.device-list[hidden] { display: none; }
`;

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.append(style);
}

function explainDeviceError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return '麦克风未授权：地址栏 → 麦克风 → 允许；Windows 设置 → 隐私和安全性 → 麦克风 → 允许桌面应用访问麦克风。';
  }
  if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') return '设备未连接或已断开。';
  if (error?.name === 'NotReadableError') return '设备被占用，请关闭占用程序后重试。';
  return error?.message || '无法读取输入设备。';
}

/**
 * Flat device picker: every input is a row with a live level meter, so the
 * operator can see which source is actually carrying sound before starting.
 * The underlying <select> stays in the DOM as the value holder.
 */
export function createDeviceMeter({ select, list, constraints = {}, media = navigator.mediaDevices, onDevicesChanged } = {}) {
  if (!select || !list) return { render() {}, refresh() {}, setPaused() {}, setTab() {}, stop() {} };
  installStyles();
  const hint = document.createElement('p');
  hint.className = 'device-hint';
  hint.hidden = true;
  list.after(hint);

  const meters = new Map();
  let context;
  let paused = true;
  let visible = false;
  let tab = false;
  let frame;
  let lastPaint = 0;
  let problem = '';
  let generation = 0;
  let probed = false;
  let starting = false;
  let restart = false;
  const SUSPENDED_HINT = '点击页面，启用音量检测。';

  function showHint(text, retry = false) {
    hint.replaceChildren();
    if (!text) { hint.hidden = true; return; }
    hint.hidden = false;
    hint.append(document.createTextNode(text));
    if (retry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '重试';
      button.onclick = () => { problem = ''; stop(); start(); };
      hint.append(button);
    }
  }

  function setProblem(text) {
    problem = text;
    showHint(text, Boolean(text) && !tab);
  }

  function paint(row, ratio) {
    const fill = row.querySelector('.device-fill');
    if (fill) fill.style.width = `${Math.round(ratio * 100)}%`;
  }

  function tick(stamp) {
    frame = undefined;
    if (!visible || paused) return;
    if (stamp - lastPaint < 45) { frame = requestAnimationFrame(tick); return; }
    lastPaint = stamp;
    for (const [id, meter] of meters) {
      meter.analyser.getFloatTimeDomainData(meter.data);
      let sum = 0;
      for (const value of meter.data) sum += value * value;
      const rms = Math.sqrt(sum / meter.data.length);
      const db = 20 * Math.log10(rms || 1e-8);
      const target = Math.min(1, Math.max(0, (db + 60) / 50));
      meter.level = target > meter.level ? target : Math.max(target, meter.level - 0.08);
      const row = list.querySelector(`[data-value="${CSS.escape(id)}"]`);
      if (row) paint(row, meter.level);
    }
    frame = requestAnimationFrame(tick);
  }

  function stop() {
    generation += 1;
    if (frame) cancelAnimationFrame(frame);
    frame = undefined;
    for (const meter of meters.values()) {
      meter.stream.getTracks().forEach((track) => track.stop());
      meter.analyser.disconnect();
      meter.mute.disconnect();
    }
    meters.clear();
    for (const row of list.querySelectorAll('.device-row')) paint(row, 0);
  }

  async function add(deviceId, token) {
    const ctx = ready();
    const stream = await media.getUserMedia({ audio: { ...constraints, deviceId: { exact: deviceId } } });
    if (token !== generation || !visible || paused) { stream.getTracks().forEach((track) => track.stop()); return; }
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(analyser).connect(mute).connect(ctx.destination);
    meters.set(deviceId, { stream, analyser, mute, data: new Float32Array(analyser.fftSize), level: 0 });
  }

  function ready() {
    if (!context) {
      context = new AudioContext();
      // 浏览器要用户点过页面才允许音频上下文运行；恢复后立刻开始画电平。
      context.onstatechange = () => {
        if (context.state === 'running' && problem === SUSPENDED_HINT) setProblem('');
        begin();
      };
    }
    if (context.state === 'suspended') {
      context.resume().catch(() => {});
      if (!problem) setProblem(SUSPENDED_HINT);
    }
    return context;
  }

  function begin() {
    if (frame || !meters.size || !visible || paused || context?.state !== 'running') return;
    frame = requestAnimationFrame(tick);
  }

  async function start() {
    if (starting) { restart = true; return; }
    if (!visible || paused || tab) return;
    starting = true;
    try {
      if (!window.isSecureContext) {
        setProblem('麦克风需通过本机地址使用：localhost:3000 或 127.0.0.1:3000。');
        return;
      }
      if (!media) {
        setProblem('请用 Chrome 或 Edge 读取音频设备。');
        return;
      }
      const ids = [...select.options].map((option) => option.value).filter((value) => value && value !== 'default');
      if (!ids.length) {
        if (probed) { setProblem('未找到设备，请检查连接和麦克风权限。'); return; }
        // 未授权时浏览器不给设备名；先用默认设备申请一次权限，再让页面重新枚举。
        probed = true;
        try {
          const probe = await media.getUserMedia({ audio: constraints });
          probe.getTracks().forEach((track) => track.stop());
          setProblem('已授权，读取设备…');
          onDevicesChanged?.();
        } catch (error) {
          setProblem(explainDeviceError(error));
        }
        return;
      }
      const token = generation;
      let failure = '';
      for (const id of ids) {
        if (meters.has(id)) continue;
        try { await add(id, token); }
        catch (error) { failure ||= explainDeviceError(error); }
      }
      setProblem(failure || (context?.state === 'suspended' ? SUSPENDED_HINT : ''));
      begin();
    } finally {
      starting = false;
      if (restart) { restart = false; start(); }
    }
  }

  function render() {
    const options = [...select.options];
    const rows = options.map((option) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'device-row';
      row.dataset.value = option.value;
      row.setAttribute('role', 'radio');
      row.setAttribute('aria-checked', String(select.value === option.value));
      row.disabled = select.disabled || paused;
      if (!option.value) row.dataset.meter = 'none';
      const dot = document.createElement('span');
      dot.className = 'device-dot';
      dot.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span');
      name.className = 'device-name';
      name.textContent = option.textContent || '输入设备';
      const meter = document.createElement('span');
      meter.className = 'device-meter';
      meter.setAttribute('aria-hidden', 'true');
      const fill = document.createElement('span');
      fill.className = 'device-fill';
      meter.append(fill);
      row.append(dot, name, meter);
      row.onclick = () => {
        if (row.disabled) return;
        select.value = option.value;
        render();
        ready();
      };
      return row;
    });
    list.replaceChildren(...rows);
    list.hidden = tab;
    if (tab) showHint('启动识别时选择共享标签页音频。');
    else showHint(problem, Boolean(problem));
  }

  function refresh() {
    stop();
    render();
    if (visible && !paused && !tab) start();
  }

  function setPaused(value) {
    const next = Boolean(value);
    if (paused === next) return;
    paused = next;
    render();
    if (paused) stop();
    else if (visible) start();
  }

  function setTab(value) {
    const next = Boolean(value);
    if (tab === next) return;
    tab = next;
    problem = '';
    if (tab) stop();
    render();
    if (!tab && visible && !paused) start();
  }

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !paused) start();
    else stop();
  }, { threshold: 0 });
  observer.observe(list);

  document.addEventListener('pointerdown', () => {
    if (context?.state === 'suspended') context.resume().catch(() => {});
    if (visible && !paused && !meters.size) start();
  }, { passive: true });
  return { render, refresh, setPaused, setTab, stop };
}
