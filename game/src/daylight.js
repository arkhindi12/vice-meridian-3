// daylight.js — the clock and the light rig, which is the only renderer this game has.
//
// The city never re-renders: one directional sun, one hemisphere fill, one fog colour and a short
// list of emissive materials are all that changes. This module owns those numbers and hands them
// out as a `rig` record for the hour it is asked about, so world.js can apply them and the HUD can
// print the same clock the light is following.
//
// The day is a table of keyframes — the hours the look changes at — and every value between two of
// them is a smooth interpolation of the two. That is what makes 18:52 golden rather than a jump
// between "day" and "night": the palette is continuous, and the phase name is only a label on it.
//
//   05:00-09:00  MORNING     pale cool light, long low sun from the east, lamps still warm
//   09:00-17:00  DAY         high white sun, short shadows, neon almost out
//   17:00-19:00  GOLDEN HOUR low warm sun in the west, hazy pink sky, long raking light
//   19:00-21:00  DUSK        deep magenta, neon and headlights coming up, lamps lit
//   21:00-05:00  NIGHT       dark blue-black sky, neon dominant, headlight cones, lamp pools
//
// `lamp`, `neon`, `windows` and `head` are multipliers in 0..~1.2 applied to the emissive strength
// of the materials world.js keeps for those four families. Nothing else in the game needs to know
// what hour it is.

import { clamp, lerp } from './mathKit.js';

/**
 * The keyframes, in hours. Every colour is what the renderer should show at that hour; the gaps are
 * interpolated. Ordered by hour, wrapping at 24.
 */
const KEYS = [
  {
    h: 0,
    phase: 'NIGHT',
    skyTop: '#050611',
    skyHorizon: '#101a30',
    fog: '#0a1020',
    fogDensity: 0.0004,
    sun: '#b8c2d8',
    sunStrength: 1.35,
    elevation: 0.52,
    bearing: 4.6,
    hemiSky: '#5b6070',
    hemiGround: '#231f26',
    hemi: 1.15,
    lamp: 1.55,
    neon: 1.7,
    windows: 0.8,
    head: 1.0,
    exposure: 1.02,
    stars: 0.9,
    sunDisc: 0,
    seaTint: '#123048',
  },
  {
    h: 4.4,
    phase: 'NIGHT',
    skyTop: '#080a18',
    skyHorizon: '#1a2038',
    fog: '#101728',
    fogDensity: 0.0004,
    sun: '#b8c2d8',
    sunStrength: 1.3,
    elevation: 0.55,
    bearing: 2.6,
    hemiSky: '#5b6070',
    hemiGround: '#231f26',
    hemi: 1.12,
    lamp: 1.5,
    neon: 1.65,
    windows: 0.78,
    head: 1.0,
    exposure: 1.02,
    stars: 0.72,
    sunDisc: 0,
    seaTint: '#14304a',
  },
  {
    h: 5.6,
    phase: 'MORNING',
    skyTop: '#243a5a',
    skyHorizon: '#7e827e',
    fog: '#717674',
    fogDensity: 0.00042,
    sun: '#ffd6ba',
    sunStrength: 1.6,
    elevation: 0.4,
    bearing: 0.55,
    hemiSky: '#b0c8e2',
    hemiGround: '#5e5c58',
    hemi: 0.9,
    lamp: 0.62,
    neon: 0.3,
    windows: 0.42,
    head: 0.85,
    exposure: 1.1,
    stars: 0.12,
    sunDisc: 0.9,
    seaTint: '#2d6478',
  },
  {
    h: 7.6,
    phase: 'MORNING',
    skyTop: '#2a6090',
    skyHorizon: '#93a4ac',
    fog: '#8c9ca4',
    fogDensity: 0.0003,
    sun: '#fff2dc',
    sunStrength: 2.1,
    elevation: 0.58,
    bearing: 0.95,
    hemiSky: '#bdd6ea',
    hemiGround: '#6e6a60',
    hemi: 0.86,
    lamp: 0.1,
    neon: 0.06,
    windows: 0.16,
    head: 0.4,
    exposure: 1.02,
    stars: 0,
    sunDisc: 0.7,
    seaTint: '#27788a',
  },
  {
    h: 12.5,
    phase: 'DAY',
    skyTop: '#1f587e',
    skyHorizon: '#9db6c6',
    fog: '#9aaebc',
    fogDensity: 0.00026,
    sun: '#fffaf0',
    sunStrength: 2.5,
    elevation: 0.86,
    bearing: 2.1,
    hemiSky: '#bcdaea',
    hemiGround: '#726a5c',
    hemi: 0.8,
    lamp: 0,
    neon: 0.02,
    windows: 0.08,
    head: 0.2,
    exposure: 0.9,
    stars: 0,
    sunDisc: 0.55,
    seaTint: '#1a7f92',
  },
  {
    h: 16.2,
    phase: 'DAY',
    skyTop: '#2c5478',
    skyHorizon: '#a89c88',
    fog: '#a2947e',
    fogDensity: 0.0003,
    sun: '#ffe9c4',
    sunStrength: 2.3,
    elevation: 0.62,
    bearing: 3.5,
    hemiSky: '#bfd2e2',
    hemiGround: '#736455',
    hemi: 0.88,
    lamp: 0.06,
    neon: 0.16,
    windows: 0.24,
    head: 0.4,
    exposure: 0.96,
    stars: 0,
    sunDisc: 0.75,
    seaTint: '#1d7285',
  },
  {
    h: 17.9,
    phase: 'GOLDEN HOUR',
    skyTop: '#5b3d7a',
    skyHorizon: '#ffc089',
    fog: '#d29575',
    fogDensity: 0.0003,
    sun: '#ffa869',
    sunStrength: 2.2,
    elevation: 0.5,
    bearing: 3.02,
    hemiSky: '#eebaa8',
    hemiGround: '#a88268',
    hemi: 2.6,
    lamp: 0.9,
    neon: 1.15,
    windows: 0.6,
    head: 0.85,
    exposure: 1.3,
    stars: 0,
    sunDisc: 1,
    seaTint: '#8a5a60',
  },
  {
    h: 19.4,
    phase: 'DUSK',
    skyTop: '#2e1740',
    skyHorizon: '#e0648a',
    fog: '#7a4a68',
    fogDensity: 0.00024,
    sun: '#ff9aa8',
    sunStrength: 2.1,
    elevation: 0.46,
    bearing: 3.22,
    hemiSky: '#c4719e',
    hemiGround: '#43283c',
    hemi: 1.75,
    lamp: 1.15,
    neon: 1.7,
    windows: 0.95,
    head: 1.0,
    exposure: 1.62,
    stars: 0.16,
    sunDisc: 0.8,
    seaTint: '#60294a',
  },
  {
    h: 21.1,
    phase: 'NIGHT',
    skyTop: '#0a0c18',
    skyHorizon: '#2a2436',
    fog: '#1c1c26',
    fogDensity: 0.00036,
    sun: '#b8c2d8',
    sunStrength: 1.35,
    elevation: 0.62,
    bearing: 2.6,
    hemiSky: '#5b6070',
    hemiGround: '#231f26',
    hemi: 1.15,
    lamp: 1.55,
    neon: 1.72,
    windows: 0.8,
    head: 1.0,
    exposure: 1.02,
    stars: 0.85,
    sunDisc: 0,
    seaTint: '#112c44',
  },
  {
    h: 24,
    phase: 'NIGHT',
    skyTop: '#050611',
    skyHorizon: '#101a30',
    fog: '#0e1526',
    fogDensity: 0.00036,
    sun: '#b8c2d8',
    sunStrength: 1.35,
    elevation: 0.52,
    bearing: 4.6,
    hemiSky: '#5b6070',
    hemiGround: '#231f26',
    hemi: 1.15,
    lamp: 1.55,
    neon: 1.7,
    windows: 0.8,
    head: 1.0,
    exposure: 1.02,
    stars: 0.9,
    sunDisc: 0,
    seaTint: '#123048',
  },
];

