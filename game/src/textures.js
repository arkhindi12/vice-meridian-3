// textures.js — every image the city is painted with, drawn once into a canvas at load.
//
// There are no image files in this game: tarmac, paving, sand, turf, windows, shopfronts, neon,
// palm fronds, the sun disc, lamp spill and the sea's ripples are all painted here with the 2D
// canvas API and handed to three.js as textures. That keeps the whole entry to source files, and it
// lets a texture be a function of its arguments — a facade for this wall colour, a neon board with
// this word on it.
//
// Two are built to be animated rather than looked at: a facade's emissive map is the same building
// with only its lit windows painted, so the light rig can turn the windows up at dusk and down at
// dawn; and the neon boards are painted white-hot so a material colour can dim them by day.

import * as THREE from '../vendor/three/three.module.min.js';
import { stream } from './random.js';

const cache = new Map();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(c, { repeat = [1, 1], srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const memo = (key, make) => {
  let v = cache.get(key);
  if (v === undefined) {
    v = make();
    cache.set(key, v);
  }
  return v;
};

/** A soft round falloff, white at the middle: lamp pools, neon spill, headlight cones. */
export function glow(colour = '#ffffff') {
  return memo(`glow:${colour}`, () => {
    const s = 128;
    const c = canvas(s, s);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, colour);
    grad.addColorStop(0.35, colour);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.globalAlpha = 1;
    g.fillRect(0, 0, s, s);
    return finish(c, { srgb: false });
  });
}

/** The sun's disc: a hot core with a wide corona, so it reads through the haze. */
export function sunDisc() {
  return memo('sun', () => {
    const s = 128;
    const c = canvas(s, s);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,246,1)');
    grad.addColorStop(0.16, 'rgba(255,244,214,0.95)');
    grad.addColorStop(0.3, 'rgba(255,196,140,0.45)');
    grad.addColorStop(1, 'rgba(255,150,110,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    return finish(c, { srgb: false });
  });
}

/** Tarmac: a dark speckled plate with a faint repair seam, tiled every 22 m. */
export function tarmac() {
  return memo('tarmac', () => {
    const s = 512;
    const c = canvas(s, s);
    const g = c.getContext('2d');
    const rand = stream(11);
    g.fillStyle = '#413e4a';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 26000; i += 1) {
      const v = rand.between(0.55, 1.25);
      const base = 74 * v;
      g.fillStyle = `rgba(${base},${base * 0.97},${base * 1.06},${rand.between(0.12, 0.5)})`;
      const r = rand.between(0.6, 2.6);
      g.beginPath();
      g.arc(rand() * s, rand() * s, r, 0, 6.283);
      g.fill();
    }
    // A few tar seams, so a hundred metres of road is not one flat colour.
    g.strokeStyle = 'rgba(30,28,36,0.5)';
    for (let i = 0; i < 6; i += 1) {
      g.lineWidth = rand.between(1.5, 4);
      g.beginPath();
      let x = rand() * s;
      let y = 0;
      g.moveTo(x, y);
      while (y < s) {
        x += rand.between(-14, 14);
        y += rand.between(20, 60);
        g.lineTo(x, y);
      }
      g.stroke();
    }
    return finish(c);
  });
}

/** Paving: pale slabs with grout, and a course line every two metres. */
export function paving() {
  return memo('paving', () => {
    const s = 512;
    const c = canvas(s, s);
    const g = c.getContext('2d');
    const rand = stream(19);
    g.fillStyle = '#ab9880';
    g.fillRect(0, 0, s, s);
    const cell = s / 4;
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const v = rand.between(0.9, 1.08);
        g.fillStyle = `rgb(${Math.min(255, 182 * v)},${Math.min(255, 164 * v)},${Math.min(255, 142 * v)})`;
        g.fillRect(x * cell + 2, y * cell + 2, cell - 4, cell - 4);
      }
    }
    g.strokeStyle = 'rgba(120,100,84,0.5)';
    g.lineWidth = 2;
    for (let i = 0; i <= 4; i += 1) {
      g.beginPath();
      g.moveTo(i * cell, 0);
      g.lineTo(i * cell, s);
      g.moveTo(0, i * cell);
      g.lineTo(s, i * cell);
      g.stroke();
    }
    for (let i = 0; i < 5000; i += 1) {
      g.fillStyle = `rgba(255,255,255,${rand.between(0.02, 0.09)})`;
      g.fillRect(rand() * s, rand() * s, 2, 2);
    }
    return finish(c);
  });
}

