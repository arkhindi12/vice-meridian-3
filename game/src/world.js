// world.js — the renderer, the light rig, the sky and the static city, built once from the plan.
//
// Everything that never moves goes through Builder into one mesh per material, so a town of several
// thousand boxes and a hundred neon boards costs about thirty draw calls. This module also owns the
// three things that change without being cast: the sun's shadow box, which slides with the player
// but snaps to a grid so its edges do not crawl; the sky, whose gradient is repainted whenever the
// clock has moved far enough; and the family of lit materials — lamp heads, lamp pools, neon boards,
// lit windows — that the day/night rig turns up and down.
//
// The rig is deliberately small, because criterion two is about the hour changing the light and not
// about a second renderer: one directional sun (colour, strength, elevation), one hemisphere fill,
// one fog colour and density, a tone-mapping exposure, and a handful of scalar multipliers on
// emissive materials. applyRig() is the single place any of that is written.
//
// The moving cast — cars, bodies, the helicopter — is not here. cast.js builds those into the scene
// this module hands back.

import * as THREE from '../vendor/three/three.module.min.js';
import { CITY, SHORE, PAINT, GRID, WORK } from './units.js';
import { AVENUES, KERB, WALK } from './cityPlan.js';
import { Builder } from './meshkit.js';
import { stream } from './random.js';
import { tarmac, paving, dune, turf, facade, shopfront, neonBoard, shopSign, fronds, glow, billboard, ripples, sunDisc } from './textures.js';

const ROAD_W = CITY.first;
const ROAD_E = CITY.last;

