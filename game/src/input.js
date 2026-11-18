// input.js — the keyboard, the pointer and the one gesture audio is allowed to wait for.
//
// Keys are tracked as held and as pressed-this-step. Pressed is consumed by endFrame(), which the
// fixed step calls once per step rather than once per frame: a press must be seen by exactly one
// step, or holding E for a slow frame would buy three cars.
//
// The pointer is tracked as a position and as motion since the last read. Motion is what matters
// for aiming: the camera leans along the aim, so re-deriving the aim from a parked cursor every
// step would feed the camera's own lean back into itself and walk the player in circles.

const held = new Set();
const pressed = new Set();
// `down` is the button's current state; `clicked` is a press that at least one step has not seen yet.
// A click is press-and-release inside a few milliseconds, and a fixed 1/60 s step can fall between the
// two events — so the press is latched until a step consumes it, or the trigger would miss fast clicks.
const pointer = { x: 640, y: 360, down: false, moved: false, clicked: false };
let firstGesture = null;

const KEYS = new Set([
  'w', 'a', 's', 'd', 'e', 'r', 'f', 'm', 'j', 'p', 'tab', 'shift', 'space', 'enter', 'escape',
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
]);

export function attachInput(canvas) {
  window.addEventListener('keydown', (ev) => {
    const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key.toLowerCase();
    if (k === 'tab' || k === 'space' || k.startsWith('arrow')) ev.preventDefault();
    if (KEYS.has(k) && !held.has(k)) pressed.add(k);
    held.add(k);
    if (firstGesture) firstGesture();
  });
  window.addEventListener('keyup', (ev) => {
    const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key.toLowerCase();
    held.delete(k);
  });
  window.addEventListener('blur', () => {
    held.clear();
    pointer.down = false;
  });

  const track = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width ? canvas.width / rect.width : 1;
    const sy = rect.height ? canvas.height / rect.height : 1;
    const x = (ev.clientX - rect.left) * sx;
    const y = (ev.clientY - rect.top) * sy;
    if (Math.abs(x - pointer.x) > 0.5 || Math.abs(y - pointer.y) > 0.5) pointer.moved = true;
    pointer.x = x;
    pointer.y = y;
  };
  canvas.addEventListener('pointermove', track);
  canvas.addEventListener('pointerdown', (ev) => {
    track(ev);
    pointer.down = true;
    pointer.clicked = true;
    if (firstGesture) firstGesture();
  });
  window.addEventListener('pointerup', () => {
    pointer.down = false;
  });
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
}

export const keyHeld = (...keys) => keys.some((k) => held.has(k));
export const keyPressed = (...keys) => keys.some((k) => pressed.has(k));
export const pointerState = () => pointer;

/** Was there pointer motion since this was last called? Clears the flag. */
export function takePointerMotion() {
  const moved = pointer.moved;
  pointer.moved = false;
  return moved;
}

/** WASD as a pair of axes: x is right, z is forward (positive is away from the camera). */
export function moveAxes() {
  return {
    x: (keyHeld('d', 'arrowright') ? 1 : 0) - (keyHeld('a', 'arrowleft') ? 1 : 0),
    z: (keyHeld('w', 'arrowup') ? 1 : 0) - (keyHeld('s', 'arrowdown') ? 1 : 0),
  };
}

/** Forget the presses this step consumed, including a click the step has now fired on. */
export function endFrame() {
  pressed.clear();
  pointer.clicked = false;
}

/** Run `fn` on the first real gesture (a key or a click), which is when audio may start. */
export function onFirstGesture(fn) {
  firstGesture = fn;
}
