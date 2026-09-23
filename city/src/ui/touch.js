// Touch controls: a thumbstick on the left half, drag to look on the right,
// and buttons for the things keys do. Only built on touch screens.
export function setupTouch(game) {
  const coarse = matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (!coarse) return null;
  const root = document.getElementById('touch');
  if (!root) return null;
  root.hidden = false;
  document.getElementById('hud')?.classList.add('touch');
  const input = game.input;
  input.virtualMove = { x: 0, y: 0 };
  const stick = root.querySelector('.stick'), knob = root.querySelector('.knob');
  let moveId = null, lookId = null, origin = null, last = null;
  const R = 56;
  const view = game.renderer.domElement;
  view.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.45 && moveId === null) {
        moveId = t.identifier; origin = { x: t.clientX, y: t.clientY };
        stick.style.left = `${t.clientX}px`; stick.style.top = `${t.clientY}px`; stick.hidden = false;
      } else if (lookId === null) { lookId = t.identifier; last = { x: t.clientX, y: t.clientY }; }
    }
    game.audio?.unlock();
    e.preventDefault();
  }, { passive: false });
  view.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === moveId) {
        let dx = t.clientX - origin.x, dy = t.clientY - origin.y;
        const d = Math.hypot(dx, dy);
        if (d > R) { dx *= R / d; dy *= R / d; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        input.virtualMove.x = dx / R; input.virtualMove.y = -dy / R;
      } else if (t.identifier === lookId) {
        input.mouse.dx += (t.clientX - last.x) * 1.6; input.mouse.dy += (t.clientY - last.y) * 1.6;
        last = { x: t.clientX, y: t.clientY };
      }
    }
    e.preventDefault();
  }, { passive: false });
  const end = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === moveId) { moveId = null; input.virtualMove.x = 0; input.virtualMove.y = 0; stick.hidden = true; knob.style.transform = ''; }
      if (t.identifier === lookId) lookId = null;
    }
  };
  view.addEventListener('touchend', end);
  view.addEventListener('touchcancel', end);
  // Buttons press keys for one frame (or hold, for run).
  for (const b of root.querySelectorAll('[data-key]')) {
    const code = b.dataset.key;
    b.addEventListener('touchstart', (e) => {
      e.preventDefault();
      game.audio?.unlock();
      if (code === 'KeyT') { game.hud?.openChat(); return; }
      if (code === 'KeyG') { game.hud?.root.classList.toggle('emotes-open'); return; }
      if (code === 'KeyF') { game.traffic?.toggleVehicle(); return; }
      input.keys.add(code); input.pressed.add(code);
      b.classList.add('on');
    }, { passive: false });
    b.addEventListener('touchend', (e) => { e.preventDefault(); input.keys.delete(code); b.classList.remove('on'); }, { passive: false });
  }
  return root;
}