/** Build the world onto `canvas` for `plan`, and hand back the handle the game drives. */
export function buildWorld(canvas, plan) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
    stencil: false,
  });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(new THREE.Color('#f0b08c'), 0.00042);

  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.4, 9000);

  // One sun. Its colour, strength and elevation are the day/night rig's to change; here it only has
  // to be a shadow caster with a box wide enough to hold a street and tall enough for a tower.
  const sun = new THREE.DirectionalLight(new THREE.Color('#ff9f5c'), 2.6);
  sun.position.set(-300, 180, -300);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const frustum = sun.shadow.camera;
  frustum.left = -190;
  frustum.right = 190;
  frustum.top = 190;
  frustum.bottom = -190;
  frustum.near = 20;
  frustum.far = 1100;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.55;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(new THREE.Color('#e0a9a0'), new THREE.Color('#7d5c4e'), 1.16);
  scene.add(hemi);
  // A cool rim off the water so no shadowed wall is ever black, whatever the hour.
  const rim = new THREE.DirectionalLight(new THREE.Color('#7fd8e8'), 0.34);
  rim.position.set(-260, 150, 320);
  scene.add(rim);

  const town = new THREE.Group();
  town.name = 'vice-meridian-iii';
  scene.add(town);

  // The materials the rig drives, collected while the city is built.
  const lights = {
    neon: [],
    windows: [],
    lampHead: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe3b0'), toneMapped: false }),
    lampPool: new THREE.MeshBasicMaterial({
      map: glow('#ffcf8a'),
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
    lampCone: new THREE.MeshBasicMaterial({
      map: glow('#ffd9a0'),
      transparent: true,
      opacity: 0.1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
    windowBase: 1,
  };

  const sky = buildSky(scene);
  layGround(town, plan);
  paintLanes(town);
  raiseBlocks(town, plan, lights);
  signShops(town, plan);
  plantPalms(town, plan);
  furnish(town, plan, lights);
  buildRamp(town, plan);
  const sea = floodBay(town);

  const handle = {
    renderer,
    scene,
    camera,
    sun,
    hemi,
    rim,
    town,
    sky,
    sea,
    lights,
    rig: null,
    /** Aim the shadow box at a point, snapped so its edges do not crawl as the player moves. */
    pointSun(x, z, rig) {
      const r = rig ?? handle.rig;
      if (!r) return;
      const snap = 4;
      const sx = Math.round(x / snap) * snap;
      const sz = Math.round(z / snap) * snap;
      const elev = Math.max(0.03, r.elevation) * (Math.PI / 2);
      const ce = Math.cos(elev);
      const se = Math.sin(elev);
      const dx = Math.cos(r.bearing) * ce;
      const dy = se;
      const dz = Math.sin(r.bearing) * ce;
      sun.target.position.set(sx, 0, sz);
      sun.position.set(sx + dx * 460, Math.max(8, dy * 460), sz + dz * 460);
      sun.target.updateMatrixWorld();
      sun.updateMatrixWorld();
      sky.aim(dx, dy, dz, r);
    },
    /** Apply one hour's light: the whole of criterion two, in one function. */
    applyRig(rig) {
      handle.rig = rig;
      sun.color.set(rig.sun);
      sun.intensity = rig.sunStrength;
      hemi.color.set(rig.hemiSky);
      hemi.groundColor.set(rig.hemiGround);
      hemi.intensity = rig.hemi;
      rim.intensity = 0.12 + rig.neon * 0.2;
      scene.fog.color.set(rig.fog);
      scene.fog.density = rig.fogDensity;
      renderer.toneMappingExposure = rig.exposure;

      // Street lamps: heads and the pools they throw on the pavement.
      lights.lampHead.color.setScalar(0.1 + rig.lamp * 0.95);
      lights.lampPool.opacity = 0.06 + rig.lamp * 0.34;
      lights.lampCone.opacity = rig.lamp * 0.13;
      lights.lampPool.visible = rig.lamp > 0.03;
      lights.lampCone.visible = rig.lamp > 0.03;

      // Neon boards and lit windows, each a scalar on an unlit or emissive material.
      for (const mat of lights.neon) mat.color.setScalar(0.18 + rig.neon * 0.92);
      for (const mat of lights.windows) mat.emissiveIntensity = 0.06 + rig.windows * 1.5;

      sky.paint(rig);
      sky.stars.material.opacity = rig.stars;
      sky.stars.visible = rig.stars > 0.02;
      if (sea?.material) sea.material.color.set(rig.seaTint);
      if (sea?.material?.map) {
        sea.material.emissive?.set(rig.seaTint);
      }
    },
    resize(w, h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    /** Drift the water, so a still frame has one thing moving in it. */
    animate(t) {
      if (sea?.material?.map) {
        sea.material.map.offset.x = t * 0.005;
        sea.material.map.offset.y = t * 0.003;
      }
    },
  };
  return handle;
}

// ---------------------------------------------------------------- sky

/**
 * A dome painted with a two-stop gradient whose colours are rewritten as the hour moves, a sun disc
 * that follows the sun's own elevation, and a field of stars that fades in after dusk. The gradient
 * is only repainted when the hour has moved by a few minutes of game time, so a still frame costs
 * nothing and a running game costs a 4x128 canvas redraw every few seconds.
 */
function buildSky(scene) {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(3400, 40, 24),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }),
  );
  dome.name = 'sky';
  dome.renderOrder = -20;
  dome.frustumCulled = false;
  scene.add(dome);

  const disc = new THREE.Mesh(
    new THREE.PlaneGeometry(560, 560),
    new THREE.MeshBasicMaterial({
      map: sunDisc(),
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    }),
  );
  disc.name = 'sun-disc';
  disc.renderOrder = -18;
  disc.frustumCulled = false;
  scene.add(disc);

  // Stars: a shell of points, sized small enough to read as dust rather than snow.
  const rand = stream(97);
  const count = 900;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const u = rand();
    const v = rand.between(0.02, 0.98);
    const theta = u * Math.PI * 2;
    const phi = Math.acos(1 - v);
    const r = 3000;
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi) * 0.9 + 60;
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(
    g,
    new THREE.PointsMaterial({ color: new THREE.Color('#dfe8ff'), size: 9, sizeAttenuation: true, transparent: true, opacity: 0.8, fog: false, depthWrite: false, toneMapped: false }),
  );
  stars.name = 'stars';
  stars.frustumCulled = false;
  stars.renderOrder = -19;
  scene.add(stars);

  let lastKey = '';
  let lastElev = -1;

  const sky = {
    dome,
    disc,
    stars,
    /** Repaint the gradient for this hour, if it has changed enough to be worth a redraw. */
    paint(rig) {
      const key = `${rig.skyTop}|${rig.skyHorizon}|${rig.fog}`;
      if (key !== lastKey) {
        lastKey = key;
        // The dome's texture is a vertical gradient with the zenith at the top row. The camera sits
        // near the ground and looks at the horizon, so the visible band is the upper half of the
        // dome only: the horizon colour belongs at row 64 and the zenith at row 0, or the whole sky
        // in frame would be one flat colour.
        const grad = ctx.createLinearGradient(0, 0, 0, 128);
        grad.addColorStop(0, rig.skyTop);
        grad.addColorStop(0.3, rig.skyTop);
        grad.addColorStop(0.44, rig.skyHorizon);
        grad.addColorStop(0.5, rig.fog);
        grad.addColorStop(1, rig.fog);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 4, 128);
        tex.needsUpdate = true;
      }
      dome.material.color.setScalar(1);
    },
    /** Put the sun's disc where the sun is, and let it sink out of sight. */
    aim(dx, dy, dz, rig) {
      disc.position.set(dx, dy, dz).normalize().multiplyScalar(2600);
      disc.lookAt(0, disc.position.y, 0);
      // The disc thickens as the sun approaches the horizon, the way a sunset does.
      const low = 1 - Math.min(1, Math.abs(dy) * 2.2);
      const size = 1 + low * 1.1;
      disc.scale.setScalar(size);
      disc.material.opacity = rig.sunDisc * (dy < -0.02 ? 0 : 1);
      disc.visible = rig.sunDisc > 0.02;
      disc.material.color.set(rig.sun);
      lastElev = dy;
    },
  };
  return sky;
}

