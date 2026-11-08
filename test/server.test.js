import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createPackagingServer } from '../server.js';
import { buildLyricDocument, jsonBytes, LYRIC_BYTES, parseLrc, timelineIndex } from '../public/lyrics-model.js';
import { createLyricsClock } from '../public/lyrics-clock.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Register the message listener before opening completes: the server sends its
// initial state immediately, and that message must remain available to tests.
function openClient(url) {
  const socket = new WebSocket(url);
  const queue = [];
  const waiters = new Set();
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    const waiter = [...waiters].find((entry) => entry.predicate(message));
    if (waiter) {
      waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else {
      queue.push(message);
    }
  });
  // Errors are handled by the opening promise or individual expectations.
  socket.on('error', () => {});

  return {
    socket,
    ready: new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    }),
    send(message) {
      socket.send(JSON.stringify(message));
    },
    waitFor(predicate, timeoutMs = 4000) {
      const index = queue.findIndex(predicate);
      if (index !== -1) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, reject, timer: null };
        waiter.timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error(`Timed out waiting for a WebSocket message; queued: ${JSON.stringify(queue)}`));
        }, timeoutMs);
        waiters.add(waiter);
      });
    },
    close() {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('Client closed while awaiting a message'));
      }
      waiters.clear();
      socket.terminate();
    },
  };
}

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'yanzhou-live-tests-'));
  const settingsPath = path.join(directory, 'settings.json');
  const applications = new Set();
  const clients = new Set();
  t.after(async () => {
    for (const client of clients) client.close();
    for (const app of applications) await app.close();
    // Keep the tiny, independently generated fixtures for diagnosis. No
    // recursive deletion touches user directories or project settings.
  });
  return {
    directory,
    settingsPath,
    async start(extraOptions = {}) {
      const app = await createPackagingServer({
        settingsPath,
        saveDelayMs: 120,
        rootDir: projectRoot,
        ...options,
        ...extraOptions,
      });
      applications.add(app);
      const address = await app.listen(0, '127.0.0.1');
      return { app, url: `http://127.0.0.1:${address.port}`, wsUrl: `ws://127.0.0.1:${address.port}/ws` };
    },
    async stop(app) {
      await app.close();
      applications.delete(app);
    },
    async connect(wsUrl) {
      const client = openClient(wsUrl);
      clients.add(client);
      await client.ready;
      return client;
    },
  };
}

test('a control change immediately reaches another client and is saved on disk', async (t) => {
  const setup = await fixture(t);
  const { wsUrl } = await setup.start();
  const controller = await setup.connect(wsUrl);
  const overlay = await setup.connect(wsUrl);
  const initial = await controller.waitFor((message) => message.type === 'state');
  const overlayInitial = await overlay.waitFor((message) => message.type === 'state');
  assert.deepEqual(overlayInitial.settings, initial.settings);
  assert.equal(initial.settings.version, 2);
  assert.deepEqual(Object.keys(initial.settings.modules), ['logo', 'hosts', 'program', 'lyrics']);

  controller.send({ type: 'patch', id: 'custom-logo', patch: { modules: { logo: {
    title: '校园开放日', subtitle: 'LIVE · 2026', color: '#123456', textColor: '#abcdef',
    x: 123, y: 67, scale: 1.25, opacity: 82, animation: { enter: 'slide-left', duration: 480 },
  } } } });

  const controllerState = await controller.waitFor((message) => message.type === 'state' && message.settings.modules.logo.title === '校园开放日');
  const overlayState = await overlay.waitFor((message) => message.type === 'state' && message.settings.modules.logo.title === '校园开放日');
  assert.deepEqual(overlayState.settings, controllerState.settings);
  assert.equal(overlayState.settings.modules.logo.x, 123);
  assert.equal(overlayState.settings.modules.logo.scale, 1.25);
  assert.equal(overlayState.settings.modules.logo.animation.enter, 'slide-left');
  assert.deepEqual(overlayState.settings.modules.logo.animation, { enter: 'slide-left', exit: 'fade-down', duration: 480 });
  assert.ok(controllerState.revision > initial.revision);

  await controller.waitFor((message) => message.type === 'saved' && message.revision >= controllerState.revision);
  const persisted = JSON.parse(await readFile(setup.settingsPath, 'utf8'));
  assert.deepEqual(persisted, controllerState.settings);
});

