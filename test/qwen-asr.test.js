import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { createPackagingServer } from '../server/server.js';
import { createSpeechSession } from '../server/speech-session.js';
import { ubuntuInstallArgs } from '../tools/setup-asr.js';

const MODE = 'qwen3-asr-0.6b';
const PCM = Buffer.alloc(1280);

test('WSL selects a distro from the machine catalog and omits unsupported flags', () => {
  assert.deepEqual(ubuntuInstallArgs('NAME  FRIENDLY NAME\r\nUbuntu  Ubuntu\r\nUbuntu-22.04  Ubuntu 22.04 LTS', '  --no-launch, -n'), {
    distro: 'Ubuntu', flags: ['--install', '-d', 'Ubuntu', '--no-launch'],
  });
  assert.deepEqual(ubuntuInstallArgs('NAME  FRIENDLY NAME\nUbuntu  Ubuntu\nUbuntu-24.04  Ubuntu 24.04 LTS', '--web-download'), {
    distro: 'Ubuntu-24.04', flags: ['--install', '-d', 'Ubuntu-24.04'],
  });
  assert.deepEqual(ubuntuInstallArgs('', ''), { distro: 'Ubuntu', flags: ['--install', '-d', 'Ubuntu'] });
});

function client(url, options) {
  const socket = new WebSocket(url, options);
  const queued = [];
  const waiters = [];
  socket.on('error', () => {});
  socket.on('message', (bytes) => {
    const message = JSON.parse(bytes.toString());
    const index = waiters.findIndex((entry) => entry.match(message));
    if (index < 0) queued.push(message);
    else { const [entry] = waiters.splice(index, 1); clearTimeout(entry.timer); entry.resolve(message); }
  });
  return { socket, send: (packet) => socket.send(JSON.stringify(packet)),
    ready: new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); }),
    wait(match) {
      const index = queued.findIndex(match);
      if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const entry = { match, resolve, timer: setTimeout(() => reject(new Error('Timed out: ' + JSON.stringify(queued))), 4000) };
        waiters.push(entry);
      });
    },
  };
}

async function fixture(t, { online = true } = {}) {
  const state = { ready: true, opens: 0, frames: 0, response: null, upstream: null };
  const engine = http.createServer((_req, res) => {
    if (!online) {
      res.writeHead(503).end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ model: MODE, ready: state.ready, sampleRate: 16000, message: 'Qwen loading' }));
  });
  const wss = new WebSocketServer({ server: engine });
  wss.on('connection', (socket) => {
    state.opens += 1;
    state.upstream = socket;
    socket.send(JSON.stringify({ type: 'ready', model: MODE, sampleRate: 16000 }));
    socket.on('message', (pcm) => {
      assert.equal(pcm.length, 1280);
      state.frames += 1;
      socket.send(JSON.stringify({ type: 'frame', event: state.response && { ...state.response, audioMs: state.frames * 40 } }));
    });
  });
  await new Promise((resolve) => engine.listen(0, '127.0.0.1', resolve));
  const serviceBase = `http://127.0.0.1:${engine.address().port}`;
  const directory = await mkdtemp(path.join(tmpdir(), 'yanzhou-qwen-test-'));
  const settingsPath = path.join(directory, 'settings.json');
  const app = await createPackagingServer({ settingsPath, asrServiceUrl: serviceBase });
  const address = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;
  const opened = [];
  async function connect(audio = false) {
    const connection = client(base.replace('http', 'ws') + (audio ? `/asr?mode=${MODE}&owner=speech` : '/ws'), audio ? { origin: base } : undefined);
    opened.push(connection);
    await connection.ready;
    return connection;
  }
  t.after(async () => {
    opened.forEach(({ socket }) => socket.terminate());
    await app.close();
    for (const socket of wss.clients) socket.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => engine.close(resolve));
  });
  return { state, app, connect, settingsPath, serviceBase, enableEngine() { online = true; } };
}

