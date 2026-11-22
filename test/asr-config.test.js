import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { saveDashScopeConfig, validateDashScopeCredentials } from '../server/asr-config.js';
import { createAsrCapture, readDashScopeConfig } from '../server/asr-capture.js';
import { createPackagingServer } from '../server/server.js';

const OLD_KEY = 'fake-old-key-only-for-tests';
const NEW_KEY = 'fake-new-key-only-for-tests';
const credentials = { apiKey: NEW_KEY, workspaceId: 'llm-new' };

function pendingUpstream() {
  const socket = new EventEmitter();
  socket.readyState = WebSocket.CONNECTING;
  socket.terminate = () => { socket.readyState = WebSocket.CLOSED; socket.emit('close'); };
  socket.close = socket.terminate;
  socket.send = () => {};
  socket.ping = () => {};
  return socket;
}

async function fixture(t, { blocked = false } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'yanzhou-asr-key-tests-'));
  const settingsPath = path.join(directory, 'settings.json');
  const asrConfigPath = path.join(directory, '.env');
  if (blocked) await mkdir(asrConfigPath);
  else await writeFile(asrConfigPath, `# retain this comment\nPORT=3000\nDASHSCOPE_API_KEY=${OLD_KEY}\nDASHSCOPE_WORKSPACE_ID=llm-old\n`);
  const connections = [];
  const asr = { apiKey: OLD_KEY, workspaceId: 'llm-old', connectTimeoutMs: 4000,
    connect(url, options) { connections.push({ url, options }); return pendingUpstream(); },
  };
  const app = await createPackagingServer({ settingsPath, asrConfigPath, asr });
  const { port } = await app.listen(0, '127.0.0.1');
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const packets = [];
  socket.on('message', (data) => packets.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const request = (message) => {
    socket.send(JSON.stringify(message));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.off('message', listener); reject(new Error('Response timed out')); }, 4000);
      const listener = (bytes) => {
        const result = JSON.parse(bytes.toString());
        if (result.id !== message.id) return;
        clearTimeout(timer);
        socket.off('message', listener);
        resolve(result);
      };
      socket.on('message', listener);
    });
  };
  t.after(async () => { socket.terminate(); await app.close(); });
  return { app, directory, settingsPath, asrConfigPath, asr, packets, connections, request };
}

test('saving local ASR credentials preserves dotenv comments, unrelated multiline values and duplicate assignments', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'yanzhou-asr-env-tests-'));
  const file = path.join(directory, '.env');
  await writeFile(file, '\uFEFF# keep\r\nPORT=8080\r\nOTHER="first\r\nDASHSCOPE_API_KEY=fake-inner\r\nlast"\r\n export DASHSCOPE_API_KEY = "old-one" # key comment\r\nDASHSCOPE_API_KEY=old-two\r\nDASHSCOPE_WORKSPACE_ID = llm-old # workspace comment\r\n');
  await saveDashScopeConfig(file, { apiKey: 'fake-new#key', workspaceId: '' });
  const contents = await readFile(file, 'utf8');
  assert.ok(contents.startsWith('\uFEFF# keep\r\nPORT=8080\r\n'));
  assert.ok(contents.includes('OTHER="first\r\nDASHSCOPE_API_KEY=fake-inner\r\nlast"\r\n'));
  assert.ok(contents.includes('# key comment\r\n') && contents.includes('# workspace comment\r\n'));
  assert.ok(!contents.includes('old-one') && !contents.includes('old-two'));
  assert.deepEqual(await readDashScopeConfig(file, {}), { apiKey: 'fake-new#key', workspaceId: '' });
  assert.deepEqual(await readdir(directory), ['.env'], 'atomic save leaves no temporary files');
});

test('ASR credential validation rejects malformed input without echoing values', () => {
  for (const options of [undefined, [], {}, { apiKey: '' }, { apiKey: `${NEW_KEY}\nPORT=9` },
    { apiKey: NEW_KEY, workspaceId: NEW_KEY + '.invalid' }, { apiKey: NEW_KEY, unexpected: NEW_KEY }]) {
    assert.throws(() => validateDashScopeCredentials(options), (error) => !error.message.includes(NEW_KEY));
  }
  assert.deepEqual(validateDashScopeCredentials({ apiKey: ` ${NEW_KEY} ` }), { apiKey: NEW_KEY, workspaceId: '' });
});