// ---------------------------------------------------------------- ground

function layGround(town, plan) {
  // One tarmac plate under the whole town: the avenues and their crossings are its surface.
  const road = new Builder(new THREE.MeshLambertMaterial({ map: tarmac() }), { shadows: false });
  road.slab(ROAD_W - 2, ROAD_W - 2, ROAD_E + 2, ROAD_E + 2, 0, { tile: 22 });
  town.add(road.mesh('roadbed'));

  // Each block is a plate 0.3 m up on a kerb, ringed by a 0.6 m stone. A shop block's forecourt is
  // paved a little paler, the way a garage apron is.
  const walk = new Builder(new THREE.MeshLambertMaterial({ map: paving() }), { shadows: false });
  const forecourt = new Builder(new THREE.MeshLambertMaterial({ map: paving(), color: new THREE.Color('#f0e0cc') }), { shadows: false });
  const green = new Builder(new THREE.MeshLambertMaterial({ map: turf() }), { shadows: false });
  const stones = new Builder(new THREE.MeshLambertMaterial({ color: new THREE.Color(PAINT.kerb) }), { shadows: false });
  for (const b of plan.blocks) {
    if (b.kind === 'park') green.slab(b.x, b.z, b.x + b.w, b.z + b.h, 0.32, { tile: 9 });
    else if (b.kind === 'shop') forecourt.slab(b.x, b.z, b.x + b.w, b.z + b.h, 0.31, { tile: 7 });
    else walk.slab(b.x, b.z, b.x + b.w, b.z + b.h, 0.3, { tile: 7 });
    const t = 0.6;
    stones.box(b.x + b.w / 2, 0, b.z - t / 2, b.w + t * 2, 0.3, t, { tile: [4, 1] });
    stones.box(b.x + b.w / 2, 0, b.z + b.h + t / 2, b.w + t * 2, 0.3, t, { tile: [4, 1] });
    stones.box(b.x - t / 2, 0, b.z + b.h / 2, t, 0.3, b.h, { tile: [4, 1] });
    stones.box(b.x + b.w + t / 2, 0, b.z + b.h / 2, t, 0.3, b.h, { tile: [4, 1] });
  }
  town.add(walk.mesh('pavement'), forecourt.mesh('forecourts'), green.mesh('lawns'), stones.mesh('kerbs'));

  // The promenade: a pale walk between the west avenue and the sand, and the marina quay south.
  const prom = new Builder(new THREE.MeshLambertMaterial({ map: paving() }), { shadows: false });
  prom.slab(SHORE.promenade, ROAD_W, SHORE.kerb + 1, ROAD_E, 0.26, { tile: 8 });
  prom.slab(ROAD_W, SHORE.quay - 1, ROAD_E, SHORE.bay, 0.26, { tile: 8 });
  town.add(prom.mesh('promenade'));

  const beach = new Builder(new THREE.MeshLambertMaterial({ map: dune() }), { shadows: false });
  beach.slab(SHORE.water, ROAD_W - 150, SHORE.promenade, ROAD_E + 150, 0.08, { tile: 26 });
  town.add(beach.mesh('beach'));
}

// ---------------------------------------------------------------- paint on the road

/** Lane dashes, a gold centre line and zebra crossings at every junction arm. */
function paintLanes(town) {
  const flat = (colour, opacity) =>
    new Builder(new THREE.MeshBasicMaterial({ color: new THREE.Color(colour), toneMapped: false, transparent: true, opacity }), { shadows: false });
  const dashes = flat(PAINT.laneDash, 0.92);
  const centre = flat(PAINT.centre, 0.9);
  const zebra = flat(PAINT.crossing, 0.82);
  const dash = 3.4;
  const gap = 8.8;
  const lane = 5.3;
  const lines = AVENUES;

  const clearOfJunctions = (t) => !lines.some((line) => Math.abs(t - line) < KERB + 7);

  for (const line of lines) {
    for (let t = ROAD_W + 6; t < ROAD_E - 6; t += gap) {
      if (!clearOfJunctions(t)) continue;
      dashes.patch(t + dash / 2, line - lane, dash, 0.24, 0.025);
      dashes.patch(t + dash / 2, line + lane, dash, 0.24, 0.025);
      dashes.patch(line - lane, t + dash / 2, 0.24, dash, 0.025);
      dashes.patch(line + lane, t + dash / 2, 0.24, dash, 0.025);
    }
    for (let t = ROAD_W + 4; t < ROAD_E - 4; t += 1.4) {
      if (!clearOfJunctions(t)) continue;
      centre.patch(t, line - 0.55, 1.4, 0.17, 0.026);
      centre.patch(t, line + 0.55, 1.4, 0.17, 0.026);
      centre.patch(line - 0.55, t, 0.17, 1.4, 0.026);
      centre.patch(line + 0.55, t, 0.17, 1.4, 0.026);
    }
    for (const other of lines) {
      if (other === line) continue;
      for (let k = 0; k < 11; k += 1) {
        const off = -KERB + 5.5 + k * 8.2;
        zebra.patch(other + off, line - KERB - 4.8, 4.2, 5.2, 0.028);
        zebra.patch(other + off, line + KERB + 4.8, 4.2, 5.2, 0.028);
        zebra.patch(line - KERB - 4.8, other + off, 5.2, 4.2, 0.028);
        zebra.patch(line + KERB + 4.8, other + off, 5.2, 4.2, 0.028);
      }
    }
  }
  town.add(dashes.mesh('lane-dashes'), centre.mesh('centre-lines'), zebra.mesh('crossings'));
}

