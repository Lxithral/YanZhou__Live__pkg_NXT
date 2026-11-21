import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { createPackagingServer } from '../server/server.js';
import { createSpeechSession } from '../server/speech-session.js';
import { readDashScopeConfig } from '../server/asr-capture.js';
import { CONTEST_HOTWORDS_2026, STREAMING_MODEL } from '../public/js/asr/asr-settings.js';
const EVENTS = 'conversation.item.input_audio_transcription.';
const PCM = Buffer.alloc(1280);

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

async function fixture(t, { statusCode = 0, autoFinish = true, streaming = false } = {}) {
  const asr = { apiKey: 'test-only-key-do-not-use', workspaceId: 'llm-example', connectTimeoutMs: 600, finishTimeoutMs: 150 };
  const state = { opens: 0, frames: 0, response: null, upstream: null, statusCode, finishes: 0 };
  const engine = http.createServer();
  const wss = new WebSocketServer({ noServer: true });
  engine.on('upgrade', (req, socket, head) => {
    assert.equal(req.headers.authorization, 'Bearer ' + asr.apiKey);
    if (state.statusCode) {
      socket.end(`HTTP/1.1 ${state.statusCode} Rejected\r\nConnection: close\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(req, socket, head, (connection) => wss.emit('connection', connection));
  });
  wss.on('connection', (socket) => {
    state.opens += 1;
    state.upstream = socket;
    let frames = 0;
    let taskId;
    socket.on('message', (data, binary) => {
      if (streaming) {
        const reply = (event, payload = {}) => socket.send(JSON.stringify({ header: { event, task_id: taskId }, payload }));
        if (binary) {
          assert.deepEqual(data, PCM);
          state.frames += 1;
          if (state.response) reply('result-generated', { output: { sentence: state.response } });
        } else {
          const message = JSON.parse(data);
          if (message.header.action === 'run-task') {
            taskId = message.header.task_id;
            assert.equal(message.payload.model, STREAMING_MODEL);
            assert.equal(message.payload.parameters.format, 'pcm');
            assert.equal(message.payload.parameters.sample_rate, 16000);
            state.vocabulary = message.payload.parameters.vocabulary;
            reply('task-started');
          } else {
            assert.equal(message.header.action, 'finish-task');
            assert.equal(message.header.task_id, taskId);
            state.finishes += 1;
            reply('task-finished');
          }
        }
        return;
      }
      assert.equal(binary, false);
      const message = JSON.parse(data);
      assert.equal(typeof message.event_id, 'string');
      if (message.type === 'session.update') {
        assert.equal(message.session.sample_rate, 16000);
        assert.equal(message.session.input_audio_format, 'pcm');
        assert.equal(message.session.turn_detection.type, 'server_vad');
        socket.send(JSON.stringify({ type: 'session.updated' }));
      } else if (message.type === 'session.finish') {
        state.finishes += 1;
        if (autoFinish) socket.send(JSON.stringify({ type: 'session.finished' }));
      } else {
        assert.equal(message.type, 'input_audio_buffer.append');
        assert.deepEqual(Buffer.from(message.audio, 'base64'), PCM);
        state.frames += 1;
        frames += 1;
        const result = state.response;
        if (!result) return;
        const item_id = result.item ?? 'item-1';
        if (result.final) {
          if (result.timed !== false) socket.send(JSON.stringify({ type: 'input_audio_buffer.speech_stopped', item_id, audio_end_ms: frames * 40 }));
          socket.send(JSON.stringify({ type: EVENTS + 'completed', item_id, transcript: result.text }));
        } else socket.send(JSON.stringify({ type: EVENTS + 'text', item_id, text: result.text, stash: result.stash }));
      }
    });
  });
  await new Promise((resolve) => engine.listen(0, '127.0.0.1', resolve));
  asr.connect = (url, options) => {
    assert.equal(url.href, 'wss://llm-example.cn-beijing.maas.aliyuncs.com/api-ws/v1/' +
      (streaming ? 'inference' : 'realtime?model=qwen3-asr-flash-realtime'));
    assert.equal(options.followRedirects, false);
    return new WebSocket(`ws://127.0.0.1:${engine.address().port}`, options);
  };
  const directory = await mkdtemp(path.join(tmpdir(), 'yanzhou-cloud-asr-test-'));
  const settingsPath = path.join(directory, 'settings.json');
  const app = await createPackagingServer({ settingsPath, asr });
  const address = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;
  const opened = [];
  async function connect(audio = false, options, owner = 'speech') {
    const route = audio ? `/asr?owner=${owner}` + (options ? '&options=1' : '') : '/ws';
    const connection = client(base.replace('http', 'ws') + route, audio ? { origin: base } : undefined);
    opened.push(connection);
    await connection.ready;
    if (options) connection.send(options);
    return connection;
  }
  t.after(async () => {
    opened.forEach(({ socket }) => socket.terminate());
    await app.close();
    for (const socket of wss.clients) socket.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => engine.close(resolve));
  });
  return { state, app, connect, settingsPath, asr };
}

test('streaming probe and capture send temporary vocabulary and binary audio', async (t) => {
  const setup = await fixture(t, { streaming: true });
  const control = await setup.connect();
  const options = {
    model: STREAMING_MODEL,
    hotwords: [...CONTEST_HOTWORDS_2026, '烟洲中学，彩排嘉宾'].join('\n'),
  };
  const expected = Object.fromEntries([...CONTEST_HOTWORDS_2026, '彩排嘉宾'].map((word) => [word, 5]));
  const rejected = await setup.connect(true, { hotwords: '烟洲中学' });
  await rejected.wait((event) => event.type === 'error' && /切换/.test(event.message));
  assert.equal(setup.state.opens, 0);
  control.send({ type: 'asr:test', options });
  await control.wait((event) => !event.testing && /连接正常/.test(event.serviceMessage ?? ''));
  assert.deepEqual(setup.state.vocabulary, expected);
  assert.equal(setup.state.frames, 0);
  const audio = await setup.connect(true, options);
  await audio.wait((event) => event.type === 'ready');
  setup.state.response = { sentence_id: 1, begin_time: 0, text: '烟洲', sentence_end: false };
  audio.socket.send(PCM);
  assert.deepEqual(setup.state.vocabulary, expected);
  await control.wait((event) => event.model === STREAMING_MODEL && event.partial === '烟洲');
  setup.state.response = { ...setup.state.response, end_time: 80, text: '烟洲中学', sentence_end: true };
  audio.socket.send(PCM);
  await control.wait((event) => event.finals?.at(-1)?.text === '烟洲中学');
  control.send({ type: 'asr:stop' });
  await control.wait((event) => event.phase === 'idle' && event.model === null && event.finals?.at(-1)?.text === '烟洲中学');
  assert.equal(setup.state.frames, 2);
  assert.equal(setup.state.finishes, 1);
});

test('the explicit connection test sends no PCM and reports auth failure and recovery to both pages', async (t) => {
  const setup = await fixture(t, { statusCode: 401 });
  const control = await setup.connect();
  const lyrics = await setup.connect();
  await control.wait((m) => m.type === 'lyrics:asr' && m.configured);
  assert.equal(setup.state.opens, 0);
  control.send({ type: 'asr:test' });
  await control.wait((m) => m.testing);
  const denied = await lyrics.wait((m) => m.type === 'lyrics:asr' && /鉴权失败/.test(m.serviceMessage));
  assert.equal(denied.testing, false);
  assert.ok(!JSON.stringify(denied).includes(setup.asr.apiKey));
  setup.state.statusCode = 0;
  lyrics.send({ type: 'asr:test' });
  await control.wait((m) => m.type === 'lyrics:asr' && !m.testing && /连接正常/.test(m.serviceMessage));
  assert.equal(setup.state.frames, 0);
  assert.equal(setup.state.finishes, 1);
});

test('only ASR credentials are read from the local dotenv file, with process values taking priority', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'yanzhou-asr-config-'));
  const file = path.join(directory, '.env');
  const missing = await readDashScopeConfig(file, {});
  assert.equal(missing.apiKey, undefined);
  await writeFile(file, '\uFEFFDASHSCOPE_API_KEY="local-test-key"\nDASHSCOPE_WORKSPACE_ID=llm-example\nPORT=8080\n');
  assert.deepEqual(await readDashScopeConfig(file, { DASHSCOPE_API_KEY: 'env-test-key' }), {
    apiKey: 'env-test-key', workspaceId: 'llm-example',
  });
});

