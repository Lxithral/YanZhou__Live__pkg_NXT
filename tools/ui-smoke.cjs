const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9224;
const BASE = 'http://127.0.0.1:3000';
const PROFILE = path.join(__dirname, '.tmp', 'chrome-ui');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function waitDevtools() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const v = await json(`http://127.0.0.1:${PORT}/json/version`);
      if (v.webSocketDebuggerUrl) return v;
    } catch {}
    await sleep(150);
  }
  throw new Error('devtools did not start');
}

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  const listeners = new Map();
  let id = 1;
  const errors = [];
  socket.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.id) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(`exception: ${msg.params.exceptionDetails.text}`);
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(`log: ${msg.params.entry.text}`);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(`console: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    }
    const set = listeners.get(msg.method);
    if (set) for (const fn of set) fn(msg.params);
  });
  const ready = new Promise((res, rej) => { socket.once('open', res); socket.once('error', rej); });
  return {
    ready,
    errors,
    send(method, params = {}) {
      const mid = id++;
      return new Promise((resolve, reject) => {
        pending.set(mid, { resolve, reject });
        socket.send(JSON.stringify({ id: mid, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

async function evaluate(client, expression) {
  const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true, userGesture: true,
  });
  if (exceptionDetails) throw new Error(`page error: ${exceptionDetails.text} ${exceptionDetails.exception?.description || ''}`);
  return result.value;
}

const failures = [];
function check(name, condition, detail) {
  if (condition) console.log(`PASS ${name}`);
  else { failures.push(name); console.log(`FAIL ${name}${detail ? ` -> ${JSON.stringify(detail)}` : ''}`); }
}

async function patchModule(module, values) {
  const socket = new WebSocket('ws://127.0.0.1:3000/ws', { headers: { Origin: BASE } });
  await new Promise((res, rej) => { socket.once('open', res); socket.once('error', rej); });
  const ack = new Promise((res) => {
    socket.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'saved') res(true);
      if (msg.type === 'error') res(false);
    });
  });
  socket.send(JSON.stringify({ type: 'patch', id: `smoke-${Date.now()}`, patch: { modules: { [module]: values } } }));
  const ok = await ack;
  socket.close();
  return ok;
}

async function main() {
  const initial = await json(`${BASE}/api/state`);
  const initialModules = JSON.parse(JSON.stringify(initial.settings.modules));
  fs.mkdirSync(path.dirname(PROFILE), { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--force-device-scale-factor=1', 'about:blank',
  ], { stdio: 'ignore' });

  let client;
  try {
    await waitDevtools();
    const target = await json(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(`${BASE}/control.html`)}`, { method: 'PUT' });
    client = connect(target.webSocketDebuggerUrl);
    await client.ready;
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Log.enable');
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await sleep(2200);

    check('three module buttons', await evaluate(client, `document.querySelectorAll('[data-module-button]').length`) === 3);
    check('connected status', /已连接/.test(await evaluate(client, `document.getElementById('connectionStatus').textContent`)));
    check('only logo panel visible', await evaluate(client, `[...document.querySelectorAll('[data-module-panel]')].filter(p=>!p.hidden).map(p=>p.dataset.modulePanel).join(',')`) === 'logo');

    await evaluate(client, `document.querySelector('[data-module-button="hosts"]').click()`);
    await sleep(260);
    check('switch to hosts', await evaluate(client, `document.getElementById('propertiesTitle').textContent.trim()`) === '主持字幕设置');
    check('hosts panel shown', await evaluate(client, `![...document.querySelectorAll('[data-module-panel]')].find(p=>p.dataset.modulePanel==='hosts').hidden`));
    check('visibility toggle label follows', /主持字幕/.test(await evaluate(client, `document.getElementById('visibilityTitle').textContent`)));

    await evaluate(client, `(() => { const el = document.getElementById('hostsNames'); el.value = '测试甲\\n测试乙'; el.dispatchEvent(new Event('input', { bubbles: true })); return el.value; })()`);
    await sleep(500);
    let state = await json(`${BASE}/api/state`);
    check('hosts names reach server', state.settings.modules.hosts.names === '测试甲\n测试乙', state.settings.modules.hosts.names);

    await evaluate(client, `(() => { const el = document.getElementById('hostsEnter'); el.value = 'slide-right'; el.dispatchEvent(new Event('change', { bubbles: true })); return el.value; })()`);
    await sleep(400);
    state = await json(`${BASE}/api/state`);
    check('hosts enter animation saved', state.settings.modules.hosts.animation.enter === 'slide-right', state.settings.modules.hosts.animation.enter);

    // 快捷定位右下（hosts 面板）
    await evaluate(client, `document.querySelector('[data-module-panel="hosts"] [data-position="bottom-right"]').click()`);
    await sleep(420);
    state = await json(`${BASE}/api/state`);
    check('preset moves hosts to bottom-right', state.settings.modules.hosts.x > 1000 && state.settings.modules.hosts.y > 800, { x: state.settings.modules.hosts.x, y: state.settings.modules.hosts.y });

    // 回到 logo 面板并拖动预览里的挂角
    await evaluate(client, `document.querySelector('[data-module-button="logo"]').click()`);
    await sleep(300);
    const before = (await json(`${BASE}/api/state`)).settings.modules.logo;
    const box = await evaluate(client, `(() => { const el = document.querySelector('.preview-canvas .module-layer'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    check('logo layer measurable in preview', !!box, box);
    if (box) {
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1, buttons: 1 });
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + 40, y: box.y + 30, button: 'left', buttons: 1 });
      await sleep(60);
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x + 40, y: box.y + 30, button: 'left', buttons: 0 });
      await sleep(500);
      const after = (await json(`${BASE}/api/state`)).settings.modules.logo;
      check('dragging preview moves the module', after.x !== before.x || after.y !== before.y, { before: [before.x, before.y], after: [after.x, after.y] });
    }

    // 显示开关
    const beforeVisible = (await json(`${BASE}/api/state`)).settings.modules.logo.visible;
    await evaluate(client, `document.getElementById('moduleVisible').click()`);
    await sleep(420);
    check('visibility toggle reaches server', (await json(`${BASE}/api/state`)).settings.modules.logo.visible === !beforeVisible);

    // 预览里的退出动画（隐藏 -> 显示）
    await evaluate(client, `document.getElementById('moduleVisible').click()`);
    await sleep(500);

    check('no console errors', client.errors.length === 0, client.errors.slice(0, 4));
    const shot = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, '.tmp', 'ui-final.png'), Buffer.from(shot.data, 'base64'));
  } finally {
    if (client) client.close();
    chrome.kill();
  }

  // 还原初始设置
  for (const [module, values] of Object.entries(initialModules)) {
    await patchModule(module, values);
  }
  const restored = (await json(`${BASE}/api/state`)).settings.modules;
  check('settings restored', JSON.stringify(restored) === JSON.stringify(initialModules));

  console.log(failures.length ? `\n${failures.length} check(s) failed: ${failures.join(', ')}` : '\nAll UI checks passed');
  process.exitCode = failures.length ? 1 : 0;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