// ---------------------------------------------------------------- buildings

/**
 * The blocks. A building is a body whose facade texture is keyed on its wall colour, a window seed
 * and how lit it is; a cornice; sometimes a slimmer shaft out of a wide podium; a roof with plant on
 * it; and, at street level, a lit shopfront band with maybe a neon board above it and a pool of its
 * colour on the pavement under that.
 */
function raiseBlocks(town, plan, lights) {
  const rand = stream(1707);
  const storey = GRID.storey;
  const bodies = new Map();
  const boards = new Map();
  const roofs = new Builder(new THREE.MeshLambertMaterial({ color: new THREE.Color('#4b4254') }));
  const stone = new Builder(new THREE.MeshLambertMaterial({ color: new THREE.Color('#eee1cb') }));
  const shops = new Builder(new THREE.MeshBasicMaterial({ map: shopfront(3), toneMapped: false }), { shadows: false });
  const pools = new Builder(lights.lampPool, { shadows: false });
  const billboards = [];

  for (const b of plan.buildings) {
    const key = `${b.wall}|${b.seed % 6}|${b.lit.toFixed(2)}`;
    let body = bodies.get(key);
    if (!body) {
      const tex = facade(b.wall, b.seed, b.lit);
      const mat = new THREE.MeshLambertMaterial({
        map: tex.map,
        emissive: new THREE.Color('#ffffff'),
        emissiveMap: tex.glow,
        emissiveIntensity: 0.6,
        color: new THREE.Color(b.shade, b.shade, b.shade),
      });
      lights.windows.push(mat);
      body = new Builder(mat);
      bodies.set(key, body);
    }
    const cx = b.x + b.w / 2;
    const cz = b.z + b.d / 2;
    const lower = b.podium > 0 ? b.podium : b.height;
    body.box(cx, 0.3, cz, b.w, lower, b.d, { tile: [14, storey * 2] });
    stone.box(cx, lower + 0.3, cz, b.w + 0.6, 0.36, b.d + 0.6, { tile: [10, 1] });
    if (b.shaft) {
      body.box(cx, lower + 0.66, cz, b.shaft.w, b.height - lower, b.shaft.d, { tile: [14, storey * 2] });
      stone.box(cx, b.height + 0.66, cz, b.shaft.w + 0.5, 0.34, b.shaft.d + 0.5, { tile: [10, 1] });
    }
    const topW = b.shaft ? b.shaft.w : b.w;
    const topD = b.shaft ? b.shaft.d : b.d;
    roofs.box(cx, b.height + 0.92, cz, topW * 0.98, 0.5, topD * 0.98, { tile: [11, 2] });
    if (b.crown === 'box') roofs.box(b.x + b.w * 0.32, b.height + 1.42, b.z + b.d * 0.32, 4.6, 2.8, 3.8, { tile: [4, 2] });
    if (b.crown === 'ac') roofs.box(b.x + b.w * 0.68, b.height + 1.42, b.z + b.d * 0.7, 3.2, 1.3, 2.6, { tile: [3, 2] });
    if (b.crown === 'antenna') roofs.box(cx, b.height + 1.42, cz, 0.55, 9, 0.55, { tile: [2, 2] });

    // Street level: a lit band on the faces that meet a pavement, on the low buildings.
    if (b.floors <= 4 && !b.shop) {
      const bandH = 3.0;
      const y = 0.45;
      const bandW = Math.min(b.w - 3, 26);
      if (bandW >= 6) {
        const south = b.z + b.d + 0.08;
        const north = b.z - 0.08;
        shops.quad([cx - bandW / 2, y, south], [cx + bandW / 2, y, south], [cx + bandW / 2, y + bandH, south], [cx - bandW / 2, y + bandH, south], [[0, 0], [bandW / 8, 0], [bandW / 8, 1], [0, 1]], [0, 0, 1]);
        shops.quad([cx + bandW / 2, y, north], [cx - bandW / 2, y, north], [cx - bandW / 2, y + bandH, north], [cx + bandW / 2, y + bandH, north], [[bandW / 8, 0], [0, 0], [0, 1], [bandW / 8, 1]], [0, 0, -1]);
        shops.quad([b.x + b.w + 0.08, y, cz - bandW / 2], [b.x + b.w + 0.08, y, cz + bandW / 2], [b.x + b.w + 0.08, y + bandH, cz + bandW / 2], [b.x + b.w + 0.08, y + bandH, cz - bandW / 2], [[0, 0], [bandW / 8, 0], [bandW / 8, 1], [0, 1]], [1, 0, 0]);
        shops.quad([b.x - 0.08, y, cz + bandW / 2], [b.x - 0.08, y, cz - bandW / 2], [b.x - 0.08, y + bandH, cz - bandW / 2], [b.x - 0.08, y + bandH, cz + bandW / 2], [[0, 0], [bandW / 8, 0], [bandW / 8, 1], [0, 1]], [-1, 0, 0]);
      }
    }

    if (b.neon) {
      // The board faces the street it belongs to: the side of the building nearest an avenue. A
      // random face would put three boards in four on a blank flank, which is why a night shot down
      // an avenue came out dark — every sign was overhead and edge-on.
      const side = facingAvenue(b);
      const run = Math.min(b.w, b.d) * 0.78;
      const rise = Math.max(4.2, Math.min(11, b.height * 0.34));
      const y = Math.min(Math.max(4.0, b.height - rise - 0.6), 5.0 + rand() * 4.5);
      const boardKey = `${b.neon}:${b.seed % 5}`;
      let board = boards.get(boardKey);
      if (!board) {
        const mat = new THREE.MeshBasicMaterial({ map: neonBoard(b.neon, b.seed % 5), transparent: true, toneMapped: false, depthWrite: false });
        lights.neon.push(mat);
        board = new Builder(mat, { shadows: false });
        boards.set(boardKey, board);
      }
      const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
      if (side === 0) board.quad([cx - run / 2, y, b.z + b.d + 0.35], [cx + run / 2, y, b.z + b.d + 0.35], [cx + run / 2, y + rise, b.z + b.d + 0.35], [cx - run / 2, y + rise, b.z + b.d + 0.35], uv);
      if (side === 1) board.quad([cx + run / 2, y, b.z - 0.35], [cx - run / 2, y, b.z - 0.35], [cx - run / 2, y + rise, b.z - 0.35], [cx + run / 2, y + rise, b.z - 0.35], uv);
      if (side === 2) board.quad([b.x + b.w + 0.35, y, cz + run / 2], [b.x + b.w + 0.35, y, cz - run / 2], [b.x + b.w + 0.35, y + rise, cz - run / 2], [b.x + b.w + 0.35, y + rise, cz + run / 2], uv);
      if (side === 3) board.quad([b.x - 0.35, y, cz - run / 2], [b.x - 0.35, y, cz + run / 2], [b.x - 0.35, y + rise, cz + run / 2], [b.x - 0.35, y + rise, cz - run / 2], uv);
      const gx = side === 2 ? b.x + b.w + 4 : side === 3 ? b.x - 4 : cx;
      const gz = side === 0 ? b.z + b.d + 4 : side === 1 ? b.z - 4 : cz;
      if (b.floors > 2 && rand() < 0.5) pools.patch(gx, gz, run * 1.5, 9, 0.33, side < 2 ? 0 : Math.PI / 2);

      // A blade sign: a vertical board hung off the frontage and turned ninety degrees to the wall,
      // so its face looks straight down the avenue. This is the sign a driver actually reads, and
      // the one that makes a street of neon read at night from a camera three blocks away.
      const bladeThin = 0.4;
      const bladeRun = Math.min(6.2, Math.max(2.6, b.height * 0.2));
      const bladeY = 4.4;
      const outward = side === 0 ? { x: 0, z: 1 } : side === 1 ? { x: 0, z: -1 } : side === 2 ? { x: 1, z: 0 } : { x: -1, z: 0 };
      const along = side < 2 ? { x: 1, z: 0 } : { x: 0, z: 1 };
      const anchorX = side === 2 ? b.x + b.w + 1.6 : side === 3 ? b.x - 1.6 : cx + (rand() < 0.5 ? -1 : 1) * (b.w * 0.28);
      const anchorZ = side === 0 ? b.z + b.d + 1.6 : side === 1 ? b.z - 1.6 : cz + (rand() < 0.5 ? -1 : 1) * (b.d * 0.28);
      // Two faces, one on each side of a thin plate, both looking along the street.
      const f1 = [anchorX - along.x * bladeThin, anchorZ - along.z * bladeThin];
      const f2 = [anchorX + along.x * bladeThin, anchorZ + along.z * bladeThin];
      const top = bladeY + bladeRun;
      board.quad([f1[0], bladeY, f1[1]], [f2[0], bladeY, f2[1]], [f2[0], top, f2[1]], [f1[0], top, f1[1]], uv, [along.x, 0, along.z]);
      board.quad([f2[0], bladeY, f2[1]], [f1[0], bladeY, f1[1]], [f1[0], top, f1[1]], [f2[0], top, f2[1]], uv, [-along.x, 0, -along.z]);
      // The bracket, so the sign is hung rather than floating.
      stone.box(anchorX - outward.x * 0.8, top + 0.1, anchorZ - outward.z * 0.8, 0.22, 0.22, 0.22, { tile: [1, 1] });
      if (rand() < 0.7) pools.patch(anchorX + outward.x * 3.5, anchorZ + outward.z * 3.5, 10, 10, 0.34);
    }

    // A few roofs carry a billboard, tilted toward the street: the one thing at height that is lit
    // by day as well as by night.
    if (b.floors > 7 && b.crown !== 'antenna' && rand() < 0.12) {
      billboards.push({ b, cx, cz, colour: rand.pick(PAINT.neon), seed: rand.int(1, 9000), facing: rand.int(0, 3) });
    }
  }

  let n = 0;
  for (const body of bodies.values()) town.add(body.mesh(`facade-${n++}`));
  n = 0;
  for (const board of boards.values()) town.add(board.mesh(`neon-${n++}`));
  town.add(roofs.mesh('roofs'), stone.mesh('cornices'), shops.mesh('shopfronts'), pools.mesh('neon-spill'));

  for (const bill of billboards) {
    const w = Math.min(bill.b.w, bill.b.d) * 0.72;
    const mat = new THREE.MeshBasicMaterial({ map: billboard(bill.colour, bill.seed), toneMapped: false, side: THREE.DoubleSide });
    lights.neon.push(mat);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.5), mat);
    const y = bill.b.height + 1.2 + w * 0.28;
    const face = bill.facing;
    if (face === 0) {
      plane.position.set(bill.cx, y, bill.b.z + bill.b.d + 0.6);
    } else if (face === 1) {
      plane.position.set(bill.cx, y, bill.b.z - 0.6);
      plane.rotation.y = Math.PI;
    } else if (face === 2) {
      plane.position.set(bill.b.x + bill.b.w + 0.6, y, bill.cz);
      plane.rotation.y = Math.PI / 2;
    } else {
      plane.position.set(bill.b.x - 0.6, y, bill.cz);
      plane.rotation.y = -Math.PI / 2;
    }
    plane.name = `billboard-${bill.seed}`;
    town.add(plane);
  }
}