test('a failed or pending credential save cannot switch the capture key or start a competing capture', async () => {
  const connects = [];
  const capture = createAsrCapture({ apiKey: OLD_KEY, connect(url, options) { connects.push({ url, options }); return pendingUpstream(); } });
  await assert.rejects(capture.configure(credentials, async () => { throw new Error('save failed'); }), /save failed/);
  assert.equal(capture.workspaceId, '');
  let finishSave;
  const saving = capture.configure(credentials, () => new Promise((resolve) => { finishSave = resolve; }));
  capture.test();
  assert.equal(connects.length, 0, 'a test cannot start while saving');
  const audio = new EventEmitter();
  audio.readyState = WebSocket.OPEN;
  const rejected = [];
  audio.send = (data) => rejected.push(JSON.parse(data));
  audio.close = () => {};
  capture.attach(audio, 'speech');
  assert.match(rejected[0].message, /保存/);
  await assert.rejects(capture.configure(credentials, async () => {}), /停止识别|连接测试/);
  finishSave();
  await saving;
  assert.equal(capture.workspaceId, 'llm-new');
  capture.test();
  assert.equal(connects[0].options.headers.Authorization, `Bearer ${NEW_KEY}`);
  assert.equal(connects[0].url.hostname, 'llm-new.cn-beijing.maas.aliyuncs.com');
  await assert.rejects(capture.configure({ apiKey: OLD_KEY }, async () => {}), /停止识别|连接测试/);
  await capture.close();
});

test('a controller saves credentials privately, uses them immediately and reloads them after restart', async (t) => {
  const setup = await fixture(t);
  const response = await setup.request({ type: 'asr:configure', id: 'save-key', options: credentials });
  assert.equal(response.type, 'asr:config');
  assert.equal(response.ok, true);
  assert.deepEqual(await readDashScopeConfig(setup.asrConfigPath, {}), credentials);
  assert.ok(setup.packets.some((packet) => packet.type === 'lyrics:asr' && packet.configured && packet.credentialsEditable && packet.workspaceId === 'llm-new'));
  await setup.request({ type: 'asr:test', id: 'test-new-key' });
  assert.equal(setup.connections[0].options.headers.Authorization, `Bearer ${NEW_KEY}`);
  assert.ok(!JSON.stringify(setup.packets).includes(NEW_KEY), 'responses never include the key');
  assert.ok(!JSON.stringify(setup.app.getState()).includes(NEW_KEY));
  assert.ok(!(await readFile(setup.settingsPath, 'utf8')).includes(NEW_KEY));
  await setup.app.close();
  const restarted = await createPackagingServer({ settingsPath: setup.settingsPath, asrConfigPath: setup.asrConfigPath,
    asr: { ...await readDashScopeConfig(setup.asrConfigPath, {}), connect: setup.asr.connect },
  });
  const address = await restarted.listen(0, '127.0.0.1');
  const restartedSocket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
  const restartedState = new Promise((resolve) => restartedSocket.on('message', (data) => {
    const packet = JSON.parse(data.toString());
    if (packet.type === 'lyrics:asr') resolve(packet);
  }));
  await new Promise((resolve, reject) => { restartedSocket.once('open', resolve); restartedSocket.once('error', reject); });
  const state = await restartedState;
  assert.equal(state.configured, true);
  assert.equal(state.workspaceId, 'llm-new');
  restartedSocket.terminate();
  await restarted.close();
  assert.deepEqual(await readDashScopeConfig(setup.asrConfigPath, {}), credentials);
});

test('a busy connection test rejects credential saving and keeps the existing file and upstream', async (t) => {
  const setup = await fixture(t);
  const before = await readFile(setup.asrConfigPath, 'utf8');
  await setup.request({ type: 'asr:test', id: 'start-test' });
  const response = await setup.request({ type: 'asr:configure', id: 'save-while-busy', options: credentials });
  assert.equal(response.type, 'asr:config');
  assert.equal(response.ok, false);
  assert.match(response.message, /停止识别|连接测试/);
  assert.equal(await readFile(setup.asrConfigPath, 'utf8'), before);
  assert.equal(setup.connections.length, 1);
  assert.equal(setup.connections[0].options.headers.Authorization, `Bearer ${OLD_KEY}`);
});

test('a failed file save returns a private error and keeps the live credentials', async (t) => {
  const setup = await fixture(t, { blocked: true });
  const response = await setup.request({ type: 'asr:configure', id: 'failed-save', options: credentials });
  assert.equal(response.type, 'asr:config');
  assert.equal(response.ok, false);
  assert.match(response.message, /无法读取|无法保存/);
  assert.ok(!JSON.stringify(setup.packets).includes(NEW_KEY));
  await setup.request({ type: 'asr:test', id: 'test-old-key' });
  assert.equal(setup.connections[0].options.headers.Authorization, `Bearer ${OLD_KEY}`);
});
