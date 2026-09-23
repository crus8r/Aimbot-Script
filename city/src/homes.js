// Boot Sunny Lane: loading screen, the street, the household, the UI.
import { HomeGame } from './homes/game.js';
import { itemActions, simActions } from './homes/actions.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
const bar = document.getElementById('load-bar');
const note = document.getElementById('load-note');

function progress(p, text) {
  if (bar) bar.style.width = `${Math.round(p * 100)}%`;
  if (note && text) note.textContent = text;
}

async function boot() {
  const game = new HomeGame({ canvas, params, onProgress: progress });
  window.game = game;
  // For scripted checks (tools/homes-shots.mjs) and the console.
  window.__itemActions = itemActions;
  window.__simActions = simActions;
  await game.load();
  if (document.getElementById('hud')) {
    const { HomeUI } = await import('./homes/ui.js');
    game.ui = new HomeUI(game);
  }
  progress(1, 'Welcome home');
  document.body.classList.add('loaded');
  if (!params.has('test')) game.start();
  window.__ready = true;
}

boot().catch((e) => {
  console.error(e);
  window.__error = String(e && e.stack || e);
  if (note) note.textContent = `Something broke while loading: ${e.message}`;
});