/**
 * Which of a building's four faces looks at a street: 0 is +z (south), 1 is -z (north), 2 is +x
 * (east), 3 is -x (west). The nearest avenue wins, so a sign hangs where a sign would be hung.
 */
function facingAvenue(b) {
  let bestSide = 0;
  let bestD = Infinity;
  for (const line of AVENUES) {
    // South face, then north, then east, then west: the first of the four that is closest wins.
    const south = Math.abs(b.z + b.d - line);
    const north = Math.abs(b.z - line);
    const east = Math.abs(b.x + b.w - line);
    const west = Math.abs(b.x - line);
    for (const [side, d] of [[0, south], [1, north], [2, east], [3, west]]) {
      if (d < bestD) {
        bestD = d;
        bestSide = side;
      }
    }
  }
  return bestSide;
}

/**
 * The three shops get a plate over the door with their name on it, and a lit awning under the
 * plate. The marker in the street is what the HUD paints; this is what tells the player which
 * frontage is which without reading the HUD at all.
 */
function signShops(town, plan) {
  for (const shop of plan.shops) {
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(13, 4.9),
      new THREE.MeshBasicMaterial({ map: shopSign(shop.name, shop.strap, shop.accent), transparent: true, toneMapped: false }),
    );
    plate.position.set(shop.x - shop.w / 2 - 0.3, 6.4, shop.z);
    plate.rotation.y = -Math.PI / 2;
    plate.name = `sign-${shop.id}`;
    town.add(plate);

    const awning = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.28, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(shop.accent), toneMapped: false }));
    awning.position.set(shop.x - shop.w / 2 - 1.4, 3.5, shop.z);
    town.add(awning);
    const spill = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 22),
      new THREE.MeshBasicMaterial({ map: glow(shop.accent), transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    );
    spill.rotation.x = -Math.PI / 2;
    spill.position.set(shop.x - shop.w / 2 - 5, 0.36, shop.z);
    town.add(spill);
  }
}

