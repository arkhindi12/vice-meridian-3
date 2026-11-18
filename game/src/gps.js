// gps.js — the route the car follows, drawn on the asphalt.
//
// This is a road route, not an arrow: the destination is snapped onto the avenue grid, an A* search
// over the 9x9 intersection graph finds the cheapest way through it, and the waypoints are stitched
// back into a polyline whose every segment runs along an avenue. A route that turns at intersections
// cannot cross a block, because there is no edge in the graph that does.
//
// The polyline is then extruded into a ribbon lying 7 cm above the road, with the softness and the
// pulse done in the fragment shader: a bright core, a feathered edge, and a slow wave travelling
// along the length of the route toward the objective. Additive blending is what makes it read as
// light on tarmac rather than as a painted stripe — at dusk it glows, at night it is the brightest
// thing at road level, and in daylight it is still legible.
//
// The same polyline is what the minimap draws, so the map and the street agree by construction.

import * as THREE from '../vendor/three/three.module.min.js';
import { AVENUES } from './units.js';

const N = AVENUES.length;
const HALF_WIDTH = 3.0;
const LIFT = 0.07;
/** How far off the avenue's centre line the ribbon runs: one lane, which is where the player drives. */
const LANE_OFFSET = 5.2;

const vertexShader = /* glsl */ `
  attribute float aAcross;
  attribute float aAlong;
  varying float vAcross;
  varying float vAlong;
  void main() {
    vAcross = aAcross;
    vAlong = aAlong;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uStrength;
  varying float vAcross;
  varying float vAlong;
  void main() {
    float d = abs(vAcross);
    float core = smoothstep(0.80, 0.30, d);
    float edge = smoothstep(1.0, 0.30, d);
    // A wave that travels toward the destination, and a slower breathing over the whole line.
    float wave = 0.5 + 0.5 * sin(vAlong * 0.085 - uTime * 3.2);
    float breath = 0.5 + 0.5 * sin(uTime * 1.5);
    float pulse = 0.72 + 0.28 * wave;
    // The colour is pushed past 1 in the core so additive blending puts a white-hot centre in the
    // line, which is what makes it read at thumbnail size against a dark road.
    vec3 col = uColor * (1.5 + 1.5 * core) + vec3(0.75, 1.9, 1.75) * (0.35 + 0.65 * wave) * core;
    float alpha = (0.55 * edge + 1.05 * core) * pulse * uStrength * (0.86 + 0.14 * breath);
    gl_FragColor = vec4(col, alpha);
  }
`;

/** Index of the avenue line nearest a coordinate, and how far off it the point is. */
function nearest(v) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < N; i += 1) {
    const d = Math.abs(AVENUES[i] - v);
    if (d < bestD - 0.001) {
      bestD = d;
      best = i;
    }
  }
  return { i: best, off: bestD };
}

/**
 * The intersection a point should join the grid at, and the short leg that gets it there.
 *
 * A car in a lane sits about five metres off the avenue's centre line, so the leg has to run along
 * the avenue it is already on: pick the axis it is closest to, keep the other coordinate where the
 * car is, and the connector is a short straight run down the lane rather than a diagonal across a
 * block. The tie-break (strict <) is what keeps a car sitting exactly on a centre line from
 * flipping between the two axes as it creeps forward.
 */
function entry(x, z) {
  const ax = nearest(x);
  const az = nearest(z);
  if (ax.off < az.off) {
    // The point is on a north-south avenue: leave along it, keeping its x.
    return { i: ax.i, j: az.i, x: AVENUES[ax.i], z };
  }
  return { i: ax.i, j: az.i, x, z: AVENUES[az.i] };
}

const key = (i, j) => i * N + j;

/**
 * A* over the avenue lattice. Nodes are intersections; edges are one block along an avenue. The
 * heuristic is the Manhattan distance on the grid, which is admissible because every edge costs a
 * full block. With 81 nodes this is instant, but keeping it a real search means the route stays a
 * route if a block is ever closed.
 */