test('the host session feeds speech captions without saving text or credentials', async (t) => {
  const setup = await fixture(t);
  const control = await setup.connect();
  const overlay = await setup.connect();
  await overlay.wait((m) => m.type === 'speech:state' && !m.text);
  assert.equal((await control.wait((m) => m.type === 'lyrics:asr')).configured, true);
  control.send({ type: 'patch', id: 'speech-style', patch: { modules: { speech: { visible: true, holdSeconds: 1, textColor: '#abcdef' } } } });
  await control.wait((m) => m.type === 'state' && m.id === 'speech-style');
  const audio = await setup.connect(true);
  await audio.wait((m) => m.type === 'ready');
  setup.state.response = { text: '欢迎来到', stash: '校园歌手大赛' };
  audio.socket.send(PCM);
  const partial = await overlay.wait((m) => m.type === 'speech:state' && m.text);
  assert.equal(partial.text, '欢迎来到校园歌手大赛');
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
  control.send({ type: 'asr:stop', id: 'stop' });
  await control.wait((m) => m.type === 'lyrics:asr' && m.phase === 'stopping');
  await control.wait((m) => m.type === 'lyrics:asr' && m.phase === 'idle' && m.finals.length);
  assert.equal(setup.state.finishes, 1);
  await setup.app.close();
  const disk = await readFile(setup.settingsPath, 'utf8');
  assert.ok(!disk.includes('欢迎来到') && !disk.includes(setup.asr.apiKey));
  assert.equal(JSON.parse(disk).modules.speech.textColor, '#ABCDEF');
  const restarted = await createPackagingServer({ settingsPath: setup.settingsPath, asr: setup.asr });
  const address = await restarted.listen(0, '127.0.0.1');
  const fresh = client(`ws://127.0.0.1:${address.port}/ws`);
  try { await fresh.ready; assert.equal((await fresh.wait((m) => m.type === 'speech:state')).text, ''); }
  finally { fresh.socket.terminate(); await restarted.close(); }
});