// ---------------------------------------------------------------- parks and palms

/**
 * The parks: a crossing of stone paths, a round fountain and a ring of palms. The promenade rank
 * and the pavement planters are planted here too, because a street without palms does not read as
 * this coast. Each crown is two crossed planes in one InstancedMesh.
 */
function plantPalms(town, plan) {
  const rand = stream(23);
  const paths = new Builder(new THREE.MeshLambertMaterial({ color: new THREE.Color('#dcc8ae') }), { shadows: false });
  const water = new Builder(new THREE.MeshLambertMaterial({ color: new THREE.Color('#5fb8c4') }), { shadows: false });
  const trunks = new Builder(new THREE.MeshLambertMaterial({ color: new THREE.Color('#7d5a3c') }));
  const crowns = [];

  const palm = (x, z, h, scale = 1) => {
    trunks.column(x, 0.3, z, 0.42 * scale, 0.24 * scale, h * 0.95, 5);
    crowns.push({ x, z, y: h * 0.95 + 0.3, scale: scale * (0.9 + rand() * 0.3), turn: rand() * 6.28 });
  };

  for (const park of plan.parks) {
    const cx = park.x + park.w / 2;
    const cz = park.z + park.h / 2;
    paths.box(cx, 0.34, cz, park.w, 0.025, 5.5, { tile: [6, 1] });
    paths.box(cx, 0.34, cz, 5.5, 0.025, park.h, { tile: [6, 1] });
    water.column(cx, 0.36, cz, 5.6, 5.6, 0.5, 14);
    paths.column(cx, 0.36, cz, 6.6, 6.0, 0.85, 14);
    for (let i = 0; i < park.palms; i += 1) {
      const a = (i / park.palms) * Math.PI * 2 + rand() * 0.5;
      const rad = (i % 2 === 0 ? 0.38 : 0.24) * park.w;
      const px = cx + Math.cos(a) * rad;
      const pz = cz + Math.sin(a) * rad;
      if (Math.abs(px - cx) < 9 && Math.abs(pz - cz) < 9) continue;
      palm(px, pz, 12 + rand() * 8);
    }
  }

  // The promenade rank, the beach scatter, and the row along the marina quay.
  for (let t = ROAD_W + 12; t < ROAD_E; t += 24) {
    palm(SHORE.promenade + 12, t, 12 + rand() * 7);
    if (Math.round(t / 24) % 2 === 0) palm(SHORE.sand + 24, t + 12, 11 + rand() * 6);
  }
  for (let t = ROAD_W + 16; t < CITY.last - KERB; t += 30) palm(t, SHORE.quay - 10, 12 + rand() * 6);

  // Pavement planters: the signature of this street, and what breaks up a wall of glass at eye
  // height.
  for (const b of plan.blocks) {
    if (b.kind === 'park') continue;
    for (let t = b.z + 6; t < b.z + b.h - 4; t += 26) {
      palm(b.x + 4.2, t, 11 + rand() * 6);
      palm(b.x + b.w - 4.2, t + 13, 11 + rand() * 6);
    }
    for (let t = b.x + 10; t < b.x + b.w - 6; t += 30) {
      if (rand() < 0.55) palm(t, b.z + 4.2, 10 + rand() * 5);
    }
  }

  town.add(paths.mesh('park-paths'), water.mesh('fountains'), trunks.mesh('palm-trunks'));

  const inst = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshLambertMaterial({ map: fronds(), transparent: true, alphaTest: 0.32, side: THREE.DoubleSide }),
    crowns.length * 2,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const v = new THREE.Vector3();
  const e = new THREE.Euler();
  crowns.forEach((crown, i) => {
    for (let k = 0; k < 2; k += 1) {
      const size = 10 * crown.scale;
      e.set(-Math.PI / 2 + 0.12, crown.turn + k * Math.PI * 0.5, 0);
      q.setFromEuler(e);
      v.set(crown.x, crown.y, crown.z);
      s.set(size, size, size);
      m.compose(v, q, s);
      inst.setMatrixAt(i * 2 + k, m);
    }
  });
  inst.instanceMatrix.needsUpdate = true;
  inst.name = 'palm-crowns';
  inst.frustumCulled = false;
  town.add(inst);
}

