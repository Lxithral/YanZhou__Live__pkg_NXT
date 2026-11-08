import { createLogoRenderer } from './logo-renderer.js';
import { createHostsRenderer } from './hosts-renderer.js';
import { createProgramRenderer } from './program-renderer.js';
import { createLyricsRenderer } from './lyrics-renderer.js';
import { createLyricsClock } from './lyrics-clock.js';

const canvas = document.getElementById('overlay-canvas');
const RENDERERS = {
  logo: createLogoRenderer(canvas),
  hosts: createHostsRenderer(canvas),
  program: createProgramRenderer(canvas),
  lyrics: createLyricsRenderer(canvas),
};
const lyricsClock = createLyricsClock();

let disposed = false;
let reconnectAttempt = 0;
let socket;

function applyState(settings) {
  if (!settings?.canvas || !settings?.modules) return;
  canvas.style.width = `${settings.canvas.width}px`;
  canvas.style.height = `${settings.canvas.height}px`;
  for (const [moduleId, renderer] of Object.entries(RENDERERS)) {
    if (settings.modules[moduleId]) renderer.update(settings.modules[moduleId]);
  }
}

function connect() {
  if (disposed) return;
  socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'state') {
      reconnectAttempt = 0;
      applyState(message.settings);
    } else if (message.type === 'lyrics:state') {
      lyricsClock.apply(message);
      RENDERERS.lyrics.updateLyrics(lyricsClock);
    } else if (message.type === 'lyrics:asr') {
      lyricsClock.applyAsr(message);
      RENDERERS.lyrics.updateLyrics(lyricsClock);
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