test('ASR cannot go on air as lyrics, and a cloud disconnect leaves existing lyrics on air', async (t) => {
  const setup = await fixture(t);
  const control = await setup.connect();
  await control.wait((m) => m.type === 'speech:state' && !m.text);
  await control.wait((m) => m.type === 'lyrics:state' && !m.armed);
  const audio = await setup.connect(true);
  await audio.wait((m) => m.type === 'ready');
  setup.state.response = { text: '接下来请欣赏精彩表演', final: true };
  audio.socket.send(PCM);
  await control.wait((m) => m.type === 'speech:state' && m.text);
  control.send({ type: 'lyrics:onair', id: 'air', payload: { source: 'manual' } });
  await control.wait((m) => m.type === 'lyrics:state' && m.id === 'air' && m.armed);
  control.send({ type: 'lyrics:onair', id: 'asr-air', payload: { source: 'asr' } });
  assert.equal((await control.wait((m) => m.id === 'asr-air')).type, 'error');
  setup.state.upstream.terminate();
  await control.wait((m) => m.type === 'speech:state' && !m.text);
  await control.wait((m) => m.type === 'lyrics:asr' && m.phase === 'error');
  const { source, armed } = setup.app.getState().settings.modules.lyrics;
  assert.equal(source, 'manual');
  assert.equal(armed, true);
  const recovered = await setup.connect(true);
  await recovered.wait((m) => m.type === 'ready');
  assert.equal(setup.state.opens, 2);
});

test('stopping a non-responsive cloud session releases the socket within the finish timeout', async (t) => {
  const setup = await fixture(t, { autoFinish: false });
  const control = await setup.connect();
  const first = await setup.connect(true);
  await first.wait((m) => m.type === 'ready');
  const closed = new Promise((resolve) => setup.state.upstream.once('close', resolve));
  control.send({ type: 'asr:stop' });
  await control.wait((m) => m.type === 'lyrics:asr' && m.phase === 'stopping');
  await control.wait((m) => m.type === 'lyrics:asr' && m.phase === 'idle');
  await closed;
  const second = await setup.connect(true);
  await second.wait((m) => m.type === 'ready');
  assert.equal(setup.state.opens, 2);
});

