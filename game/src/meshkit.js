// meshkit.js — pile up flat faces that share a material and hand back one mesh.
//
// The city is several thousand boxes: kerbs, cornices, roofs, towers, lamp posts, palm trunks. One
// mesh each would be thousands of draw calls. So every surface with the same material goes into a
// Builder, and mesh() returns a single BufferGeometry with its world transform already baked in.
//
// UVs are in metres, not 0..1, which is what lets one window texture tile at a constant size across
// a nine-metre shopfront and a ninety-metre tower without per-building scaling. Every face writes
// its own normal and winding, so back-face culling stays on and no building is drawn inside out.

import * as THREE from '../vendor/three/three.module.min.js';

const TURN = Math.PI * 2;

function span(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

function normalOf(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

export class Builder {
  constructor(material, { shadows = true, tinted = false } = {}) {
    this.material = material;
    this.shadows = shadows;
    this.tinted = tinted;
    this.pos = [];
    this.nrm = [];
    this.uvs = [];
    this.col = [];
    this.idx = [];
  }

  get count() {
    return this.pos.length / 3;
  }

  /** One quad, counter-clockwise seen from its front. `uv` is four (u, v) pairs in corner order. */
  quad(a, b, c, d, uv = null, normal = null, colour = null) {
    const base = this.count;
    const n = normal ?? normalOf(a, b, c);
    for (const p of [a, b, c, d]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(n[0], n[1], n[2]);
      if (this.tinted) this.col.push(...(colour ?? [1, 1, 1]));
    }
    if (uv) {
      for (const pair of uv) this.uvs.push(pair[0], pair[1]);
    } else {
      const u = span(a, b);
      const v = span(a, d);
      this.uvs.push(0, 0, u, 0, u, v, 0, v);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** An upright box standing on `y`, centred on (x, z). `tile` is metres per texture repeat. */
  box(x, y, z, w, h, d, opts = {}) {
    const tx = opts.tile?.[0] ?? 8;
    const ty = opts.tile?.[1] ?? 4;
    const tint = opts.colour ?? null;
    const x0 = x - w / 2;
    const x1 = x + w / 2;
    const z0 = z - d / 2;
    const z1 = z + d / 2;
    const y0 = y;
    const y1 = y + h;
    const grid = (run, rise) => {
      const nu = Math.max(1, Math.round(run / tx));
      const nv = Math.max(1, Math.round(rise / ty));
      return [[0, 0], [nu, 0], [nu, nv], [0, nv]];
    };
    const faces = opts.faces ?? 'fbrl';

    if (faces.includes('f')) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], grid(w, h), [0, 0, 1], tint);
    if (faces.includes('b')) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], grid(w, h), [0, 0, -1], tint);
    if (faces.includes('r')) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], grid(d, h), [1, 0, 0], tint);
    if (faces.includes('l')) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], grid(d, h), [-1, 0, 0], tint);
    if (opts.lid !== false) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], grid(w, d), [0, 1, 0], opts.lidColour ?? tint);
    if (opts.floor === true) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], grid(w, d), [0, -1, 0], tint);
  }

  /** A flat rectangle at height y facing up (or down). */
  slab(x0, z0, x1, z1, y, opts = {}) {
    const tile = opts.tile ?? 20;
    const tint = opts.colour ?? null;
    const u0 = x0 / tile;
    const u1 = x1 / tile;
    const v0 = z0 / tile;
    const v1 = z1 / tile;
    if (opts.up === false) {
      this.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], [0, -1, 0], tint);
    } else {
      this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [[u0, v1], [u1, v1], [u1, v0], [u0, v0]], [0, 1, 0], tint);
    }
  }

  /** A flat rectangle of any heading, centred, at height y: road paint, puddles, scorch marks. */
  patch(cx, cz, w, d, y, heading = 0, tint = null) {
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    const at = (dx, dz) => [cx + dx * c - dz * s, y, cz + dx * s + dz * c];
    this.quad(at(-w / 2, d / 2), at(w / 2, d / 2), at(w / 2, -d / 2), at(-w / 2, -d / 2), [[0, 1], [1, 1], [1, 0], [0, 0]], [0, 1, 0], tint);
  }

  /** A box turned about its own vertical axis. */
  turned(cx, y, cz, w, h, d, heading, tint = null, tile = [4, 4]) {
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    const at = (dx, dy, dz) => [cx + dx * c - dz * s, y + dy, cz + dx * s + dz * c];
    const hw = w / 2;
    const hd = d / 2;
    const side = [[0, 0], [Math.max(1, w / tile[0]), 0], [Math.max(1, w / tile[0]), Math.max(1, h / tile[1])], [0, Math.max(1, h / tile[1])]];
    const end = [[0, 0], [Math.max(1, d / tile[0]), 0], [Math.max(1, d / tile[0]), Math.max(1, h / tile[1])], [0, Math.max(1, h / tile[1])]];
    const n = (nx, nz) => [nx * c - nz * s, 0, nx * s + nz * c];
    this.quad(at(-hw, 0, hd), at(hw, 0, hd), at(hw, h, hd), at(-hw, h, hd), side, n(0, 1), tint);
    this.quad(at(hw, 0, -hd), at(-hw, 0, -hd), at(-hw, h, -hd), at(hw, h, -hd), side, n(0, -1), tint);
    this.quad(at(hw, 0, hd), at(hw, 0, -hd), at(hw, h, -hd), at(hw, h, hd), end, n(1, 0), tint);
    this.quad(at(-hw, 0, -hd), at(-hw, 0, hd), at(-hw, h, hd), at(-hw, h, -hd), end, n(-1, 0), tint);
    this.quad(at(-hw, h, hd), at(hw, h, hd), at(hw, h, -hd), at(-hw, h, -hd), [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 1, 0], tint);
  }

  /** A tapered round column: trunks, lamp posts, hydrants, bollards, fountain rims. */
  column(cx, base, cz, r0, r1, h, sides = 6, tint = null) {
    for (let i = 0; i < sides; i += 1) {
      const a0 = (i / sides) * TURN;
      const a1 = ((i + 1) / sides) * TURN;
      const p0 = [cx + Math.cos(a0) * r0, base, cz + Math.sin(a0) * r0];
      const p1 = [cx + Math.cos(a1) * r0, base, cz + Math.sin(a1) * r0];
      const p2 = [cx + Math.cos(a1) * r1, base + h, cz + Math.sin(a1) * r1];
      const p3 = [cx + Math.cos(a0) * r1, base + h, cz + Math.sin(a0) * r1];
      const mid = (a0 + a1) / 2;
      this.quad(p0, p1, p2, p3, [[(i / sides) * 2, 0], [((i + 1) / sides) * 2, 0], [((i + 1) / sides) * 2, 1], [(i / sides) * 2, 1]], [Math.cos(mid), 0, Math.sin(mid)], tint);
    }
  }

  /** A wedge: the stunt ramp. A flat run up, a lip, and the two sides that close it. */
  wedge(cx, cz, w, run, rise, heading = 0, tint = null) {
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    const at = (dx, dy, dz) => [cx + dx * c - dz * s, dy, cz + dx * s + dz * c];
    const hw = w / 2;
    // The deck: from the ground at +run/2 up to the lip at -run/2.
    this.quad(at(-hw, 0, run / 2), at(hw, 0, run / 2), at(hw, rise, -run / 2), at(-hw, rise, -run / 2), [[0, 0], [w / 6, 0], [w / 6, run / 6], [0, run / 6]], null, tint);
    // The lip face, and the two triangular sides.
    this.quad(at(hw, 0, -run / 2), at(-hw, 0, -run / 2), at(-hw, rise, -run / 2), at(hw, rise, -run / 2), null, [0, 0, -1], tint);
    for (const side of [-1, 1]) {
      const base = this.count;
      const x = side * hw;
      this.pos.push(at(x, 0, run / 2)[0], 0, at(x, 0, run / 2)[2]);
      this.pos.push(at(x, 0, -run / 2)[0], 0, at(x, 0, -run / 2)[2]);
      this.pos.push(at(x, rise, -run / 2)[0], rise, at(x, rise, -run / 2)[2]);
      for (let k = 0; k < 3; k += 1) {
        this.nrm.push(side, 0, 0);
        if (this.tinted) this.col.push(...(tint ?? [1, 1, 1]));
      }
      this.uvs.push(0, 0, 1, 0, 1, 1);
      if (side > 0) this.idx.push(base, base + 1, base + 2);
      else this.idx.push(base, base + 2, base + 1);
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    if (this.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  mesh(name = 'builder') {
    const m = new THREE.Mesh(this.geometry(), this.material);
    m.name = name;
    m.castShadow = this.shadows;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }
}