export function turf() {
  return memo('turf', () => {
    const s = 256;
    const c = canvas(s, s);
    const g = c.getContext('2d');
    const rand = stream(29);
    g.fillStyle = '#4a8155';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 9000; i += 1) {
      const v = rand.between(0.7, 1.3);
      g.fillStyle = `rgba(${74 * v},${132 * v},${88 * v},0.75)`;
      g.fillRect(rand() * s, rand() * s, rand.between(1, 3), rand.between(2, 5));
    }
    return finish(c);
  });
}

export function dune() {
  return memo('dune', () => {
    const s = 256;
    const c = canvas(s, s);
    const g = c.getContext('2d');
    const rand = stream(31);
    g.fillStyle = '#c9b189';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 60; i += 1) {
      g.strokeStyle = `rgba(255,246,224,${rand.between(0.05, 0.22)})`;
      g.lineWidth = rand.between(2, 9);
      g.beginPath();
      const y = rand() * s;
      g.moveTo(0, y);
      g.bezierCurveTo(s * 0.3, y + rand.between(-16, 16), s * 0.7, y + rand.between(-16, 16), s, y + rand.between(-10, 10));
      g.stroke();
    }
    for (let i = 0; i < 6000; i += 1) {
      g.fillStyle = `rgba(160,130,92,${rand.between(0.05, 0.2)})`;
      g.fillRect(rand() * s, rand() * s, 2, 2);
    }
    return finish(c);
  });
}

/**
 * A facade: a plate in a wall colour with a window grid punched into it, and a second canvas with
 * only the lit windows painted, for the emissive map the light rig turns up after dark.
 * `lit` is 0 (dark), 1 (half) or 2 (most windows on).
 */
export function facade(wall, seed, lit) {
  return memo(`facade:${wall}:${seed}:${lit}`, () => {
    const s = 256;
    const c = canvas(s, s);
    const g = c.getContext('2d');
    const e = canvas(s, s);
    const ge = e.getContext('2d');
    const rand = stream(seed * 7 + 3);
    const base = new THREE.Color(wall);
    g.fillStyle = wall;
    g.fillRect(0, 0, s, s);
    ge.fillStyle = '#000000';
    ge.fillRect(0, 0, s, s);

    // Plaster mottling: big soft patches, a shade either side of the wall colour.
    for (let i = 0; i < 26; i += 1) {
      const v = rand.between(0.86, 1.14);
      g.fillStyle = `rgba(${Math.round(base.r * 255 * v)},${Math.round(base.g * 255 * v)},${Math.round(base.b * 255 * v)},0.4)`;
      g.beginPath();
      g.arc(rand() * s, rand() * s, rand.between(10, 46), 0, 6.283);
      g.fill();
    }

    // Four floors of three windows: the module the building is tiled with, two storeys per repeat.
    const cols = 3;
    const rows = 4;
    const cw = s / cols;
    const ch = s / rows;
    const warm = ['#ffd89a', '#ffe9c0', '#ffc987', '#e8f1ff', '#cfe6ff'];
    for (let r = 0; r < rows; r += 1) {
      for (let k = 0; k < cols; k += 1) {
        const wx = k * cw + cw * 0.22;
        const wy = r * ch + ch * 0.2;
        const ww = cw * 0.56;
        const wh = ch * 0.44;
        // The reveal: a dark inset with a sill under it.
        g.fillStyle = 'rgba(18,20,30,0.9)';
        g.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);
        g.fillStyle = 'rgba(8,10,18,0.96)';
        g.fillRect(wx, wy, ww, wh);
        g.fillStyle = 'rgba(255,255,255,0.14)';
        g.fillRect(wx - 3, wy + wh + 2, ww + 6, 2.5);
        // Some windows have a blind half down.
        if (rand() < 0.3) {
          g.fillStyle = 'rgba(210,200,190,0.5)';
          g.fillRect(wx, wy, ww, wh * rand.between(0.2, 0.6));
        }
        const throws = rand();
        const level = lit === 0 ? 0 : lit === 1 ? 0.42 : 0.7;
        if (throws < level) {
          const col = rand.pick(warm);
          ge.fillStyle = col;
          ge.fillRect(wx, wy, ww, wh);
          // A lit room is bright at its ceiling and dimmer at the floor.
          const lg = ge.createLinearGradient(wx, wy, wx, wy + wh);
          lg.addColorStop(0, 'rgba(255,255,255,0.5)');
          lg.addColorStop(1, 'rgba(0,0,0,0.35)');
          ge.fillStyle = lg;
          ge.fillRect(wx, wy, ww, wh);
          if (rand() < 0.4) {
            // Furniture or a person across the glass.
            ge.fillStyle = 'rgba(0,0,0,0.45)';
            ge.fillRect(wx + ww * rand.between(0.1, 0.6), wy + wh * 0.45, ww * 0.3, wh * 0.55);
          }
        }
      }
    }
    return { map: finish(c), glow: finish(e) };
  });
}