test('only timed finals from the lyric capture correct the timeline without producing speech captions', async (t) => {
  const setup = await fixture(t);
  const control = await setup.connect();
  const command = async (type, id, payload) => {
    control.send({ type, id, payload });
    const response = await control.wait((m) => m.id === id);
    assert.equal(response.type, 'lyrics:state', response.message);
  };
  await command('lyrics:load', 'load-song', { doc: [
    { start: 1500, text: '照亮我的青春', tokens: [], credit: false },
    { start: 8000, text: '我们一起唱歌', tokens: [], credit: false },
  ] });
  await command('lyrics:onair', 'onair', { source: 'timeline' });
  await command('lyrics:correct', 'correct', { enabled: true });
  const hostAudio = await setup.connect(true);
  await hostAudio.wait((m) => m.type === 'ready');
  await command('lyrics:transport', 'play-host', { action: 'play', value: null });
  setup.state.response = { text: '照亮我的青春', final: true };
  hostAudio.socket.send(PCM);
  const hostFinal = await control.wait((m) => m.type === 'lyrics:asr' && m.owner === 'speech' && m.finals.length === 1);
  assert.equal(hostFinal.correction.confidence, null);
  await command('lyrics:transport', 'pause', { action: 'pause', value: null });
  setup.state.upstream.terminate();
  await control.wait((m) => m.type === 'lyrics:asr' && m.phase === 'error');
  await command('lyrics:transport', 'rewind', { action: 'seek', value: 0 });
  const audio = await setup.connect(true, undefined, 'lyrics');
  await audio.wait((m) => m.type === 'ready');
  await command('lyrics:transport', 'play', { action: 'play', value: null });
  setup.state.response = { text: '照亮我的青春', item: 'first', final: true, timed: false };
  audio.socket.send(PCM);
  const untimed = await control.wait((m) => m.type === 'lyrics:asr' && m.owner === 'lyrics' && m.finals.length === 1);
  assert.equal(untimed.correction.history.length, 0);
  setup.state.response = { text: '照亮我的青春', item: 'second', final: true };
  audio.socket.send(PCM);
  const corrected = await control.wait((m) => m.type === 'lyrics:asr' && m.finals.length === 2);
  assert.equal(corrected.correction.history.length, 1);
  assert.equal(corrected.correction.history[0].estimated, true);
  const adjustment = await control.wait((m) => m.type === 'lyrics:state' && Number.isFinite(m.correctionDelta));
  const { from, to } = corrected.correction.history[0];
  assert.equal(adjustment.correctionDelta, to - from);
  const overlay = await setup.connect();
  assert.equal((await overlay.wait((m) => m.type === 'speech:state')).text, '');
  const lyrics = await overlay.wait((m) => m.type === 'lyrics:state');
  assert.equal(lyrics.source, 'timeline');
  assert.equal(lyrics.doc[0].text, '照亮我的青春');
  control.send({ type: 'asr:stop' });
  const stopped = await control.wait((m) => m.type === 'lyrics:asr' && m.phase === 'idle' && m.resultOwner === 'lyrics');
  assert.equal(stopped.finals.length, 2);
  assert.deepEqual(stopped.correction.history, corrected.correction.history);
  const beforeClear = setup.app.getState().revision;
  control.send({ type: 'lyrics:clear-correction-log', payload: {} });
  const cleared = await overlay.wait((m) => m.type === 'lyrics:asr' && m.phase === 'idle' && m.correction.history.length === 0);
  assert.equal(cleared.correction.enabled, true);
  assert.equal(cleared.finals.length, 2);
  assert.equal(setup.app.getState().revision, beforeClear);
  assert.equal(setup.app.getState().settings.modules.lyrics.source, 'timeline');
  assert.equal(setup.app.getState().settings.modules.lyrics.armed, true);
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