test('first startup prepares only 0.6B in the background and publishes readiness to connected pages', async (t) => {
  const setup = await fixture(t, { online: false });
  const control = await setup.connect();
  const lyrics = await setup.connect();
  const installed = new Promise((resolve) => {
    setup.app.startAsr({
      install: true,
      async configure(action, model, { report, signal }) {
        resolve({ action, model, signal });
        report('正在下载 Qwen3-ASR 0.6B');
      },
    });
  });
  const { action, model, signal } = await installed;
  assert.equal(action, 'auto');
  assert.equal(model, '0.6b');
  const installing = await control.wait((m) => m.type === 'lyrics:asr' && m.serviceMessage === '正在下载 Qwen3-ASR 0.6B');
  assert.equal(installing.available[MODE], false);
  setup.enableEngine();
  assert.equal((await control.wait((m) => m.type === 'lyrics:asr' && m.available[MODE])).serviceMessage, '');
  assert.equal((await lyrics.wait((m) => m.type === 'lyrics:asr' && m.available[MODE])).available['qwen3-asr-1.7b'], false);
  await setup.app.close();
  assert.equal(signal.aborted, true);
});

test('a reachable Qwen service is reused without a second installation', async (t) => {
  const setup = await fixture(t);
  let installs = 0;
  setup.app.startAsr({ install: true, async configure() { installs += 1; } });
  const control = await setup.connect();
  assert.equal((await control.wait((m) => m.type === 'lyrics:asr')).available[MODE], true);
  assert.equal(installs, 0);
});

test('one Qwen capture feeds host captions and lyric ASR; clear/stop never save transcripts', async (t) => {
  const setup = await fixture(t);
  const control = await setup.connect();
  const overlay = await setup.connect();
  await overlay.wait((m) => m.type === 'speech:state' && !m.text);
  await control.wait((m) => m.type === 'speech:state' && !m.text);
  const initial = await control.wait((m) => m.type === 'lyrics:asr');
  assert.deepEqual(initial.available, { [MODE]: true, 'qwen3-asr-1.7b': false });
  control.send({ type: 'patch', id: 'speech-style', patch: { modules: { speech: { visible: true, holdSeconds: 1, textColor: '#abcdef' } } } });
  await control.wait((m) => m.type === 'state' && m.id === 'speech-style');
  const audio = await setup.connect(true);
  await audio.wait((m) => m.type === 'ready');
  setup.state.response = { text: '欢迎来到校园歌手大赛', final: false };
  audio.socket.send(PCM);
  const partial = await overlay.wait((m) => m.type === 'speech:state' && m.text);
  assert.equal(partial.text, setup.state.response.text);
  assert.equal(partial.partial, true);
  assert.equal(partial.expiresAt - partial.updatedAt, 1000);
  const lyric = await control.wait((m) => m.type === 'lyrics:asr' && m.partial);
  assert.equal(lyric.partial, partial.text);
  assert.equal(lyric.owner, 'speech');
  const duplicate = await setup.connect(true);
  assert.match((await duplicate.wait((m) => m.type === 'error')).message, /共用/);
  assert.equal(setup.state.opens, 1);
  setup.state.response = { text: '欢迎来到校园歌手大赛。', final: true };
  audio.socket.send(PCM);
  assert.equal((await overlay.wait((m) => m.type === 'speech:state' && !m.partial && m.text)).text, setup.state.response.text);
  await control.wait((m) => m.type === 'lyrics:asr' && m.finals.length === 1);
  const reconnected = await setup.connect();
  const current = await reconnected.wait((m) => m.type === 'speech:state');
  assert.equal(current.expiresAt - current.updatedAt, 1000);
  const expired = await overlay.wait((m) => m.type === 'speech:state' && !m.text);
  assert.ok(expired.serverTime >= current.expiresAt);
  control.send({ type: 'speech:clear', id: 'clear' });
  await control.wait((m) => m.id === 'clear');
  control.send({ type: 'asr:stop', id: 'stop' });
  await control.wait((m) => m.type === 'lyrics:asr' && m.phase === 'idle');
  await setup.app.close();
  const disk = await readFile(setup.settingsPath, 'utf8');
  assert.ok(!disk.includes('欢迎来到'));
  assert.equal(JSON.parse(disk).modules.speech.textColor, '#ABCDEF');
  const restarted = await createPackagingServer({ settingsPath: setup.settingsPath, asrServiceUrl: setup.serviceBase });
  const address = await restarted.listen(0, '127.0.0.1');
  const fresh = client(`ws://127.0.0.1:${address.port}/ws`);
  try { await fresh.ready; assert.equal((await fresh.wait((m) => m.type === 'speech:state')).text, ''); }
  finally { fresh.socket.terminate(); await restarted.close(); }
});

