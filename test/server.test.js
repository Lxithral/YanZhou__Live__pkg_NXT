import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createPackagingServer } from '../server.js';

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
  assert.equal(initial.settings.version, 3);
  assert.equal(initial.settings.modules.logo.showMark, true);
  assert.deepEqual(Object.keys(initial.settings.modules), ['logo', 'hosts', 'program']);

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
  assert.equal(state.settings.version, 3);
  assert.equal(state.settings.modules.logo.title, 'YZBTVS');
  assert.equal(state.settings.modules.logo.color, '#FFFFFF');
  assert.equal(state.settings.modules.logo.x, 146);
  assert.equal(state.settings.modules.logo.showMark, true);
  assert.deepEqual(state.settings.modules.logo.animation, { enter: 'fade-up', exit: 'fade-down', duration: 600 });
  assert.equal(state.settings.modules.hosts.visible, false);
  assert.equal(state.settings.modules.program.visible, false);
  assert.equal(state.settings.modules.program.current, '节目名称');

  const persisted = JSON.parse(await readFile(setup.settingsPath, 'utf8'));
  assert.equal(persisted.version, 3);
  assert.equal(persisted.modules.logo.title, 'YZBTVS');
  assert.equal(persisted.modules.logo.showMark, true);
  assert.equal(persisted.modules.hosts.label, '主持人');
  assert.equal(persisted.modules.program.label, '正在演出');
});

test('a version 2 settings file gains the logo mark flag and keeps every other value', async (t) => {
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

  assert.equal(initial.settings.version, 3);
  assert.equal(initial.settings.modules.logo.showMark, true);
  assert.equal(initial.settings.modules.logo.title, 'YZBTVS');
  assert.equal(initial.settings.modules.hosts.names, '张三');

  controller.send({ type: 'patch', id: 'hide-mark', patch: { modules: { logo: { showMark: false } } } });
  const hidden = await controller.waitFor((message) => message.type === 'state' && message.settings.modules.logo.showMark === false);
  await controller.waitFor((message) => message.type === 'saved' && message.revision >= hidden.revision);
  const persisted = JSON.parse(await readFile(setup.settingsPath, 'utf8'));
  assert.equal(persisted.version, 3);
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