const COLOUR_KEYS = ['skyTop', 'skyHorizon', 'fog', 'sun', 'hemiSky', 'hemiGround', 'seaTint'];
const NUMBER_KEYS = ['fogDensity', 'sunStrength', 'elevation', 'bearing', 'hemi', 'lamp', 'neon', 'windows', 'head', 'exposure', 'stars', 'sunDisc'];

/** A hex colour as [r, g, b] in 0..1, for interpolating. */
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const hexOf = (c) => `#${[0, 1, 2].map((i) => Math.round(clamp(c[i], 0, 1) * 255).toString(16).padStart(2, '0')).join('')}`;

const smooth = (t) => t * t * (3 - 2 * t);

/**
 * The rig for one hour of one day: every colour and strength the renderer needs, plus the phase's
 * name for the HUD. `hour` is a float in [0, 24).
 */
export function rigAt(hour) {
  const h = ((hour % 24) + 24) % 24;
  let a = KEYS[0];
  let b = KEYS[KEYS.length - 1];
  for (let i = 0; i < KEYS.length - 1; i += 1) {
    if (h >= KEYS[i].h && h <= KEYS[i + 1].h) {
      a = KEYS[i];
      b = KEYS[i + 1];
      break;
    }
  }
  const span = b.h - a.h || 1;
  const t = smooth(clamp((h - a.h) / span, 0, 1));
  const out = { hour: h, phase: t < 0.5 ? a.phase : b.phase, mix: t };
  for (const key of COLOUR_KEYS) {
    const ca = rgb(a[key]);
    const cb = rgb(b[key]);
    out[key] = hexOf([lerp(ca[0], cb[0], t), lerp(ca[1], cb[1], t), lerp(ca[2], cb[2], t)]);
  }
  for (const key of NUMBER_KEYS) out[key] = lerp(a[key], b[key], t);
  return out;
}

/** "18:52" from a decimal hour. */
export function clockText(hour) {
  const h = ((hour % 24) + 24) % 24;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** The full line the HUD prints top-right: "DAY 1 · 18:52". */
export const dayLine = (day, hour) => `DAY ${day} · ${clockText(hour)}`;

/** True when the lamps should be doing the work: what the HUD's phase caption reads off. */
export const isDark = (hour) => {
  const h = ((hour % 24) + 24) % 24;
  return h >= 19 || h < 5.6;
};

/**
 * Advance a clock: `minutes` of game time added to a day/hour pair. Returns the new pair, rolling
 * the day over at midnight. One real second is one game minute, set by the caller.
 */
export function advanceClock(day, hour, minutes) {
  let h = hour + minutes / 60;
  let d = day;
  while (h >= 24) {
    h -= 24;
    d += 1;
  }
  return { day: d, hour: h };
}
