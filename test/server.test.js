import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createPackagingServer, DEFAULT_SETTINGS } from '../server/server.js';
import { buildLyricDocument, jsonBytes, LYRIC_BYTES, parseLrc, timelineIndex } from '../public/lyrics-model.js';
import { createLyricsClock } from '../public/lyrics-clock.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Register the message listener before opening completes: the server sends its
// initial state immediately, and that message must remain available to tests.
function openClient(url, options) {
  const socket = new WebSocket(url, options);
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
    async connect(wsUrl, options) {
      const client = openClient(wsUrl, options);
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
  assert.equal(initial.settings.version, 5);
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
    { modules: { logo: { showMark: 'yes' } } },
    { modules: { logo: { weight: 100 } } },
    { modules: { logo: { weight: 'bold' } } },
    { modules: { hosts: { slotCount: 0 } } },
    { modules: { hosts: { slotCount: 5 } } },
    { modules: { logo: {} } },
    { modules: { hosts: { names: 'y'.repeat(400) } } },
    { modules: { hosts: { accentColor: '#12345' } } },
    { modules: { program: { animation: { enter: 'spin' } } } },
    { modules: { program: { animation: { duration: 50 } } } },
    { modules: { program: { animation: {} } } },
    { modules: { program: { current: 'z'.repeat(200) } } },
    { modules: { program: { queue: '长'.repeat(81) } } },
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
  assert.equal(state.settings.version, 5);
  assert.equal(state.settings.modules.logo.title, 'YZBTVS');
  assert.equal(state.settings.modules.logo.color, '#FFFFFF');
  assert.equal(state.settings.modules.logo.x, 146);
  assert.equal(state.settings.modules.logo.showMark, true);
  assert.equal(state.settings.modules.logo.weight, 500);
  assert.deepEqual(state.settings.modules.logo.animation, { enter: 'fade-up', exit: 'fade-down', duration: 600 });
  assert.equal(state.settings.modules.hosts.visible, false);
  assert.equal(state.settings.modules.program.visible, false);
  assert.equal(state.settings.modules.program.current, DEFAULT_SETTINGS.modules.program.current);

  const persisted = JSON.parse(await readFile(setup.settingsPath, 'utf8'));
  assert.equal(persisted.version, 5);
  assert.equal(persisted.modules.logo.title, 'YZBTVS');
  assert.equal(persisted.modules.logo.showMark, true);
  assert.equal(persisted.modules.logo.weight, 500);
  assert.equal(persisted.modules.hosts.label, '主持人');
  assert.equal(persisted.modules.program.label, '正在演出');
});

test('a version 2 settings file gains the logo mark and weight flags and keeps every other value', async (t) => {
  const setup = await fixture(t);
  const v2 = {
    version: 2,
    canvas: { width: 1920, height: 1080 },
    modules: {
      logo: {
        visible: true, showMark: undefined, title: 'YZBTVS', subtitle: '',
        color: '#FFFFFF', textColor: '#FFAA00', x: 146, y: 98, scale: 0.67, opacity: 100,
        animation: { enter: 'fade-up', exit: 'fade-down', duration: 600 },
      },
      hosts: {
        visible: true, label: '主持', names: '张三', accentColor: '#D4AB78', textColor: '#F4F0E8',
        x: 96, y: 912, scale: 1, opacity: 100,
        animation: { enter: 'fade-up', exit: 'fade-down', duration: 600 },
      },
      program: {
        visible: false, label: '正在演出', current: '节目名称', nextLabel: '接下来', next: '下一个节目',
        accentColor: '#D4AB78', textColor: '#F4F0E8', x: 1376, y: 912, scale: 1, opacity: 100,
        animation: { enter: 'fade-up', exit: 'fade-down', duration: 600 },
      },
    },
  };
  delete v2.modules.logo.showMark;
  await writeFile(setup.settingsPath, JSON.stringify(v2));
  const { wsUrl } = await setup.start();
  const controller = await setup.connect(wsUrl);
  const initial = await controller.waitFor((message) => message.type === 'state');

  assert.equal(initial.settings.version, 5);
  assert.equal(initial.settings.modules.logo.showMark, true);
  assert.equal(initial.settings.modules.logo.weight, 500);
  assert.equal(initial.settings.modules.hosts.slotCount, 2);
  assert.equal(initial.settings.modules.logo.title, 'YZBTVS');
  assert.equal(initial.settings.modules.hosts.names, '张三');

  controller.send({ type: 'patch', id: 'hide-mark', patch: { modules: { logo: { showMark: false } } } });
  const hidden = await controller.waitFor((message) => message.type === 'state' && message.settings.modules.logo.showMark === false);
  await controller.waitFor((message) => message.type === 'saved' && message.revision >= hidden.revision);
  const persisted = JSON.parse(await readFile(setup.settingsPath, 'utf8'));
  assert.equal(persisted.version, 5);
  assert.equal(persisted.modules.logo.showMark, false);
  assert.equal(persisted.modules.logo.title, 'YZBTVS');
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
  assert.equal(accepted.manual.lines, null);
  assert.deepEqual((await observer.waitFor((message) => message.id === accepted.id)).doc, doc);
  doc.at(-1).text += 'x';
  const rejected = await lyricCommand(client, 'lyrics:load', { doc }, 'load-over');
  assert.equal(rejected.type, 'error');
  assert.match(rejected.message, /200 KiB/);
  assert.equal(jsonBytes(app.getState().settings.modules.lyrics.doc), LYRIC_BYTES);
});

