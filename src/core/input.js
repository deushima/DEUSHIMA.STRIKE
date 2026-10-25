/**
 * Keyboard / mouse / pointer-lock input.
 * Keeps raw key state and per-frame "pressed" edges. Call endFrame() once per rendered frame.
 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = [false, false, false];
    this.mousePressed = [false, false, false];
    this.mouseReleased = [false, false, false];
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.wheelUp = 0;
    this.wheelDown = 0;
    this.locked = false;
    this.enabled = true;
    this.sensitivity = 1;
    this.onLockChange = [];
    this.onKeyDownHandlers = [];
    this._handlers = [];

    const listen = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this._handlers.push([target, type, fn, opts]);
    };

    listen(window, 'keydown', (e) => {
      if (!this.enabled) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code === 'Backquote' || e.code.startsWith('Arrow')) {
        if (this.locked || e.code !== 'Tab') e.preventDefault();
      }
      if (!this.keys.has(e.code)) {
        this.pressed.add(e.code);
        for (const cb of this.onKeyDownHandlers) cb(e.code, e);
      }
      this.keys.add(e.code);
    });

    listen(window, 'keyup', (e) => {
      if (!this.enabled) return;
      this.keys.delete(e.code);
      this.released.add(e.code);
    });

    listen(window, 'blur', () => this.clear());
    listen(document, 'visibilitychange', () => {
      if (document.hidden) this.clear();
    });

    listen(document, 'mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.dx += e.movementX || 0;
      this.dy += e.movementY || 0;
    });

    listen(document, 'mousedown', (e) => {
      if (!this.enabled) return;
      if (e.target && e.target.closest && e.target.closest('#ui-root')) return;
      const b = e.button;
      if (b >= 0 && b < 3) {
        if (!this.mouse[b]) this.mousePressed[b] = true;
        this.mouse[b] = true;
      }
      if (this.locked) e.preventDefault();
    });

    listen(window, 'mouseup', (e) => {
      const b = e.button;
      if (b >= 0 && b < 3) {
        if (this.mouse[b]) this.mouseReleased[b] = true;
        this.mouse[b] = false;
      }
    });

    listen(window, 'contextmenu', (e) => e.preventDefault());

    listen(
      window,
      'wheel',
      (e) => {
        if (!this.locked || !this.enabled || e.ctrlKey || e.metaKey) return;
        const direction = Math.sign(e.deltaY);
        if (!direction) return;
        this.wheel += direction;
        if (direction < 0) this.wheelUp++;
        else this.wheelDown++;
        e.preventDefault();
      },
      { passive: false },
    );

    listen(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.dx = 0;
        this.dy = 0;
        this.mouse.fill(false);
      }
      for (const cb of this.onLockChange) cb(this.locked);
    });

    listen(document, 'pointerlockerror', () => {
      for (const cb of this.onLockChange) cb(false);
    });
  }

  addKeyDownHandler(cb) {
    this.onKeyDownHandlers.push(cb);
    return () => {
      this.onKeyDownHandlers = this.onKeyDownHandlers.filter((x) => x !== cb);
    };
  }

  onPointerLockChange(cb) {
    this.onLockChange.push(cb);
    return () => {
      this.onLockChange = this.onLockChange.filter((x) => x !== cb);
    };
  }

  isDown(code) {
    return this.keys.has(code);
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  wasReleased(code) {
    return this.released.has(code);
  }

  consumePressed(code) {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  }

  isMouseDown(button = 0) {
    return this.mouse[button];
  }

  wasMousePressed(button = 0) {
    return this.mousePressed[button];
  }

  consumeMousePressed(button = 0) {
    if (!this.mousePressed[button]) return false;
    this.mousePressed[button] = false;
    return true;
  }

  consumeWheelJump({ up = false, down = false } = {}) {
    const jump = (up && this.wheelUp > 0) || (down && this.wheelDown > 0);
    if (up) this.wheel += this.wheelUp;
    if (down) this.wheel -= this.wheelDown;
    this.wheelUp = 0;
    this.wheelDown = 0;
    return jump;
  }

  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    this.wheelUp = 0;
    this.wheelDown = 0;
    return w;
  }

  consumeLook() {
    const out = { x: this.dx, y: this.dy };
    this.dx = 0;
    this.dy = 0;
    return out;
  }

  requestPointerLock() {
    if (!this.canvas || this.locked) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => this.canvas.requestPointerLock());
    } catch {
      try {
        this.canvas.requestPointerLock();
      } catch {
        /* ignore */
      }
    }
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  clear() {
    this.keys.clear();
    this.pressed.clear();
    this.released.clear();
    this.mouse.fill(false);
    this.mousePressed.fill(false);
    this.mouseReleased.fill(false);
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.wheelUp = 0;
    this.wheelDown = 0;
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mousePressed.fill(false);
    this.mouseReleased.fill(false);
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.wheelUp = 0;
    this.wheelDown = 0;
  }

  dispose() {
    for (const [target, type, fn, opts] of this._handlers) target.removeEventListener(type, fn, opts);
    this._handlers.length = 0;
    this.onLockChange.length = 0;
    this.onKeyDownHandlers.length = 0;
  }
}
