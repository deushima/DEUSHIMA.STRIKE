import assert from 'node:assert/strict';
import { Input } from '../src/core/input.js';

globalThis.window = new EventTarget();
globalThis.document = new EventTarget();

const input = new Input({});
input.locked = true;

function wheel(deltaY, ctrlKey = false) {
  const event = new Event('wheel', { cancelable: true });
  Object.defineProperties(event, {
    deltaY: { value: deltaY }, ctrlKey: { value: ctrlKey }, metaKey: { value: false },
  });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

assert.equal(wheel(-100), true);
assert.equal(input.consumeWheelJump({ up: false, down: false }), false);
assert.equal(input.consumeWheel(), -1, 'disabled wheel still cycles weapons');

wheel(-100);
wheel(100);
assert.equal(input.consumeWheelJump({ up: true, down: false }), true);
assert.equal(input.consumeWheel(), 1, 'unselected direction still cycles weapons');

wheel(-100);
wheel(100);
assert.equal(input.consumeWheelJump({ up: true, down: true }), true);
assert.equal(input.consumeWheel(), 0, 'both selected directions only jump');

wheel(100);
assert.equal(input.consumeWheelJump({ up: false, down: true }), true);
assert.equal(input.consumeWheel(), 0);

assert.equal(wheel(-100, true), false, 'Ctrl+wheel remains a browser gesture');
assert.equal(input.consumeWheelJump({ up: true, down: true }), false);
assert.equal(input.consumeWheel(), 0);

wheel(-100);
input.endFrame();
assert.equal(input.consumeWheelJump({ up: true, down: true }), false);
assert.equal(input.consumeWheel(), 0);

input.dispose();
console.log('wheel-jump OK: opt-in up/down jump, residual weapon cycling and frame cleanup');