test('one LRC load shares all lines with manual and preserves the committed on-air sentence', async (t) => {
  const setup = await fixture(t);
  const first = await setup.start();
  const client = await setup.connect(first.wsUrl);
  await lyricCommand(client, 'lyrics:manual', { action: 'load', value: ['旧歌', '旧歌下一句'] });
  await lyricCommand(client, 'lyrics:manual', { action: 'auto', value: 5 });
  await lyricCommand(client, 'lyrics:onair', { source: 'manual' });
  const loaded = await lyricCommand(client, 'lyrics:load', { doc: demoDoc });
  assert.deepEqual(loaded.doc, demoDoc);
  assert.equal(loaded.manual.lines, null);
  assert.equal(loaded.manual.current, '旧歌');
  assert.equal(loaded.manual.index, null);
  assert.equal(loaded.manual.remaining, null);
  assert.equal(loaded.source, 'manual');
  const clock = createLyricsClock();
  clock.apply(loaded);
  assert.deepEqual(clock.lines, demoDoc.map((line) => line.text));

  const stepped = await lyricCommand(client, 'lyrics:manual', { action: 'step', value: 1 });
  assert.equal(stepped.manual.current, demoDoc[0].text);
  assert.equal(stepped.manual.next, demoDoc[1].text);
  await setup.stop(first.app);
  const restarted = await setup.start();
  const reconnect = await setup.connect(restarted.wsUrl);
  const state = await reconnect.waitFor((message) => message.type === 'lyrics:state');
  clock.apply(state);
  assert.equal(state.armed, true);
  assert.equal(state.source, 'manual');
  assert.deepEqual(clock.lines, demoDoc.map((line) => line.text));
  assert.equal(state.manual.index, 0);
});

test('an existing timeline-only import is available in manual without importing again', async (t) => {
  const setup = await fixture(t);
  const first = await setup.start();
  const settings = first.app.getState().settings;
  await setup.stop(first.app);
  settings.modules.lyrics.doc = demoDoc;
  await writeFile(setup.settingsPath, JSON.stringify(settings));

  const { wsUrl } = await setup.start();
  const client = await setup.connect(wsUrl);
  const initial = await client.waitFor((message) => message.type === 'lyrics:state');
  const catalog = await client.waitFor((message) => message.type === 'lyrics:songs');
  const clock = createLyricsClock();
  clock.apply(initial);
  assert.deepEqual(clock.lines, demoDoc.map((line) => line.text));
  assert.equal(catalog.songs.length, 1);
  const config = path.join(setup.directory, 'config', 'lyrics');
  assert.deepEqual(await readdir(config), [`${catalog.activeId}.json`]);
  const persisted = JSON.parse(await readFile(setup.settingsPath, 'utf8'));
  assert.deepEqual(persisted.modules.lyrics.doc, []);
  const backup = JSON.parse(await readFile(`${setup.settingsPath}.pre-library.bak`, 'utf8'));
  assert.deepEqual(backup.modules.lyrics.doc, demoDoc);
  const selected = await lyricCommand(client, 'lyrics:manual', { action: 'select', value: 1 });
  assert.equal(selected.manual.current, demoDoc[1].text);
});

