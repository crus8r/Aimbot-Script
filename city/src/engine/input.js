// Keyboard and mouse. Pointer lock when the page allows it; drag-to-look
// when it doesn't (some embedded viewers refuse pointer lock).
export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.pressed = new Set();      // keys that went down this frame
    this.mouse = { dx: 0, dy: 0, wheel: 0, down: false, locked: false };
    this.typing = false;           // chat box has focus: swallow game keys
    this.enabled = true;
    addEventListener('keydown', (e) => {
      if (this.typing) return;
      const k = e.code;
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(k)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    el.addEventListener('mousedown', (e) => {
      this.mouse.down = true;
      if (!this.mouse.locked && e.button === 0 && this.wantLock) {
        try {
          const p = el.requestPointerLock?.();
          if (p && p.catch) p.catch(() => {});
        } catch { /* viewer refuses pointer lock: drag-to-look still works */ }
      }
    });
    addEventListener('mouseup', () => { this.mouse.down = false; });
    addEventListener('mousemove', (e) => {
      if (this.mouse.locked || this.mouse.down) {
        this.mouse.dx += e.movementX || 0;
        this.mouse.dy += e.movementY || 0;
      }
    });
    el.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => { this.mouse.locked = document.pointerLockElement === el; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.wantLock = true;
  }

  down(...codes) { return this.enabled && !this.typing && codes.some((c) => this.keys.has(c)); }
  hit(...codes) { return this.enabled && !this.typing && codes.some((c) => this.pressed.has(c)); }

  endFrame() {
    this.pressed.clear();
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
  }

  releaseLock() { if (document.pointerLockElement) document.exitPointerLock(); }
}