function search(from, to) {
  const start = key(from.i, from.j);
  const goal = key(to.i, to.j);
  const open = [{ k: start, f: 0 }];
  const came = new Map();
  const g = new Map([[start, 0]]);
  const h = (i, j) => Math.abs(i - to.i) + Math.abs(j - to.j);

  while (open.length > 0) {
    // The frontier is 81 nodes at most, so a linear scan for the lowest f is the honest choice.
    let bestAt = 0;
    for (let i = 1; i < open.length; i += 1) if (open[i].f < open[bestAt].f) bestAt = i;
    const node = open.splice(bestAt, 1)[0];
    if (node.k === goal) {
      const out = [];
      let at = goal;
      while (at !== undefined) {
        out.push({ i: Math.floor(at / N), j: at % N });
        at = came.get(at);
      }
      return out.reverse();
    }
    const i = Math.floor(node.k / N);
    const j = node.k % N;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const nk = key(ni, nj);
      const cost = (g.get(node.k) ?? Infinity) + 1;
      if (cost >= (g.get(nk) ?? Infinity)) continue;
      g.set(nk, cost);
      came.set(nk, node.k);
      open.push({ k: nk, f: cost + h(ni, nj) });
    }
  }
  return null;
}

/**
 * The waypoints from a point to a point, along the streets. Always at least two points and never a
 * segment that crosses a block.
 *
 * The grid gives a polyline down the middle of each avenue; a car does not drive down the middle, it
 * drives in a lane. So after the search the centreline is pushed sideways by LANE_OFFSET, to the
 * right of the direction of travel, with a mitred join at each corner — which is what puts the
 * ribbon under the player's own wheels instead of under the crown of the road, and what stops the
 * line jogging sideways the moment a route begins.
 */
export function routeBetween(from, to) {
  const a = entry(from.x, from.z);
  const b = entry(to.x, to.z);
  const nodes = search(a, b);
  const pts = [{ x: from.x, z: from.z }, { x: a.x, z: a.z }];
  if (nodes) {
    for (const n of nodes) {
      const p = { x: AVENUES[n.i], z: AVENUES[n.j] };
      const last = pts[pts.length - 1];
      if (Math.abs(last.x - p.x) > 0.01 || Math.abs(last.z - p.z) > 0.01) pts.push(p);
    }
  }
  const end = { x: b.x, z: b.z };
  const last = pts[pts.length - 1];
  if (Math.abs(last.x - end.x) > 0.01 || Math.abs(last.z - end.z) > 0.01) pts.push(end);
  if (Math.abs(end.x - to.x) > 0.01 || Math.abs(end.z - to.z) > 0.01) pts.push({ x: to.x, z: to.z });

  // Drop points that are on top of each other, then collapse collinear runs so "how many turns"
  // means what it says.
  const straight = [pts[0]];
  for (let i = 1; i < pts.length; i += 1) {
    const prev = straight[straight.length - 1];
    if (Math.hypot(pts[i].x - prev.x, pts[i].z - prev.z) < 0.6) continue;
    straight.push(pts[i]);
  }

  return offsetTo(rightHandLane(straight), from, to);
}