test('song files survive restart, same titles coexist, and explicit replacement keeps the other version', async (t) => {
  const setup = await fixture(t);
  const first = await setup.start();
  const client = await setup.connect(first.wsUrl);
  const catalog = () => client.waitFor((message) => message.type === 'lyrics:songs');
  await catalog();
  const alternate = [{ start: 100, text: '另一版', tokens: [], credit: false }];
  const saveKey = '1'.repeat(32);
  await lyricCommand(client, 'lyrics:load', { title: '校园彩排', doc: demoDoc, saveKey }, 'save-first');
  const firstSong = await catalog();
  await lyricCommand(client, 'lyrics:load', { title: '校园彩排', doc: demoDoc, saveKey }, 'retry-first');
  assert.deepEqual(await catalog(), firstSong);

  await lyricCommand(client, 'lyrics:load', { title: '校园彩排', doc: alternate }, 'save-second');
  const secondSong = await catalog();
  assert.equal(secondSong.songs.length, 2);
  assert.notEqual(secondSong.activeId, firstSong.activeId);
  const config = path.join(setup.directory, 'config', 'lyrics');
  const file = (id) => path.join(config, `${id}.json`);
  assert.deepEqual(JSON.parse(await readFile(file(firstSong.activeId), 'utf8')).doc, demoDoc);

  await lyricCommand(client, 'lyrics:load', {
    title: '校园彩排', doc: alternate, replaceId: firstSong.activeId,
  }, 'replace-first');
  const replaced = await catalog();
  assert.equal(replaced.songs.length, 2);
  assert.equal(replaced.activeId, firstSong.activeId);
  assert.deepEqual(JSON.parse(await readFile(file(secondSong.activeId), 'utf8')).doc, alternate);
  await setup.stop(first.app);

  const after = await setup.start();
  const fresh = await setup.connect(after.wsUrl);
  const savedCatalog = await fresh.waitFor((message) => message.type === 'lyrics:songs');
  assert.equal(savedCatalog.activeId, firstSong.activeId);
  assert.equal(savedCatalog.songs.length, 2);
  const initial = await fresh.waitFor((message) => message.type === 'lyrics:state');
  assert.deepEqual(initial.doc, alternate);
  const loaded = await lyricCommand(fresh, 'lyrics:select-song', { id: secondSong.activeId });
  assert.deepEqual(loaded.doc, alternate);
  assert.deepEqual(loaded.transport, { position: 0, rate: 1, playing: false, end: 900 });
  assert.equal((await lyricCommand(fresh, 'lyrics:select-song', { id: '../bad' })).type, 'error');
  assert.equal(after.app.getState().settings.modules.lyrics.song.id, secondSong.activeId);
});

test('moving a song persists the order without interrupting the current lyrics', async (t) => {
  const setup = await fixture(t);
  const first = await setup.start();
  const client = await setup.connect(first.wsUrl);
  const catalog = () => client.waitFor((message) => message.type === 'lyrics:songs');
  await catalog();
  await lyricCommand(client, 'lyrics:load', { title: '下一首', artist: '歌手甲', doc: demoDoc });
  const { activeId: nextId } = await catalog();
  await lyricCommand(client, 'lyrics:load', { title: '当前歌曲', doc: demoDoc });
  const { activeId } = await catalog();
  await lyricCommand(client, 'lyrics:transport', { action: 'seek', value: demoDoc[0].start });

  const moved = await lyricCommand(client, 'lyrics:move-song', { id: nextId, direction: 1 });
  assert.equal(moved.songId, activeId);
  assert.equal(moved.transport.position, demoDoc[0].start);
  const ordered = await catalog();
  assert.deepEqual(ordered.songs.map(({ id }) => id), [activeId, nextId]);
  assert.equal(ordered.songs[1].artist, '歌手甲');
  const preview = await fetch(`${first.url}/api/lyrics/song?id=${nextId}`);
  assert.equal(preview.status, 200);
  assert.deepEqual(await preview.json(), demoDoc.map(({ text }) => text));
  await setup.stop(first.app);

  const after = await setup.start();
  const fresh = await setup.connect(after.wsUrl);
  assert.deepEqual(await fresh.waitFor((message) => message.type === 'lyrics:songs'), ordered);
});

