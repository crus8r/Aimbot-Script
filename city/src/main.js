// Boot: loading screen, build the world, start the loop.
import { Game } from './game/game.js';
import { buildTestYard } from './world/testyard.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
const bar = document.getElementById('load-bar');
const note = document.getElementById('load-note');

function progress(p, text) {
  if (bar) bar.style.width = `${Math.round(p * 100)}%`;
  if (note && text) note.textContent = text;
}

async function boot() {
  const game = new Game({ canvas, params, onProgress: progress });
  window.game = game;
  const world = params.get('world') || 'city';
  let build = buildTestYard;
  if (world === 'city') build = (await import('./world/city.js')).buildCity;
  await game.load(build);
  progress(1, 'Ready');
  document.body.classList.add('loaded');
  if (!params.has('test')) game.start();
  window.__ready = true;
}

boot().catch((e) => {
  console.error(e);
  window.__error = String(e && e.stack || e);
  if (note) note.textContent = `Something broke while loading: ${e.message}`;
});