// ---------------------------------------------------------------- water

function floodBay(town) {
  const ripple = ripples();
  ripple.repeat.set(46, 46);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(7000, 7000),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PAINT.water), roughness: 0.16, metalness: 0.5, map: ripple }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(-1600, -0.5, 1500);
  sea.name = 'sea';
  town.add(sea);

  // The sun's track across the bay, and the surf line where the sand meets the water.
  const track = new THREE.Mesh(
    new THREE.PlaneGeometry(110, 3200),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffcf9a'), transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  track.rotation.x = -Math.PI / 2;
  track.position.set(-1250, -0.3, 1200);
  track.name = 'sea-track';
  town.add(track);

  const surf = new THREE.Mesh(
    new THREE.PlaneGeometry(6, ROAD_E - ROAD_W + 500),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#e2f8f2'), transparent: true, opacity: 0.48 }),
  );
  surf.rotation.x = -Math.PI / 2;
  surf.position.set(SHORE.water - 2, -0.2, (ROAD_W + ROAD_E) / 2);
  town.add(surf);

  return sea;
}

// ---------------------------------------------------------------- street furniture

/** Lamp posts with a lit head and a pool of light beneath, hydrants, benches, moored hulls, the pier. */
function furnish(town, plan, lights) {
  const rand = stream(51);
  const posts = new Builder(new THREE.MeshLambertMaterial({ color: new THREE.Color('#3b3946') }));
  const hydrants = new Builder(new THREE.MeshLambertMaterial({ color: new THREE.Color('#e8483f') }));
  const benches = new Builder(new THREE.MeshLambertMaterial({ color: new THREE.Color('#8a6a4a') }));
  const heads = new Builder(lights.lampHead, { shadows: false });
  const pools = new Builder(lights.lampPool, { shadows: false });

  for (const b of plan.blocks) {
    posts.column(b.x + 5, 0.3, b.z + 5, 0.15, 0.1, 7.6, 5);
    heads.box(b.x + 5, 7.6, b.z + 5, 0.5, 0.4, 0.5, { tile: [1, 1] });
    pools.patch(b.x + 5, b.z + 5, 15, 15, 0.325);
    posts.column(b.x + b.w - 5, 0.3, b.z + b.h - 5, 0.15, 0.1, 7.6, 5);
    heads.box(b.x + b.w - 5, 7.6, b.z + b.h - 5, 0.5, 0.4, 0.5, { tile: [1, 1] });
    pools.patch(b.x + b.w - 5, b.z + b.h - 5, 15, 15, 0.325);
    if (rand() < 0.55) hydrants.column(b.x + b.w * 0.5, 0.3, b.z + 3.4, 0.32, 0.26, 0.9, 6);
    if (b.kind === 'park') {
      for (let i = 0; i < 3; i += 1) benches.box(b.x + b.w * 0.5, 0.42, b.z + 12 + i * 20, 1.9, 0.45, 0.5, { tile: [2, 1] });
    }
  }

  const hulls = new Builder(new THREE.MeshLambertMaterial({ color: new THREE.Color('#f2efe6') }));
  const decks = new Builder(new THREE.MeshLambertMaterial({ color: new THREE.Color('#c8a27a') }), { shadows: false });
  for (let i = 0; i < 11; i += 1) {
    const x = 280 + i * 200;
    const z = ROAD_E + 22 + (i % 2) * 14;
    hulls.turned(x, -0.4, z, 6, 2.4, 17, 0.02 * i, null, [4, 2]);
    hulls.turned(x, 2.0, z - 2.4, 3.6, 1.7, 5.4, 0.02 * i, null, [3, 2]);
  }
  decks.turned(2380, 0.4, ROAD_E + 110, 6.5, 0.4, 176, 0, null, [4, 4]);
  decks.turned(2380, 0.4, ROAD_E + 200, 44, 0.4, 7, 0, null, [4, 4]);
  for (let i = 0; i < 10; i += 1) posts.column(2380 + (i % 2 ? 3.2 : -3.2), -1.2, ROAD_E + 30 + i * 16, 0.22, 0.2, 3.4, 5);
  posts.column(-180, -0.6, ROAD_E + 288, 3.4, 1.9, 19, 10);
  heads.box(-180, 18.4, ROAD_E + 288, 2.8, 1.8, 2.8, { tile: [1, 1] });

  town.add(posts.mesh('lamp-posts'), heads.mesh('lamp-heads'), pools.mesh('lamp-pools'), hydrants.mesh('hydrants'), benches.mesh('benches'), hulls.mesh('boat-hulls'), decks.mesh('pier'));
}

