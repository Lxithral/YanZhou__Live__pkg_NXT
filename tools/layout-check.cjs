const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9223;
const URL_BASE = 'http://127.0.0.1:3000';
const PROFILE = path.join(__dirname, '.tmp', 'chrome-profile');
const SIZES = [
  [1920, 1080, '1920x1080'],
  [2560, 1440, '2560x1440'],
  [1536, 864, '1536x864'],
  [1366, 768, '1366x768'],
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.json();
}

async function waitForDevtools() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const version = await fetchJson(`http://127.0.0.1:${PORT}/json/version`);
      if (version.webSocketDebuggerUrl) return version;
    } catch {}
    await sleep(150);
  }
  throw new Error('DevTools endpoint did not start');
}

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  const events = new Map();
  let nextId = 1;
  socket.on('message', (data) => {
    const message = JSON.parse(String(data));
    if (message.id) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
      return;
    }
    const handlers = events.get(message.method);
    if (handlers) for (const handler of handlers) handler(message.params);
  });
  const ready = new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  function send(method, params = {}) {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  function once(method, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
      const handler = (params) => {
        clearTimeout(timer);
        events.get(method).delete(handler);
        resolve(params);
      };
      if (!events.has(method)) events.set(method, new Set());
      events.get(method).add(handler);
    });
  }
  return { ready, send, once, socket };
}

const PAGE_SCRIPT = String.raw`(() => {
  const out = {
    innerWidth, innerHeight, dpr: devicePixelRatio,
    scrollW: document.documentElement.scrollWidth,
    scrollH: document.documentElement.scrollHeight,
    bodyScrollH: document.body.scrollHeight,
    overflowX: document.documentElement.scrollWidth - innerWidth,
    overflowY: document.documentElement.scrollHeight - innerHeight,
  };
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) };
  };
  const q = (s) => document.querySelector(s);
  out.layout = {
    header: rect(q('.app-header')),
    shell: rect(q('.app-shell')),
    sidebar: rect(q('.module-sidebar')),
    monitor: rect(q('.monitor-column')),
    previewCard: rect(q('.preview-card')),
    previewStage: rect(q('#previewStage')),
    focusCard: rect(q('.focus-card')),
    focusStage: rect(q('#focusStage')),
    propertiesColumn: rect(q('.properties-column')),
    propertiesCard: rect(q('.properties-card')),
    footer: rect(q('.app-footer')),
    card: { client: q('.properties-card').clientHeight, scroll: q('.properties-card').scrollHeight },
    visibility: rect(q('.visibility-row')),
    save: rect(q('#saveStatus')),
  };
  const outside = [];
  document.querySelectorAll('button, input, select, textarea').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (r.bottom > innerHeight + 0.5 || r.right > innerWidth + 0.5 || r.top < -0.5) {
      outside.push({ tag: el.tagName, id: el.id || null, top: Math.round(r.top), bottom: Math.round(r.bottom), right: Math.round(r.right) });
    }
  });
  out.outsideCount = outside.length;
  out.outside = outside.slice(0, 10);
  const panels = [...document.querySelectorAll('[data-module-panel]')];
  const original = panels.map((panel) => panel.hidden);
  out.panels = {};
  for (const panel of panels) {
    for (const other of panels) other.hidden = true;
    panel.hidden = false;
    const panelRect = panel.getBoundingClientRect();
    out.panels[panel.dataset.modulePanel] = {
      client: panel.clientHeight,
      scroll: panel.scrollHeight,
      rect: { h: Math.round(panelRect.height), top: Math.round(panelRect.top), bottom: Math.round(panelRect.bottom) },
      sections: [...panel.querySelectorAll('.settings-section')].map((section) => ({
        h: Math.round(section.getBoundingClientRect().height),
        client: section.clientHeight,
        scroll: section.scrollHeight,
      })),
    };
  }
  panels.forEach((panel, index) => { panel.hidden = original[index]; });
  out.activePanel = (document.querySelector('[data-module-panel]:not([hidden])')?.dataset.modulePanel) || null;
  out.previewScale = q('#previewScale')?.textContent || null;
  out.focusScale = q('#focusScale')?.textContent || null;
  return out;
})()`;

async function main() {
  fs.mkdirSync(path.dirname(PROFILE), { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--force-device-scale-factor=1',
    'about:blank',
  ], { stdio: 'ignore' });

  const results = [];
  try {
    const version = await waitForDevtools();
    const target = await fetchJson(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(URL_BASE + '/control.html')}`, { method: 'PUT' });
    const client = connect(target.webSocketDebuggerUrl);
    await client.ready;
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await sleep(1800);

    for (const [width, height, label] of SIZES) {
      await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await sleep(900);
      const { result } = await client.send('Runtime.evaluate', { expression: PAGE_SCRIPT, returnByValue: true, awaitPromise: true });
      const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(__dirname, `.tmp`, `layout-${label}.png`), Buffer.from(shot.data, 'base64'));
      results.push({ label, ...result.value });
      console.log('checked', label);
    }

    await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await sleep(900);
    const darkShot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(__dirname, '.tmp', 'layout-dark.png'), Buffer.from(darkShot.data, 'base64'));
    console.log('checked 1920x1080 dark theme');
    client.socket.close();
  } finally {
    chrome.kill();
  }

  let failed = 0;
  for (const r of results) {
    const problems = [];
    if (r.overflowX > 1) problems.push(`page horizontal overflow ${r.overflowX}px`);
    if (r.overflowY > 1) problems.push(`page vertical overflow ${r.overflowY}px`);
    if (r.outsideCount) problems.push(`${r.outsideCount} controls outside viewport`);
    if (r.layout.card.scroll > r.layout.card.client + 1) problems.push(`properties card clipped by ${r.layout.card.scroll - r.layout.card.client}px`);
    if (!r.layout.footer || r.layout.footer.bottom > r.innerHeight + 1) problems.push('footer below viewport');
    for (const [id, panel] of Object.entries(r.panels)) {
      if (panel.scroll > panel.client + 1) problems.push(`panel ${id} clipped by ${panel.scroll - panel.client}px`);
      panel.sections.forEach((section, index) => {
        if (section.scroll > section.client + 1) problems.push(`panel ${id} section ${index + 1} clipped by ${section.scroll - section.client}px`);
      });
    }
    console.log(`\n=== ${r.label} ${r.innerWidth}x${r.innerHeight} ===`);
    console.log('scroll:', `${r.scrollW}x${r.scrollH}`, 'overflow:', r.overflowX, r.overflowY);
    console.log('monitor:', JSON.stringify(r.layout.monitor), 'previewStage:', JSON.stringify(r.layout.previewStage), 'focusStage:', JSON.stringify(r.layout.focusStage));
    console.log('propertiesCard:', JSON.stringify(r.layout.propertiesCard), 'client/scroll:', r.layout.card.client, '/', r.layout.card.scroll);
    console.log('panels:', Object.fromEntries(Object.entries(r.panels).map(([id, p]) => [id, `${p.client}/${p.scroll}`])));
    console.log('previewScale:', r.previewScale, 'focusScale:', r.focusScale, 'outside:', r.outsideCount);
    if (problems.length) { failed += 1; console.log('PROBLEMS:'); for (const problem of problems) console.log(' -', problem); }
    else console.log('OK: fits without scrolling or clipping');
  }
  console.log(failed ? `\n${failed} viewport(s) failed` : '\nAll viewports OK');
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