test('rapid changes retain the final value and restarting restores it', async (t) => {
  const setup = await fixture(t);
  const first = await setup.start();
  const controller = await setup.connect(first.wsUrl);
  await controller.waitFor((message) => message.type === 'state');
  for (let index = 0; index < 40; index += 1) {
    controller.send({ type: 'patch', id: `drag-${index}`, patch: { modules: { logo: { x: 80 + index, y: 60 + index } } } });
  }
  const final = await controller.waitFor((message) => message.type === 'state' && message.settings.modules.logo.x === 119);
  await controller.waitFor((message) => message.type === 'saved' && message.revision >= final.revision);
  assert.equal(JSON.parse(await readFile(setup.settingsPath, 'utf8')).modules.logo.x, 119);
  controller.close();
  await setup.stop(first.app);

  const restarted = await setup.start();
  const overlay = await setup.connect(restarted.wsUrl);
  const restored = await overlay.waitFor((message) => message.type === 'state');
  assert.deepEqual(restored.settings, final.settings);
});

test('closing the server flushes an edit before the debounce interval', async (t) => {
  const setup = await fixture(t, { saveDelayMs: 60000 });
  const { app, wsUrl } = await setup.start();
  const controller = await setup.connect(wsUrl);
  await controller.waitFor((message) => message.type === 'state');
  controller.send({ type: 'patch', id: 'last-edit', patch: { modules: { logo: { title: '退出前的最后修改', visible: false } } } });
  await controller.waitFor((message) => message.type === 'state' && message.settings.modules.logo.title === '退出前的最后修改');
  controller.close();
  await setup.stop(app);
  const persisted = JSON.parse(await readFile(setup.settingsPath, 'utf8'));
  assert.equal(persisted.modules.logo.title, '退出前的最后修改');
  assert.equal(persisted.modules.logo.visible, false);
});

test('invalid patches are rejected atomically and leave saved settings unchanged', async (t) => {
  const setup = await fixture(t);
  const { app, wsUrl } = await setup.start();
  const controller = await setup.connect(wsUrl);
  await controller.waitFor((message) => message.type === 'state');
  const before = structuredClone(app.getState());
  const diskBefore = await readFile(setup.settingsPath, 'utf8');
  const cases = [
    { modules: { logo: { color: '#12ab34', x: 'not-a-number' } } },
    { modules: { logo: { unknownSetting: true } } },
    { modules: { logo: { scale: null } } },
    { modules: { logo: { scale: -1 } } },
    { modules: { logo: { title: 'x'.repeat(1000) } } },
    { modules: { logo: { color: 'red' } } },
    { modules: { logo: { visible: 'yes' } } },
    { modules: { logo: {} } },
    { modules: { hosts: { names: 'y'.repeat(400) } } },
    { modules: { hosts: { accentColor: '#12345' } } },
    { modules: { program: { animation: { enter: 'spin' } } } },
    { modules: { program: { animation: { duration: 50 } } } },
    { modules: { program: { animation: {} } } },
    { modules: { program: { current: 'z'.repeat(200) } } },
    { modules: { nope: { x: 1 } } },
    { modules: { logo: { x: 1 }, hosts: { x: 1 } } },
    { modules: { logo: { x: 1 }, unknown: { x: 1 } } },
    { canvas: { width: 1280 } },
    {},
  ];
  for (const [index, patch] of cases.entries()) {
    const id = `invalid-${index}`;
    controller.send({ type: 'patch', patch, id });
    const error = await controller.waitFor((message) => message.type === 'error' && (!message.id || message.id === id));
    assert.equal(typeof error.message, 'string');
    assert.ok(error.message.length > 0);
    assert.deepEqual(app.getState(), before, `Invalid case ${index} partially changed state`);
  }
  assert.equal(await readFile(setup.settingsPath, 'utf8'), diskBefore);
});