/** A shopfront band: glass panels, a warm interior, a strip of signage light above. */
export function shopfront(seed) {
  return memo(`shopfront:${seed}`, () => {
    const s = 256;
    const c = canvas(s, s * 0.5);
    const g = c.getContext('2d');
    const rand = stream(seed + 61);
    g.fillStyle = '#14121c';
    g.fillRect(0, 0, s, s * 0.5);
    const panes = 4;
    const pw = s / panes;
    for (let i = 0; i < panes; i += 1) {
      const grad = g.createLinearGradient(0, 0, 0, s * 0.5);
      grad.addColorStop(0, '#ffe6b4');
      grad.addColorStop(0.55, '#ffca82');
      grad.addColorStop(1, '#7a5334');
      g.fillStyle = grad;
      g.fillRect(i * pw + 4, 10, pw - 8, s * 0.5 - 30);
      g.fillStyle = 'rgba(30,20,14,0.45)';
      for (let k = 0; k < 3; k += 1) {
        g.fillRect(i * pw + 8 + rand() * 20, 20 + k * 28, rand.between(8, 24), rand.between(14, 40));
      }
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(i * pw + 4, 12, pw - 8, 3);
    }
    return finish(c);
  });
}

const NEON_WORDS = ['VICE', 'HOTEL', 'CLUB', 'SOL', '24H', 'MOTEL', 'LUNA', 'BAR', 'TIKI', 'DRIVE', 'SURF', 'ALOHA'];

/** A neon board: a word in script, a rule under it, and the tube's halo, all in one colour. */
export function neonBoard(colour, variant) {
  return memo(`neon:${colour}:${variant}`, () => {
    const w = 256;
    const h = 128;
    const c = canvas(w, h);
    const g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    const word = NEON_WORDS[(variant * 5 + 2) % NEON_WORDS.length];
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = colour;
    g.shadowBlur = 22;
    // A lit plate behind the tube, so the sign is a surface and not only a stroke: this is what
    // gives a street its glow at the distance a chase camera sees it from.
    const plate = g.createLinearGradient(0, 0, 0, h);
    plate.addColorStop(0, `${colour}33`);
    plate.addColorStop(0.5, `${colour}55`);
    plate.addColorStop(1, `${colour}22`);
    g.fillStyle = plate;
    g.fillRect(4, 4, w - 8, h - 8);
    g.strokeStyle = colour;
    g.lineWidth = 8;
    g.font = 'bold 62px "DejaVu Sans", "Liberation Sans", Arial, sans-serif';
    g.strokeText(word, w / 2, h / 2 - 6);
    g.shadowBlur = 12;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2.6;
    g.strokeText(word, w / 2, h / 2 - 6);
    // A rule of tube under the word, and two end caps.
    g.shadowBlur = 18;
    g.strokeStyle = colour;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(w * 0.18, h * 0.78);
    g.lineTo(w * 0.82, h * 0.78);
    g.stroke();
    g.beginPath();
    g.arc(w * 0.14, h * 0.78, 5, 0, 6.283);
    g.arc(w * 0.86, h * 0.78, 5, 0, 6.283);
    g.fillStyle = colour;
    g.fill();
    return finish(c);
  });
}

/** The plate over a shop's door: its name, its strap line, and the colour of its trade. */
export function shopSign(name, strap, accent) {
  return memo(`sign:${name}`, () => {
    const w = 512;
    const h = 192;
    const c = canvas(w, h);
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(8,7,14,0.92)';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = accent;
    g.lineWidth = 5;
    g.strokeRect(3, 3, w - 6, h - 6);
    g.shadowColor = accent;
    g.shadowBlur = 26;
    g.fillStyle = '#fff8ec';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 62px "DejaVu Sans", "Liberation Sans", Arial, sans-serif';
    g.fillText(name, w / 2, h * 0.42);
    g.shadowBlur = 0;
    g.fillStyle = accent;
    g.font = 'bold 26px "DejaVu Sans Mono", monospace';
    g.fillText(strap, w / 2, h * 0.72);
    return finish(c);
  });
}

