// Keyboard + mouse + pointer-lock input manager.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.justPressed = new Set();
    this.mouse = { x: 0, y: 0, nx: 0, ny: 0, dx: 0, dy: 0 };
    this.buttons = new Set();
    this.enabled = false;

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      // Avoid page scroll for gameplay keys.
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.justPressed.add(e.code);
      this.keys.add(e.code);
    }, { passive: false });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - rect.left;
      this.mouse.y = e.clientY - rect.top;
      this.mouse.nx = (this.mouse.x / rect.width) * 2 - 1;
      this.mouse.ny = -((this.mouse.y / rect.height) * 2 - 1);
    });

    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      this.buttons.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      this.buttons.delete(e.button);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
    });
  }

  setEnabled(v) { this.enabled = v; if (!v) { this.keys.clear(); this.buttons.clear(); } }

  consumeJustPressed(code) {
    if (this.justPressed.has(code)) { this.justPressed.delete(code); return true; }
    return false;
  }

  // Normalized steering axes from keyboard.
  axes() {
    const k = this.keys;
    const x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const y = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    const roll = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    return { x, y, roll };
  }

  firing() { return this.enabled && (this.keys.has('Space') || this.buttons.has(0)); }
  boosting() { return this.enabled && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')); }

  endFrame() { this.justPressed.clear(); }
}