test('static pages and assets are served without exposing configuration or traversal paths', async (t) => {
  const setup = await fixture(t);
  await mkdir(path.join(setup.directory, 'public'));
  await mkdir(path.join(setup.directory, 'assets'));
  await writeFile(path.join(setup.directory, 'public', 'control.html'), '<!doctype html><title>control fixture</title>');
  await writeFile(path.join(setup.directory, 'public', 'overlay.html'), '<!doctype html><title>overlay fixture</title>');
  await writeFile(path.join(setup.directory, 'assets', 'logo.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  await writeFile(path.join(setup.directory, 'secret.txt'), 'private fixture outside the served roots');
  const { url } = await setup.start({ rootDir: setup.directory });

  const control = await fetch(`${url}/control.html`);
  assert.equal(control.status, 200);
  assert.match(control.headers.get('content-type'), /text\/html/);
  assert.match(await control.text(), /control fixture/);
  const overlay = await fetch(`${url}/overlay.html`);
  assert.equal(overlay.status, 200);
  assert.match(await overlay.text(), /overlay fixture/);
  const image = await fetch(`${url}/assets/logo.png`);
  assert.equal(image.status, 200);
  assert.match(image.headers.get('content-type'), /image\/png/);

  for (const route of ['/settings.json', '/secret.txt', '/assets/%2e%2e%2fsecret.txt', '/assets/%2e%2e%5csecret.txt', '/%00']) {
    const response = await fetch(`${url}${route}`);
    assert.notEqual(response.status, 200, `Unexpectedly served ${route}`);
    assert.doesNotMatch(await response.text(), /private fixture outside the served roots|YANZHOU/);
  }
});

test('a corrupt settings file is reported rather than silently overwritten', async (t) => {
  const setup = await fixture(t);
  const original = '{ this is not valid JSON; preserve it for repair';
  await writeFile(setup.settingsPath, original);
  await assert.rejects(setup.start());
  assert.equal(await readFile(setup.settingsPath, 'utf8'), original);
});

test('a version 1 settings file is migrated to the module format in place', async (t) => {
  const setup = await fixture(t);
  const legacy = {
    version: 1,
    canvas: { width: 1920, height: 1080 },
    logo: {
      visible: true,
      title: 'YZBTVS',
      subtitle: '',
      color: '#ffffff',
      textColor: '#ffaa00',
      x: 146,
      y: 98,
      scale: 0.67,
      opacity: 100,
    },
  };
  await writeFile(setup.settingsPath, JSON.stringify(legacy));
  const { app } = await setup.start();

  const state = app.getState();
  assert.equal(state.settings.version, 2);
  assert.equal(state.settings.modules.logo.title, 'YZBTVS');
  assert.equal(state.settings.modules.logo.color, '#FFFFFF');
  assert.equal(state.settings.modules.logo.x, 146);
  assert.deepEqual(state.settings.modules.logo.animation, { enter: 'fade-up', exit: 'fade-down', duration: 600 });
  assert.equal(state.settings.modules.hosts.visible, false);
  assert.equal(state.settings.modules.program.visible, false);
  assert.equal(state.settings.modules.program.current, '节目名称');

  const persisted = JSON.parse(await readFile(setup.settingsPath, 'utf8'));
  assert.equal(persisted.version, 2);
  assert.equal(persisted.modules.logo.title, 'YZBTVS');
  assert.equal(persisted.modules.hosts.label, '主持人');
  assert.equal(persisted.modules.program.label, '正在演出');
});

test('the hosts and program modules sync their content, style and animation to every client', async (t) => {
  const setup = await fixture(t);
  const { wsUrl } = await setup.start();
  const controller = await setup.connect(wsUrl);
  const overlay = await setup.connect(wsUrl);
  await controller.waitFor((message) => message.type === 'state');
  await overlay.waitFor((message) => message.type === 'state');

  controller.send({ type: 'patch', id: 'hosts-1', patch: { modules: { hosts: {
    visible: true,
    label: '主持',
    names: '王一\n李二\n张三',
    accentColor: '#abcdef',
    textColor: '#fefefe',
    x: 120,
    y: 800,
    animation: { enter: 'slide-left', exit: 'fade', duration: 450 },
  } } } });

  const hostsState = await controller.waitFor((message) => message.type === 'state' && message.settings.modules.hosts.label === '主持');
  const hostsOverlay = await overlay.waitFor((message) => message.type === 'state' && message.settings.modules.hosts.label === '主持');
  assert.deepEqual(hostsOverlay.settings.modules.hosts, hostsState.settings.modules.hosts);
  assert.equal(hostsState.settings.modules.hosts.names, '王一\n李二\n张三');
  assert.equal(hostsState.settings.modules.hosts.accentColor, '#ABCDEF');
  assert.deepEqual(hostsState.settings.modules.hosts.animation, { enter: 'slide-left', exit: 'fade', duration: 450 });

  controller.send({ type: 'patch', id: 'program-1', patch: { modules: { program: {
    visible: true, current: '开场舞', next: '合唱', nextLabel: '接下来', x: 1320, y: 820,
  } } } });
  const programState = await controller.waitFor((message) => message.type === 'state' && message.settings.modules.program.current === '开场舞');
  const programOverlay = await overlay.waitFor((message) => message.type === 'state' && message.settings.modules.program.current === '开场舞');
  assert.deepEqual(programOverlay.settings.modules.program, programState.settings.modules.program);
  assert.equal(programState.settings.modules.program.next, '合唱');
  assert.ok(programState.revision > hostsState.revision);

  await controller.waitFor((message) => message.type === 'saved' && message.revision >= programState.revision);
  const persisted = JSON.parse(await readFile(setup.settingsPath, 'utf8'));
  assert.deepEqual(persisted, programState.settings);
});

test('settings with unknown modules or incomplete module data are rejected without overwriting', async (t) => {
  const setup = await fixture(t);
  const original = JSON.stringify({
    version: 2,
    canvas: { width: 1920, height: 1080 },
    modules: {
      logo: {
        visible: true, title: 'x', subtitle: '', color: '#FFFFFF', textColor: '#FFFFFF',
        x: 0, y: 0, scale: 1, opacity: 100,
        animation: { enter: 'fade', exit: 'fade', duration: 600 },
      },
      ghosts: {},
    },
  }, null, 2);
  await writeFile(setup.settingsPath, original);
  await assert.rejects(setup.start());
  assert.equal(await readFile(setup.settingsPath, 'utf8'), original);

  const missingAnimation = JSON.stringify({
    version: 2,
    canvas: { width: 1920, height: 1080 },
    modules: {
      logo: {
        visible: true, title: 'x', subtitle: '', color: '#FFFFFF', textColor: '#FFFFFF',
        x: 0, y: 0, scale: 1, opacity: 100,
      },
    },
  }, null, 2);
  await writeFile(setup.settingsPath, missingAnimation);
  await assert.rejects(setup.start());
  assert.equal(await readFile(setup.settingsPath, 'utf8'), missingAnimation);
});

const demoDoc = [
  { start: 0, text: '开场', tokens: [{ start: 0, text: '开' }, { start: 750, text: '场' }], credit: false },
  { start: 3000, text: '下一句', tokens: [], credit: false },
  { start: 12000, text: '最后一句', tokens: [], credit: false },
];

function lyricCommand(client, type, payload, id = type) {
  client.send({ type, payload, id });
  return client.waitFor((message) => message.id === id);
}

test('LRC preview accepts mixed scripts and timestamps while reporting bad rows', () => {
  const entries = parseLrc('\uFEFF[ti:彩排]\r\n[00:00]编曲：测试\n错误行\n[00:01.20]<00:01.200>烟洲 <00:02.000>live again\n[00:03.50]普通歌词\n[00:03.50]重复\n[00:04.00]<00:03.00>逆序');
  assert.equal(entries[1].number, 3);
  assert.match(entries[1].error, /行时间戳/);
  assert.match(entries.at(-1).error, /顺序/);
  const { doc, errors } = buildLyricDocument(entries);
  assert.equal(doc.length, 3);
  assert.equal(errors.length, 1);
  assert.equal(doc[0].credit, true);
  assert.deepEqual(doc[1].tokens.filter((token) => token.text.trim()).map((token) => token.text), ['烟', '洲', 'live', 'again']);
  assert.equal(doc[2].tokens.length, 0);
  assert.equal(timelineIndex(doc, 1200), 1);
  assert.equal(timelineIndex(doc, 4300), doc.length);
  const overlaps = buildLyricDocument(parseLrc('[00:01]<00:02.50>越界\n[00:01]重复\n[00:02]有效'));
  assert.deepEqual(overlaps.doc.map((line) => line.text), ['有效']);
  assert.equal(overlaps.errors.length, 2);
  entries[2].skip = true;
  assert.equal(buildLyricDocument(entries).doc.some((line) => line.start === 1200), false);
});

test('lyrics load enforces the exact UTF-8 document boundary and retains prior data on error', async (t) => {
  const setup = await fixture(t);
  const { wsUrl, app } = await setup.start();
  const client = await setup.connect(wsUrl);
  const observer = await setup.connect(wsUrl);
  const doc = [];
  let size = jsonBytes(doc);
  for (let index = 0; size < LYRIC_BYTES; index += 1) {
    const line = { start: index * 1000, text: '', tokens: [], credit: false };
    const overhead = jsonBytes(line) + Number(index > 0);
    const length = Math.min(500, LYRIC_BYTES - size - overhead);
    if (length < 1) {
      doc.at(-1).text += 'x'.repeat(LYRIC_BYTES - size);
      break;
    }
    line.text = '字'.repeat(Math.floor(length / 3)) + 'x'.repeat(length % 3);
    doc.push(line);
    size += overhead + length;
  }
  assert.equal(jsonBytes(doc), LYRIC_BYTES);
  const accepted = await lyricCommand(client, 'lyrics:load', { doc }, 'load-boundary');
  assert.equal(accepted.type, 'lyrics:state');
  assert.deepEqual((await observer.waitFor((message) => message.id === accepted.id)).doc, doc);
  doc.at(-1).text += 'x';
  const rejected = await lyricCommand(client, 'lyrics:load', { doc }, 'load-over');
  assert.equal(rejected.type, 'error');
  assert.match(rejected.message, /200 KiB/);
  assert.equal(jsonBytes(app.getState().settings.modules.lyrics.doc), LYRIC_BYTES);
});

test('timeline transport progresses independently of the selected output and sends lightweight deltas', async (t) => {
  const setup = await fixture(t);
  const { wsUrl } = await setup.start();
  const client = await setup.connect(wsUrl);
  const send = (type, payload) => lyricCommand(client, `lyrics:${type}`, payload);
  await send('load', { doc: demoDoc });
  await send('onair', { source: 'timeline' });
  await send('transport', { action: 'seek', value: 3000 });
  const rate = await send('transport', { action: 'rate', value: 1.1 });
  assert.deepEqual(rate.transport, { position: 3000, rate: 1.1, playing: false, end: 12800 });
  assert.equal(Object.hasOwn(rate, 'doc'), false);
  const play = await send('transport', { action: 'play', value: null });
  assert.equal(play.transport.playing, true);
  const manual = await send('onair', { source: 'manual' });
  assert.equal(manual.source, 'manual');
  assert.equal(manual.transport.playing, true);
  const paused = await send('transport', { action: 'pause', value: null });
  assert.equal(paused.transport.playing, false);
  const nudged = await send('transport', { action: 'nudge', value: -500 });
  assert.equal(nudged.transport.position, paused.transport.position - 500);
});

test('only a supported source is armed and a rejected payload does not change state', async (t) => {
  const setup = await fixture(t);
  const { app, wsUrl } = await setup.start();
  const client = await setup.connect(wsUrl);
  const initial = await client.waitFor((message) => message.type === 'lyrics:state');
  assert.equal(initial.armed, false);
  const pushed = await lyricCommand(client, 'lyrics:onair', { source: 'manual' });
  assert.equal(pushed.armed, true);
  assert.equal(pushed.source, 'manual');
  const state = app.getState();
  assert.equal((await lyricCommand(client, 'lyrics:onair', { source: 'asr' })).type, 'error');
  assert.equal((await lyricCommand(client, 'lyrics:transport', { action: 'rate', value: 1.03 })).type, 'error');
  assert.equal((await lyricCommand(client, 'lyrics:load', { doc: [demoDoc[1], demoDoc[0]] })).type, 'error');
  assert.equal((await lyricCommand(client, 'lyrics:load', { doc: [] })).type, 'error');
  assert.equal((await lyricCommand(client, 'lyrics:manual', { action: 'select', value: -1 })).type, 'error');
  assert.deepEqual(app.getState(), state);
});

test('manual confirmation, stepping, and clear produce complete display states', async (t) => {
  const setup = await fixture(t);
  const { wsUrl } = await setup.start();
  const client = await setup.connect(wsUrl);
  const manual = (action, value = null) => lyricCommand(client, 'lyrics:manual', { action, value });
  const loaded = await manual('load', ['第一句', '第二句']);
  assert.equal(loaded.manual.current, '第一句');
  assert.equal(loaded.manual.next, '第二句');
  const edited = await manual('commit', '<b>改字</b>');
  assert.equal(edited.manual.current, '<b>改字</b>');
  assert.equal(edited.manual.next, '第二句');
  assert.equal(Object.hasOwn(edited.manual, 'lines'), false);
  assert.equal((await manual('step', 1)).manual.current, '第二句');
  const cleared = await manual('clear');
  assert.deepEqual(cleared.manual, { current: '', next: '', index: null, autoSeconds: 0, remaining: null });
});

test('manual auto timer stays independent of source and stops at the last line', async (t) => {
  const setup = await fixture(t);
  const { wsUrl } = await setup.start();
  const client = await setup.connect(wsUrl);
  await lyricCommand(client, 'lyrics:manual', { action: 'load', value: ['one', 'two'] });
  const scheduled = await lyricCommand(client, 'lyrics:manual', { action: 'auto', value: 5 });
  assert.ok(scheduled.manual.remaining > 4900);
  await lyricCommand(client, 'lyrics:onair', { source: 'timeline' });
  const result = await client.waitFor((message) => message.type === 'lyrics:state' && message.manual.current === 'two', 6500);
  assert.equal(result.source, 'timeline');
  assert.equal(result.manual.remaining, null);
  assert.equal(result.manual.next, '');
});

test('reconnect gets full state and restart keeps the paused checkpoint disarmed', async (t) => {
  const setup = await fixture(t);
  const first = await setup.start();
  const client = await setup.connect(first.wsUrl);
  await lyricCommand(client, 'lyrics:load', { doc: demoDoc });
  await lyricCommand(client, 'lyrics:manual', { action: 'load', value: ['手动', '下一句'] });
  await lyricCommand(client, 'lyrics:manual', { action: 'commit', value: '已确认' });
  await lyricCommand(client, 'lyrics:transport', { action: 'seek', value: 3000 });
  await lyricCommand(client, 'lyrics:onair', { source: 'timeline' });
  await lyricCommand(client, 'lyrics:transport', { action: 'play', value: null });
  client.close();
  const reconnected = await setup.connect(first.wsUrl);
  const live = await reconnected.waitFor((message) => message.type === 'lyrics:state');
  assert.equal(live.armed, true);
  assert.equal(live.transport.playing, true);
  assert.deepEqual(live.doc, demoDoc);
  assert.deepEqual(live.manual.lines, ['手动', '下一句']);
  const clock = createLyricsClock();
  clock.apply(live);
  assert.equal(clock.position(performance.now() + 60000), live.transport.end);
  await setup.stop(first.app);
  const next = await setup.start();
  const nextClient = await setup.connect(next.wsUrl);
  const restarted = await nextClient.waitFor((message) => message.type === 'lyrics:state');
  assert.equal(restarted.armed, false);
  assert.equal(restarted.source, 'timeline');
  assert.equal(restarted.transport.playing, false);
  assert.ok(restarted.transport.position >= live.transport.position);
  assert.equal(restarted.manual.current, '已确认');
  assert.deepEqual(restarted.doc, demoDoc);
});

test('v2 settings get a backup before lyrics migration and malformed lyrics preserve the file', async (t) => {
  const setup = await fixture(t);
  const original = await readFile(path.join(projectRoot, 'settings.json'), 'utf8');
  await writeFile(setup.settingsPath, original);
  const { app } = await setup.start();
  const migrated = JSON.parse(await readFile(setup.settingsPath, 'utf8'));
  assert.equal(await readFile(`${setup.settingsPath}.pre-lyrics.bak`, 'utf8'), original);
  assert.deepEqual(migrated.modules.lyrics.doc, []);
  for (const id of ['logo', 'hosts', 'program']) assert.deepEqual(migrated.modules[id], JSON.parse(original).modules[id]);
  await setup.stop(app);
  migrated.modules.lyrics.transport.rate = 2;
  const corrupt = JSON.stringify(migrated);
  await writeFile(setup.settingsPath, corrupt);
  await assert.rejects(setup.start(), /速率/);
  assert.equal(await readFile(setup.settingsPath, 'utf8'), corrupt);
});