test('Qwen health can be refreshed after startup and a service failure clears captions and disarms lyric ASR', async (t) => {
  const setup = await fixture(t);
  const control = await setup.connect();
  const secondPage = await setup.connect();
  await control.wait((m) => m.type === 'speech:state' && !m.text);
  await control.wait((m) => m.type === 'lyrics:state' && !m.armed);
  setup.state.ready = false;
  control.send({ type: 'asr:refresh', id: 'not-ready' });
  assert.equal((await control.wait((m) => m.id === 'not-ready')).available[MODE], false);
  assert.equal((await secondPage.wait((m) => m.id === 'not-ready')).available[MODE], false);
  setup.state.ready = true;
  control.send({ type: 'asr:refresh', id: 'ready' });
  assert.equal((await control.wait((m) => m.id === 'ready')).available[MODE], true);
  assert.equal((await secondPage.wait((m) => m.id === 'ready')).available[MODE], true);
  const audio = await setup.connect(true);
  await audio.wait((m) => m.type === 'ready');
  setup.state.response = { text: '接下来请欣赏精彩表演', final: true };
  audio.socket.send(PCM);
  await control.wait((m) => m.type === 'speech:state' && m.text);
  control.send({ type: 'lyrics:onair', id: 'air', payload: { source: 'asr' } });
  await control.wait((m) => m.type === 'lyrics:state' && m.id === 'air' && m.armed);
  setup.state.upstream.send('{bad json');
  await control.wait((m) => m.type === 'speech:state' && !m.text);
  assert.equal((await control.wait((m) => m.type === 'lyrics:state' && !m.armed)).armed, false);
  await control.wait((m) => m.type === 'lyrics:asr' && m.phase === 'error');
  control.send({ type: 'asr:refresh', id: 'recovered' });
  assert.equal((await control.wait((m) => m.id === 'recovered')).phase, 'idle');
});

test('speech clear is immediate and new partials renew the deadline without reviving expired text', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 1000;
  const changes = [];
  const session = createSpeechSession({ holdSeconds: () => 2, onChange: (m) => changes.push(m), now: () => now });
  session.accept({ text: '第一句', final: true });
  now += 1500;
  t.mock.timers.tick(1500);
  session.accept({ text: '第二句', final: false });
  now += 500;
  t.mock.timers.tick(500);
  assert.equal(session.snapshot().text, '第二句');
  now += 1500;
  t.mock.timers.tick(1500);
  assert.equal(session.snapshot().text, '');
  session.accept({ text: '立即清屏', final: true });
  session.clear();
  assert.equal(changes.at(-1).text, '');
  session.close();
});

test('invalid speech settings are rejected without accepting transcript fields', async (t) => {
  const setup = await fixture(t);
  const control = await setup.connect();
  for (const [index, values] of [{ holdSeconds: 0 }, { holdSeconds: 31 }, { text: '不能保存这段话' }].entries()) {
    const id = `invalid-${index}`;
    control.send({ type: 'patch', id, patch: { modules: { speech: values } } });
    assert.equal((await control.wait((m) => m.id === id)).type, 'error');
  }
  const audio = await setup.connect(true);
  await audio.wait((m) => m.type === 'ready');
  audio.socket.send(Buffer.alloc(10));
  assert.match((await audio.wait((m) => m.type === 'error')).message, /音频格式/);
});