/** Push each segment sideways into the right-hand lane, mitring the corners. */
function rightHandLane(pts) {
  if (pts.length < 2) return pts;
  const out = [];
  const dirs = [];
  for (let i = 1; i < pts.length; i += 1) {
    const dx = pts[i].x - pts[i - 1].x;
    const dz = pts[i].z - pts[i - 1].z;
    const len = Math.hypot(dx, dz) || 1;
    dirs.push({ x: dx / len, z: dz / len });
  }
  for (let i = 0; i < pts.length; i += 1) {
    const before = dirs[Math.max(0, i - 1)];
    const after = dirs[Math.min(dirs.length - 1, i)];
    // The normal to the right of travel. With +x east and +z south the ground plane's "up" is -z,
    // so a heading (dx, dz) has its right-hand side at (-dz, dx): east-bound traffic keeps to the
    // south kerb, north-bound to the east one, which is the lane the player is already driving in.
    const n1 = { x: -before.z, z: before.x };
    const n2 = { x: -after.z, z: after.x };
    let mx = n1.x + n2.x;
    let mz = n1.z + n2.z;
    const mlen = Math.hypot(mx, mz) || 1;
    mx /= mlen;
    mz /= mlen;
    // A mitre is longer than the lane offset by 1/cos(half the turn), which keeps the ribbon's
    // width constant through the corner instead of pinching on the inside.
    const cosHalf = Math.max(0.5, mx * n1.x + mz * n1.z);
    const push = LANE_OFFSET / cosHalf;
    out.push({ x: pts[i].x + mx * push, z: pts[i].z + mz * push });
  }
  return out;
}

/** Keep the ribbon anchored to where the player actually is, and to the marker at the far end. */
function offsetTo(pts, from, to) {
  if (pts.length === 0) return pts;
  const head = { x: from.x, z: from.z };
  const tail = { x: to.x, z: to.z };
  // The offset polyline's first point is a lane's width beside the car and may sit behind it. A route
  // that starts by pointing backwards reads as a mistake, so leading points within a dozen metres of
  // the car are dropped: what is left is one short merge into the lane, in the direction of travel.
  while (pts.length > 1 && Math.hypot(pts[0].x - head.x, pts[0].z - head.z) < 12) pts.shift();
  // The same at the far end: the last few metres of a mitre can double back on the marker, which
  // draws as a little hook. Trim them and end on the marker itself.
  while (pts.length > 1 && Math.hypot(pts[pts.length - 1].x - tail.x, pts[pts.length - 1].z - tail.z) < 12) pts.pop();
  pts.unshift(head);
  pts.push(tail);
  return pts;
}

/** How many corners a polyline turns: the number of interior waypoints left after collapsing. */
export function turnsOf(points) {
  return Math.max(0, points.length - 2);
}

/**
 * The street-only part of a polyline, plus the two access legs at either end that are not street
 * segments: the short run from where the car is to its lane, and the last few metres onto a forecourt
 * or a kerb where the marker sits. The HUD's caption uses this to be honest about what it is drawing.
 */
export function streetSegments(points) {
  let street = 0;
  let access = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const axis = Math.abs(a.x - b.x) < 0.6 || Math.abs(a.z - b.z) < 0.6;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (axis) street += len;
    else access += len;
  }
  return { street, access };
}

/**
 * The route itself: a ribbon mesh that is rebuilt when the waypoints change and re-lit every frame
 * by its own clock. `update(from, to)` is cheap to call every step; it only rebuilds the geometry
 * when a waypoint has actually moved by more than a metre or two, which is what keeps the line from
 * shivering as the car creeps down a block.
 */