/** A palm crown: eight fronds drawn as tapered leaves, on transparent ground. */
export function fronds() {
  return memo('fronds', () => {
    const s = 256;
    const c = canvas(s, s);
    const g = c.getContext('2d');
    const rand = stream(41);
    g.translate(s / 2, s / 2);
    for (let i = 0; i < 9; i += 1) {
      const a = (i / 9) * 6.283 + rand.between(-0.2, 0.2);
      const len = rand.between(s * 0.3, s * 0.48);
      g.save();
      g.rotate(a);
      const grad = g.createLinearGradient(0, 0, len, 0);
      grad.addColorStop(0, 'rgba(38,86,52,0.98)');
      grad.addColorStop(0.5, 'rgba(62,116,64,0.98)');
      grad.addColorStop(1, 'rgba(96,150,80,0.7)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(len * 0.5, -len * 0.22, len, len * 0.06);
      g.quadraticCurveTo(len * 0.5, len * 0.16, 0, 0);
      g.fill();
      // The ribs, as darker slits across the leaf.
      g.strokeStyle = 'rgba(24,56,36,0.6)';
      g.lineWidth = 1.4;
      for (let k = 0.15; k < 0.92; k += 0.12) {
        g.beginPath();
        g.moveTo(len * k, -len * 0.04);
        g.lineTo(len * (k + 0.04), len * 0.04);
        g.stroke();
      }
      g.restore();
    }
    return finish(c);
  });
}

/** The sea: two octaves of ripples, tiled 40 times across the bay and drifted each frame. */
export function ripples() {
  return memo('ripples', () => {
    const s = 256;
    const c = canvas(s, s);
    const g = c.getContext('2d');
    const rand = stream(53);
    g.fillStyle = '#166f80';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i += 1) {
      const y = rand() * s;
      const w = rand.between(14, 70);
      g.strokeStyle = `rgba(180,240,255,${rand.between(0.03, 0.16)})`;
      g.lineWidth = rand.between(0.8, 2.4);
      g.beginPath();
      g.moveTo(rand() * s, y);
      g.quadraticCurveTo(rand() * s, y + rand.between(-4, 4), rand() * s + w, y);
      g.stroke();
    }
    return finish(c);
  });
}

/** The shaft of a searchlight: bright at the apex, fading along its length, soft at the sides. */
export function beam() {
  return memo('beam', () => {
    const w = 64;
    const h = 256;
    const c = canvas(w, h);
    const g = c.getContext('2d');
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y += 1) {
      // v = 0 at the bottom of the canvas; the cone's apex maps to the top row.
      const along = y / h;
      const fade = Math.pow(1 - along, 1.35);
      for (let x = 0; x < w; x += 1) {
        const across = Math.abs(x / w - 0.5) * 2;
        const side = Math.pow(Math.max(0, 1 - across), 1.6);
        const a = Math.round(255 * Math.min(1, fade * 0.85 + side * 0.25) * side);
        const i = (y * w + x) * 4;
        img.data[i] = 255;
        img.data[i + 1] = 244;
        img.data[i + 2] = 214;
        img.data[i + 3] = a;
      }
    }
    g.putImageData(img, 0, 0);
    return finish(c, { srgb: false });
  });
}

/** A billboard ad, drawn from the city's own palette: colour field, a big word, a small strap. */
export function billboard(colour, seed) {
  return memo(`bill:${colour}:${seed}`, () => {
    const w = 256;
    const h = 128;
    const c = canvas(w, h);
    const g = c.getContext('2d');
    const rand = stream(seed + 977);
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, colour);
    grad.addColorStop(1, '#1a1226');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 7; i += 1) {
      g.fillStyle = `rgba(255,255,255,${rand.between(0.03, 0.1)})`;
      g.beginPath();
      g.arc(rand() * w, rand() * h, rand.between(16, 60), 0, 6.283);
      g.fill();
    }
    g.fillStyle = '#fff8ec';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = 'bold 40px "DejaVu Sans", "Liberation Sans", Arial, sans-serif';
    g.fillText(rand.pick(['VICE', 'MERIDIAN', 'SUNSET', 'NEON', 'CORAL']), 16, h * 0.5);
    g.font = 'bold 16px "DejaVu Sans Mono", monospace';
    g.fillStyle = 'rgba(255,248,236,0.75)';
    g.fillText(rand.pick(['EVERY NIGHT', 'OPEN LATE', 'DRIVE IN', 'THE COAST']), 18, h * 0.78);
    return finish(c);
  });
}
