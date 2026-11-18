// mathKit.js — the six small functions the rest of the game is written in.
//
// Nothing here knows about the city. It is the arithmetic every simulation needs and that is easy
// to get subtly wrong six times over: clamping, easing, wrapping an angle, and turning a heading
// toward a target without spinning the long way round.

export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a, b, t) => a + (b - a) * t;

/** Move `v` toward `target` by at most `step`. */
export function approach(v, target, step) {
  if (v < target) return Math.min(target, v + step);
  if (v > target) return Math.max(target, v - step);
  return target;
}

/** An angle in (-PI, PI]. */
export function wrapAngle(a) {
  let x = (a + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
}

/** The signed turn from `from` to `to`, in (-PI, PI]. */
export const angleDelta = (from, to) => wrapAngle(to - from);

/** Turn `from` toward `to` by at most `step` radians. */
export function turnToward(from, to, step) {
  const d = angleDelta(from, to);
  return from + clamp(d, -step, step);
}

/** A frame-rate independent approach factor: 0 never arrives, 1 arrives at once. */
export const ease = (dt, rate) => 1 - Math.exp(-dt * rate);

export const dist2 = (ax, az, bx, bz) => {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
};

export const dist = (ax, az, bx, bz) => Math.sqrt(dist2(ax, az, bx, bz));

/** A 16-bit-per-channel hex colour as "r,g,b" in 0..1, for shader uniforms. */
export function rgb01(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
