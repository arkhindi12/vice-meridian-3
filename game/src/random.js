// random.js — one deterministic number stream per caller.
//
// Every city in this game is generated, and a generated city has to be the same city every time it
// loads: the same towers on the same blocks, or the screenshots stop matching the game. So there is
// no Math.random anywhere in the build. Each system asks for its own named stream, seeded from the
// run's seed, and the streams cannot perturb one another by drawing a different number of values.

/** A small, fast, seedable generator (mulberry32): 32 bits of state, uniform in [0, 1). */
export function stream(seed) {
  let state = (Math.imul(seed | 0, 2654435761) ^ 0x9e3779b9) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /** A whole number in [lo, hi], both ends included. */
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  /** A real number in [lo, hi). */
  next.between = (lo, hi) => lo + next() * (hi - lo);
  /** One element of a list. */
  next.pick = (list) => list[Math.floor(next() * list.length) % list.length];
  /** True with probability p. */
  next.chance = (p) => next() < p;
  /** A fresh angle in radians. */
  next.angle = () => next() * Math.PI * 2;
  return next;
}

/** A stable 0..1 value from two integers, for details that must not consume a stream. */
export function hash2(a, b) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