test('a failed song write does not replace the current timeline', async (t) => {
  const setup = await fixture(t);
  const { app, wsUrl } = await setup.start();
  const client = await setup.connect(wsUrl);
  await writeFile(path.join(setup.directory, 'config'), 'cannot create a lyrics folder here');
  const initial = app.getState();
  const result = await lyricCommand(client, 'lyrics:load', { title: '未能写入', doc: demoDoc });
  assert.equal(result.type, 'error');
  assert.deepEqual(app.getState(), initial);
});

test('reopening a replaced active song discards a checkpoint from the previous version', async (t) => {
  const setup = await fixture(t);
  const first = await setup.start();
  const client = await setup.connect(first.wsUrl);
  await lyricCommand(client, 'lyrics:load', { title: '彩排曲', doc: demoDoc });
  await lyricCommand(client, 'lyrics:transport', { action: 'seek', value: 12000 });
  const { id } = first.app.getState().settings.modules.lyrics.song;
  await setup.stop(first.app);

  const file = path.join(setup.directory, 'config', 'lyrics', `${id}.json`);
  const song = JSON.parse(await readFile(file, 'utf8'));
  song.doc = [{ start: 0, text: '短版', tokens: [], credit: false }];
  await writeFile(file, JSON.stringify(song));
  const { wsUrl } = await setup.start();
  const fresh = await setup.connect(wsUrl);
  const state = await fresh.waitFor((message) => message.type === 'lyrics:state');
  assert.equal(state.transport.position, 0);
  assert.equal(state.manual.index, null);
  assert.deepEqual(state.doc, song.doc);
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
  const stopped = await lyricCommand(client, 'lyrics:onair', { source: null });
  assert.equal(stopped.armed, false);
  assert.deepEqual(stopped.manual, pushed.manual);
});