/**
 * The stunt ramp: a wedge on the Strip with chevrons up its face and a lit lip, in the middle of the
 * boulevard so a car arriving at speed has a straight run at it. plan.ramp is what the simulation
 * reads to decide who is airborne.
 */
function buildRamp(town, plan) {
  const ramp = { x: -11, z: 1420, w: 14, run: 26, rise: 4.6, heading: Math.PI };
  plan.ramp = ramp;
  const deck = new Builder(new THREE.MeshLambertMaterial({ color: new THREE.Color('#2b2b38') }));
  deck.wedge(ramp.x, ramp.z, ramp.w, ramp.run, ramp.rise, ramp.heading, null);
  // Chevrons: pale bars laid up the run, so the ramp reads as a ramp from the chase camera.
  const paint = new Builder(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd23c'), toneMapped: false }), { shadows: false });
  for (let i = 0; i < 7; i += 1) {
    const t = i / 6;
    const dz = ramp.run / 2 - t * ramp.run * 0.92;
    const y = t * ramp.rise + 0.06;
    paint.patch(ramp.x, ramp.z + dz * -1, ramp.w * 0.78, 1.1, y, 0);
  }
  // The lip, lit so it is visible at night from a long way down the road.
  const lip = new Builder(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a30'), toneMapped: false }), { shadows: false });
  lip.box(ramp.x, ramp.rise, ramp.z + ramp.run / 2, ramp.w, 0.5, 0.7, { tile: [4, 1] });
  town.add(deck.mesh('stunt-ramp'), paint.mesh('ramp-chevrons'), lip.mesh('ramp-lip'));
  plan.ramp.surface = ramp;
  return ramp;
}

export { WALK };
