import { createLogoRenderer } from './logo-renderer.js';
import { createHostsRenderer } from './hosts-renderer.js';
import { createProgramRenderer } from './program-renderer.js';
import { createLyricsRenderer } from './lyrics-renderer.js';
import { createLyricsClock } from './lyrics-clock.js';
import { createAvoidance } from './stage-avoidance.js';

const canvas = document.getElementById('overlay-canvas');
const RENDERERS = {
  logo: createLogoRenderer(canvas),
  hosts: createHostsRenderer(canvas),
  program: createProgramRenderer(canvas),
  lyrics: createLyricsRenderer(canvas),
};
const lyricsClock = createLyricsClock();
let stage = { settings: null, showOrder: null };
const avoidance = createAvoidance(RENDERERS, () => stage);

let disposed = false;
let reconnectAttempt = 0;
let socket;

function applyState(settings, showOrder) {
  if (!settings?.canvas || !settings?.modules) return;
  stage = { settings, showOrder };
  canvas.style.width = `${settings.canvas.width}px`;
  canvas.style.height = `${settings.canvas.height}px`;
  for (const [moduleId, renderer] of Object.entries(RENDERERS)) {
    if (settings.modules[moduleId]) renderer.update(settings.modules[moduleId]);
  }
  avoidance.schedule();
}

function connect() {
  if (disposed) return;
  socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'state') {
      reconnectAttempt = 0;
      applyState(message.settings, message.stage?.showOrder);
    } else if (message.type === 'lyrics:state') {
      lyricsClock.apply(message);
      RENDERERS.lyrics.updateLyrics(lyricsClock);
      avoidance.schedule();
    } else if (message.type === 'lyrics:asr') {
      lyricsClock.applyAsr(message);
      RENDERERS.lyrics.updateLyrics(lyricsClock);
      avoidance.schedule();
    }
  });
  socket.addEventListener('close', () => {
    if (disposed) return;
    const delay = Math.min(500 * 2 ** reconnectAttempt, 5000);
    reconnectAttempt += 1;
    setTimeout(connect, delay);
  });
  socket.addEventListener('error', () => socket.close());
}

window.addEventListener('pagehide', () => {
  disposed = true;
  if (socket) socket.close();
});
connect();