test('recognition capture is same-origin and missing models preserve existing playout', async (t) => {
  const setup = await fixture(t);
  const { url, wsUrl } = await setup.start({ asrModelRoot: setup.directory });
  const client = await setup.connect(wsUrl);
  const initial = await client.waitFor((message) => message.type === 'lyrics:asr');
  assert.deepEqual(initial.available, { bilingual: false, trilingual: false });
  const audio = wsUrl.replace('/ws', '/asr?mode=bilingual');
  await assert.rejects(setup.connect(audio, { origin: 'https://other.invalid' }), /403/);
  await assert.rejects(setup.connect(audio), /403/);
  const capture = await setup.connect(audio, { origin: url });
  const failed = await capture.waitFor((message) => message.type === 'error');
  assert.match(failed.message, /模型未安装/);
  const manual = await lyricCommand(client, 'lyrics:onair', { source: 'manual' });
  assert.equal(manual.source, 'manual');
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

test('reconnect gets full state and restart restores the paused checkpoint push', async (t) => {
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
  assert.equal(restarted.armed, true);
  assert.equal(restarted.source, 'timeline');
  assert.equal(restarted.transport.playing, false);
  assert.ok(restarted.transport.position >= live.transport.position);
  assert.equal(restarted.manual.current, '已确认');
  assert.deepEqual(restarted.doc, demoDoc);
});

test('stopping the push survives a restart and an asr push never auto-restores', async (t) => {
  const setup = await fixture(t);
  const first = await setup.start();
  const client = await setup.connect(first.wsUrl);
  await lyricCommand(client, 'lyrics:onair', { source: 'manual' });
  const stopped = await lyricCommand(client, 'lyrics:onair', { source: null });
  assert.equal(stopped.armed, false);
  await setup.stop(first.app);
  const restarted = await setup.start();
  const reconnect = await setup.connect(restarted.wsUrl);
  const idle = await reconnect.waitFor((message) => message.type === 'lyrics:state');
  assert.equal(idle.armed, false, 'a stopped push stays stopped after a restart');
  assert.equal(idle.source, 'manual');
});

test('settings without a lyrics module get a backup before lyrics migration and malformed lyrics preserve the file', async (t) => {
  const setup = await fixture(t);
  const base = structuredClone(DEFAULT_SETTINGS);
  delete base.modules.lyrics;
  const original = JSON.stringify(base, null, 2);
  await writeFile(setup.settingsPath, original);
  const { app } = await setup.start();
  const migrated = JSON.parse(await readFile(setup.settingsPath, 'utf8'));
  assert.equal(await readFile(`${setup.settingsPath}.pre-lyrics.bak`, 'utf8'), original);
  assert.deepEqual(migrated.modules.lyrics.doc, []);
  for (const id of ['logo', 'hosts', 'program']) assert.deepEqual(migrated.modules[id], base.modules[id]);
  await setup.stop(app);
  migrated.modules.lyrics.transport.rate = 2;
  const corrupt = JSON.stringify(migrated);
  await writeFile(setup.settingsPath, corrupt);
  await assert.rejects(setup.start(), /速率/);
  assert.equal(await readFile(setup.settingsPath, 'utf8'), corrupt);
});

test('a settings file whose song is missing from the library starts with no song and reports the skip', async (t) => {
  const setup = await fixture(t);
  const first = await setup.start();
  const client = await setup.connect(first.wsUrl);
  await client.waitFor((message) => message.type === 'lyrics:songs');
  await lyricCommand(client, 'lyrics:load', { title: '缺失测试', doc: demoDoc }, 'save-missing');
  const saved = await client.waitFor((message) => message.type === 'lyrics:songs' && message.activeId);
  assert.equal(saved.skipped, undefined);
  await setup.stop(first.app);
  const config = path.join(setup.directory, 'config', 'lyrics');
  await unlink(path.join(config, `${saved.activeId}.json`));
  await rmdir(config);
  const before = await readFile(setup.settingsPath, 'utf8');

  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  let after;
  try {
    after = await setup.start();
  } finally {
    console.warn = warn;
  }
  assert.ok(warnings.some((line) => line.includes('[提示]') && line.includes(saved.activeId)));
  const lyrics = after.app.getState().settings.modules.lyrics;
  assert.equal(lyrics.song, undefined);
  assert.deepEqual(lyrics.doc, []);
  assert.equal(lyrics.x, DEFAULT_SETTINGS.modules.lyrics.x);
  assert.equal(await readFile(setup.settingsPath, 'utf8'), before, 'startup does not rewrite settings.json');

  const fresh = await setup.connect(after.wsUrl);
  const catalog = await fresh.waitFor((message) => message.type === 'lyrics:songs');
  assert.equal(catalog.activeId, null);
  assert.equal(catalog.skipped.id, saved.activeId);
  assert.match(catalog.skipped.message, /已跳过/u);

  await lyricCommand(fresh, 'lyrics:load', { title: '重新导入', doc: demoDoc }, 'reimport');
  const reloaded = await fresh.waitFor((message) => message.type === 'lyrics:songs' && message.activeId);
  assert.equal(reloaded.skipped, undefined);
  assert.equal(reloaded.songs.length, 1);
});

test('the hosts caption style defaults for older files, syncs to every client, and rejects unknown values', async (t) => {
  const setup = await fixture(t);
  const legacy = structuredClone(DEFAULT_SETTINGS);
  delete legacy.modules.hosts.style;
  delete legacy.modules.hosts.customColors;
  await writeFile(setup.settingsPath, JSON.stringify(legacy));
  const before = await readFile(setup.settingsPath, 'utf8');
  const first = await setup.start();
  const controller = await setup.connect(first.wsUrl);
  const overlay = await setup.connect(first.wsUrl);
  const initial = await controller.waitFor((message) => message.type === 'state');
  assert.equal(initial.settings.modules.hosts.style, 'h');
  assert.equal(initial.settings.modules.hosts.customColors, false);
  assert.equal(await readFile(setup.settingsPath, 'utf8'), before, 'a missing style does not rewrite the file');

  controller.send({ type: 'patch', id: 'style-g', patch: { modules: { hosts: { style: 'g', customColors: true } } } });
  const synced = await overlay.waitFor((message) => message.type === 'state' && message.settings.modules.hosts.style === 'g');
  assert.equal(synced.settings.modules.hosts.customColors, true);
  assert.equal(synced.settings.modules.hosts.label, legacy.modules.hosts.label);

  for (const style of ['neon', 'gala']) {
    controller.send({ type: 'patch', id: `style-${style}`, patch: { modules: { hosts: { style } } } });
    assert.equal((await controller.waitFor((message) => message.id === `style-${style}`)).type, 'error');
  }
  await controller.waitFor((message) => message.type === 'saved');
  assert.equal(JSON.parse(await readFile(setup.settingsPath, 'utf8')).modules.hosts.style, 'g');
  await setup.stop(first.app);

  const older = JSON.parse(await readFile(setup.settingsPath, 'utf8'));
  older.modules.hosts.style = 'yanzhou';
  await writeFile(setup.settingsPath, JSON.stringify(older));
  const second = await setup.start();
  assert.equal(second.app.getState().settings.modules.hosts.style, 'h', 'a v7 style name falls back to the first style');
});
test('a program card style saved by the v10 preview is ignored without rewriting the file, and is no longer accepted', async (t) => {
  const setup = await fixture(t);
  for (const cardStyle of ['ticket', 'classic']) {
    const legacy = structuredClone(DEFAULT_SETTINGS);
    legacy.modules.program.cardStyle = cardStyle;
    const before = JSON.stringify(legacy, null, 2) + '\n';
    await writeFile(setup.settingsPath, before);
    const app = await setup.start();
    const client = await setup.connect(app.wsUrl);
    const initial = await client.waitFor((message) => message.type === 'state');
    assert.equal(Object.hasOwn(initial.settings.modules.program, 'cardStyle'), false);
    assert.equal(await readFile(setup.settingsPath, 'utf8'), before, `a stored cardStyle "${cardStyle}" does not rewrite the file`);
    client.send({ type: 'patch', id: 'card-style', patch: { modules: { program: { cardStyle: 'ticket' } } } });
    assert.equal((await client.waitFor((message) => message.id === 'card-style')).type, 'error');
    await setup.stop(app.app);
  }
});

test('the show order follows when modules go on screen and is broadcast but never written to disk', async (t) => {
  const setup = await fixture(t);
  const base = structuredClone(DEFAULT_SETTINGS);
  base.modules.hosts.visible = false;
  base.modules.program.visible = false;
  await writeFile(setup.settingsPath, JSON.stringify(base));
  const first = await setup.start();
  const controller = await setup.connect(first.wsUrl);
  const overlay = await setup.connect(first.wsUrl);
  const initial = await controller.waitFor((message) => message.type === 'state');
  await overlay.waitFor((message) => message.type === 'state');
  assert.deepEqual(initial.stage.showOrder, ['logo', 'lyrics']);

  const patch = async (id, modules) => {
    controller.send({ type: 'patch', id, patch: { modules } });
    return overlay.waitFor((message) => message.type === 'state' && message.id === id);
  };
  assert.deepEqual((await patch('show-program', { program: { visible: true } })).stage.showOrder, ['logo', 'lyrics', 'program']);
  assert.deepEqual((await patch('show-hosts', { hosts: { visible: true } })).stage.showOrder, ['logo', 'lyrics', 'program', 'hosts']);
  assert.deepEqual((await patch('move-program', { program: { x: 300 } })).stage.showOrder, ['logo', 'lyrics', 'program', 'hosts'], 'moving is not appearing');
  assert.deepEqual((await patch('hide-program', { program: { visible: false } })).stage.showOrder, ['logo', 'lyrics', 'hosts']);
  assert.deepEqual((await patch('reshow-program', { program: { visible: true } })).stage.showOrder, ['logo', 'lyrics', 'hosts', 'program']);

  // A host caption slot that comes on screen counts as the host captions appearing again.
  controller.send({ type: 'hosts:manage', id: 'slot-off', payload: { action: 'slot', index: 1, patch: { hidden: true } } });
  const slotOff = await overlay.waitFor((message) => message.type === 'state' && message.id === 'slot-off');
  assert.deepEqual(slotOff.stage.showOrder, ['logo', 'lyrics', 'hosts', 'program'], 'hiding one caption keeps the order');
  controller.send({ type: 'hosts:manage', id: 'slot-on', payload: { action: 'slot', index: 1, patch: { hidden: false } } });
  const slotState = await overlay.waitFor((message) => message.type === 'state' && message.id === 'slot-on');
  assert.deepEqual(slotState.stage.showOrder, ['logo', 'lyrics', 'program', 'hosts']);

  await controller.waitFor((message) => message.type === 'saved' && message.revision >= slotState.revision);
  const persisted = JSON.parse(await readFile(setup.settingsPath, 'utf8'));
  assert.equal(Object.hasOwn(persisted, 'stage'), false);
  assert.equal(Object.hasOwn(persisted, 'showOrder'), false);
});

test('the auto-avoid switch defaults to on for older files, syncs, persists and rejects malformed values', async (t) => {
  const setup = await fixture(t);
  const before = JSON.stringify(DEFAULT_SETTINGS, null, 2) + '\n';
  await writeFile(setup.settingsPath, before);
  const first = await setup.start();
  const controller = await setup.connect(first.wsUrl);
  const overlay = await setup.connect(first.wsUrl);
  const initial = await controller.waitFor((message) => message.type === 'state');
  await overlay.waitFor((message) => message.type === 'state');
  assert.equal(initial.settings.layout, undefined, 'no layout means auto-avoid is on');
  assert.equal(await readFile(setup.settingsPath, 'utf8'), before, 'an older file is not rewritten');

  controller.send({ type: 'patch', id: 'avoid-off', patch: { layout: { autoAvoid: false } } });
  const off = await overlay.waitFor((message) => message.type === 'state' && message.id === 'avoid-off');
  assert.deepEqual(off.settings.layout, { autoAvoid: false });
  await controller.waitFor((message) => message.type === 'saved' && message.revision >= off.revision);
  assert.deepEqual(JSON.parse(await readFile(setup.settingsPath, 'utf8')).layout, { autoAvoid: false });

  for (const [id, patch] of [['bad-type', { layout: { autoAvoid: 'yes' } }], ['bad-key', { layout: { gap: 4 } }], ['mixed', { layout: { autoAvoid: true }, modules: { logo: { x: 1 } } }]]) {
    controller.send({ type: 'patch', id, patch });
    assert.equal((await controller.waitFor((message) => message.id === id)).type, 'error', id);
  }
  await setup.stop(first.app);

  const second = await setup.start();
  assert.deepEqual(second.app.getState().settings.layout, { autoAvoid: false }, 'the switch survives a restart');
  await setup.stop(second.app);
  const broken = JSON.parse(await readFile(setup.settingsPath, 'utf8'));
  broken.layout = { autoAvoid: 1 };
  await writeFile(setup.settingsPath, JSON.stringify(broken));
  await assert.rejects(setup.start());
});

test('management initializes once, backs up old settings, and keeps empty libraries after restart', async (t) => {
  const setup = await fixture(t);
  const old = structuredClone(DEFAULT_SETTINGS);
  delete old.modules.hosts.people;
  delete old.modules.hosts.slots;
  delete old.modules.program.items;
  delete old.modules.program.selectedId;
  await writeFile(setup.settingsPath, JSON.stringify(old));
  const first = await setup.start();
  const snapshot = first.app.getState().settings;
  assert.equal(snapshot.modules.hosts.people.length, 4);
  assert.equal(snapshot.modules.program.items.length, 16);
  assert.equal(snapshot.modules.hosts.visible, false);
  assert.deepEqual(JSON.parse(await readFile(setup.settingsPath + '.pre-management.bak', 'utf8')), old);
  const client = await setup.connect(first.wsUrl);
  await client.waitFor((m) => m.type === 'state');
  for (const kind of ['hosts', 'program']) {
    const key = kind === 'hosts' ? 'people' : 'items';
    for (const item of snapshot.modules[kind][key]) {
      const id = 'delete-' + item.id;
      client.send({ type: kind + ':manage', id, payload: { action: 'delete', id: item.id } });
      await client.waitFor((m) => m.type === 'management:result' && m.id === id);
    }
  }
  await setup.stop(first.app);
  const after = await setup.start();
  assert.deepEqual(after.app.getState().settings.modules.hosts.people, []);
  assert.deepEqual(after.app.getState().settings.modules.program.items, []);
});

test('management keeps independent slots and current program identities across save, delete and reconnect', async (t) => {
  const setup = await fixture(t);
  const first = await setup.start();
  const client = await setup.connect(first.wsUrl);
  await client.waitFor((m) => m.type === 'state');
  let sequence = 0;
  const manage = async (kind, payload) => {
    const id = 'manage-' + ++sequence;
    client.send({ type: kind + ':manage', id, payload });
    await client.waitFor((m) => m.type === 'management:result' && m.id === id);
  };
  const people = first.app.getState().settings.modules.hosts.people;
  await manage('hosts', { action: 'slot', index: 2, patch: { personId: people[3].id, style: 'i', hidden: false } });
  await manage('hosts', { action: 'slot', index: 2, patch: { accentColor: '#FFFFFF', textColor: '#123456', customColors: true } });
  client.send({ type: 'patch', id: 'count', patch: { modules: { hosts: { slotCount: 1 } } } });
  await client.waitFor((m) => m.type === 'state' && m.id === 'count');
  assert.equal(first.app.getState().settings.modules.hosts.slots[2].personId, people[3].id);
  await manage('hosts', { action: 'save', item: { ...people[3], name: '新姓名', title: '新头衔' } });
  await manage('hosts', { action: 'delete', id: people[0].id });
  let module = first.app.getState().settings.modules.hosts;
  assert.equal(module.slots[0].personId, null);
  assert.equal(module.slots[0].hidden, true);
  assert.equal(module.slots[2].personId, people[3].id);
  assert.equal(module.slots[2].style, 'i');
  const items = first.app.getState().settings.modules.program.items;
  await manage('program', { action: 'select', id: items[2].id });
  await manage('program', { action: 'delete', id: items[0].id });
  assert.equal(first.app.getState().settings.modules.program.selectedId, items[2].id);
  await manage('program', { action: 'save', item: { ...items[2], title: '新节目标题' } });
  assert.equal(first.app.getState().settings.modules.program.current, '新节目标题');
  await manage('program', { action: 'delete', id: items[2].id });
  assert.equal(first.app.getState().settings.modules.program.selectedId, items[3].id);
  await manage('program', { action: 'select', id: items.at(-1).id });
  await manage('program', { action: 'navigate', direction: 1 });
  assert.equal(first.app.getState().settings.modules.program.next, '');
  await setup.stop(first.app);
  const after = await setup.start();
  const fresh = await setup.connect(after.wsUrl);
  const snapshot = await fresh.waitFor((m) => m.type === 'state');
  assert.equal(snapshot.settings.modules.hosts.slots[2].textColor, '#123456');
  assert.equal(snapshot.settings.modules.program.selectedId, items.at(-1).id);
  assert.equal(snapshot.settings.modules.hosts.people.find((p) => p.id === people[3].id).title, '新头衔');
});

test('management rejects malformed and concurrent changes atomically and preserves playout on disk failure', async (t) => {
  const { rename, rmdir } = await import('node:fs/promises');
  const setup = await fixture(t);
  const first = await setup.start();
  const client = await setup.connect(first.wsUrl);
  await client.waitFor((m) => m.type === 'state');
  const previous = first.app.getState().settings;
  const invalid = [
    { action: 'slot', index: 0, patch: { personId: 'missing' } },
    { action: 'slot', index: -1, patch: { hidden: false } },
    { action: 'slot', index: 0, patch: { style: 'unknown', hidden: false } },
    { action: 'save', item: { id: 'bad', name: '' } },
    { action: 'delete', id: 'missing' },
    { action: 'navigate', index: 0, direction: 2 },
  ];
  for (const [i, payload] of invalid.entries()) {
    client.send({ type: 'hosts:manage', id: 'invalid-' + i, payload });
    await client.waitFor((m) => m.type === 'error' && m.id === 'invalid-' + i);
    assert.deepEqual(first.app.getState().settings, previous);
  }
  const backup = setup.settingsPath + '.failure-test';
  await rename(setup.settingsPath, backup);
  await mkdir(setup.settingsPath);
  try {
    client.send({ type: 'hosts:manage', id: 'disk-failure', payload: { action: 'delete', id: previous.modules.hosts.people[0].id } });
    await client.waitFor((m) => m.type === 'error' && m.id === 'disk-failure');
    assert.deepEqual(first.app.getState().settings, previous);
  } finally { await rmdir(setup.settingsPath); await rename(backup, setup.settingsPath); }
  const other = await setup.connect(first.wsUrl);
  await other.waitFor((m) => m.type === 'state');
  client.send({ type: 'hosts:manage', id: 'concurrent-a', payload: { action: 'save', item: { id: 'new-a', name: '甲' } } });
  other.send({ type: 'hosts:manage', id: 'concurrent-b', payload: { action: 'save', item: { id: 'new-b', name: '乙' } } });
  await client.waitFor((m) => m.type === 'management:result' && m.id === 'concurrent-a');
  await other.waitFor((m) => m.type === 'management:result' && m.id === 'concurrent-b');
  const disk = JSON.parse(await readFile(setup.settingsPath, 'utf8'));
  assert.ok(disk.modules.hosts.people.some((p) => p.id === 'new-a'));
  assert.ok(disk.modules.hosts.people.some((p) => p.id === 'new-b'));
});