export class GpsRoute {
  constructor(scene) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color('#20ffe4') },
        uTime: { value: 0 },
        uStrength: { value: 1 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    this.geometry = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'gps-route';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.points = [];
    this.signature = '';
    this.length = 0;
  }

  /** The waypoints the route is currently made of. */
  get waypoints() {
    return this.points;
  }

  /** Re-route from a point to a point. Returns the waypoints in use. */
  update(from, to, visible = true) {
    this.material.uniforms.uStrength.value = visible ? 1 : 0;
    this.mesh.visible = visible;
    if (!visible) return this.points;
    const pts = routeBetween(from, to);
    const sig = pts.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join('|');
    if (sig !== this.signature) {
      this.signature = sig;
      this.points = pts;
      this.rebuild();
    }
    return this.points;
  }

  /** Extrude the polyline into a flat ribbon: two vertices per waypoint, one each side of the line. */
  rebuild() {
    const raw = this.points;
    if (raw.length < 2) {
      this.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
      this.geometry.setIndex([]);
      return;
    }
    // The waypoints are intersections up to 300 m apart, and a shader pulse sampled every 300 m would
    // be a single smear along each block. So each segment is resampled every few metres and each
    // corner is rounded with a short quadratic, which is what gives the line its wave and its soft
    // turn rather than one long straight hop per avenue.
    const pts = [];
    for (let i = 0; i < raw.length; i += 1) {
      const prev = raw[Math.max(0, i - 1)];
      const here = raw[i];
      const next = raw[Math.min(raw.length - 1, i + 1)];
      if (i === 0 || i === raw.length - 1) {
        pts.push({ x: here.x, z: here.z });
        continue;
      }
      // Round the corner: pull back from it along both legs, then arc between the two points.
      const inLen = Math.hypot(here.x - prev.x, here.z - prev.z);
      const outLen = Math.hypot(next.x - here.x, next.z - here.z);
      const cut = Math.min(7, inLen * 0.42, outLen * 0.42);
      if (cut < 1.2) {
        pts.push({ x: here.x, z: here.z });
        continue;
      }
      const a = { x: here.x - ((here.x - prev.x) / inLen) * cut, z: here.z - ((here.z - prev.z) / inLen) * cut };
      const b = { x: here.x + ((next.x - here.x) / outLen) * cut, z: here.z + ((next.z - here.z) / outLen) * cut };
      pts.push(a);
      for (let k = 1; k < 5; k += 1) {
        const t = k / 5;
        // A quadratic through the corner keeps the ribbon on the inside of the turn.
        const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * here.x + t * t * b.x;
        const z = (1 - t) * (1 - t) * a.z + 2 * (1 - t) * t * here.z + t * t * b.z;
        pts.push({ x, z });
      }
      pts.push(b);
    }

    // Now resample the whole thing at a fixed step, so the pulse is even along the route.
    const dense = [pts[0]];
    const STEP = 3.2;
    let carry = 0;
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1e-4) continue;
      let d = STEP - carry;
      while (d < len) {
        const t = d / len;
        dense.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
        d += STEP;
      }
      carry = len - (d - STEP);
      dense.push({ x: b.x, z: b.z });
      carry = 0;
    }

    const pos = [];
    const across = [];
    const along = [];
    const idx = [];
    let run = 0;
    for (let i = 0; i < dense.length; i += 1) {
      const prev = dense[Math.max(0, i - 1)];
      const next = dense[Math.min(dense.length - 1, i + 1)];
      let dx = next.x - prev.x;
      let dz = next.z - prev.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      // The normal of the segment, so the ribbon keeps its width through a corner.
      const nx = -dz;
      const nz = dx;
      if (i > 0) run += Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z);
      pos.push(dense[i].x + nx * HALF_WIDTH, LIFT, dense[i].z + nz * HALF_WIDTH);
      pos.push(dense[i].x - nx * HALF_WIDTH, LIFT, dense[i].z - nz * HALF_WIDTH);
      across.push(1, -1);
      along.push(run, run);
      if (i > 0) {
        const b = (i - 1) * 2;
        idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }
    this.length = run;
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.geometry.setAttribute('aAcross', new THREE.Float32BufferAttribute(across, 1));
    this.geometry.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
    this.geometry.setIndex(idx);
    this.geometry.computeBoundingSphere();
  }

  /** The pulse's clock. */
  animate(t) {
    this.material.uniforms.uTime.value = t;
  }

  /** True when a point is within `pad` of the route, for the HUD's "on route" caption. */
  near(x, z, pad = 6) {
    for (let i = 1; i < this.points.length; i += 1) {
      const a = this.points[i - 1];
      const b = this.points[i];
      const vx = b.x - a.x;
      const vz = b.z - a.z;
      const wx = x - a.x;
      const wz = z - a.z;
      const l2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / l2));
      if (Math.hypot(wx - vx * t, wz - vz * t) < pad) return true;
    }
    return false;
  }
}

/** The distance along a route, for the HUD's "route in 640 m" line. */
export function routeLength(points) {
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) sum += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  return sum;
}

