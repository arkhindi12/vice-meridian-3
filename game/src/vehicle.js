// vehicle.js — the shape of every car, the name it wears, and how it looks when it dies.
//
// One merged geometry per (kind, paint) pair, built on first sight and cached. Paint, glass, trim,
// tyres and rims live as vertex colours inside one buffer, so a car costs two draw calls — body and
// lamps — rather than a dozen. The lamps stay separate because a brake light changes brightness at
// runtime and a merged buffer cannot.
//
// Every model has a name, because the speedometer shows one: the marque is the fiction the player
// reads at 140 km/h.
//
// The damage dressing lives here too, because it is the same car seen later: a headlight plane on
// the road for the light rig to turn up after dark, a black body material a wreck swaps to, and the
// scorch ring it leaves. The behaviour — how much condition a crash costs, when it burns, when it
// goes up — is damage.js.
//
// A model is built facing local +z. A car's heading is measured from +x, so its group is turned by
// PI/2 - heading. That quarter turn is why every car in the city drives nose-first.

import * as THREE from '../vendor/three/three.module.min.js';
import { Builder } from './meshkit.js';
import { glow } from './textures.js';

/**
 * The shapes. `sill` is the lower body, `deck` the bonnet and boot, `cabin` the greenhouse, `roof`
 * the total height and `cabinLen` the cabin's share of the length. `top` is the cruise band a
 * driver of this kind holds.
 */
export const SHAPES = {
  sedan: { len: 4.6, wid: 1.94, sill: 0.5, deck: 0.34, cabin: 0.6, cabinLen: 0.52, roof: 0.86, top: [15, 22], model: 'MARLIN 4' },
  coupe: { len: 4.4, wid: 1.9, sill: 0.44, deck: 0.3, cabin: 0.48, cabinLen: 0.46, roof: 0.78, top: [17, 25], model: 'VESPERA GT' },
  drop: { len: 4.7, wid: 1.92, sill: 0.42, deck: 0.26, cabin: 0.16, cabinLen: 0.38, roof: 0.62, top: [19, 27], model: 'VESPERA GT S' },
  suv: { len: 5.2, wid: 2.1, sill: 0.64, deck: 0.56, cabin: 0.62, cabinLen: 0.6, roof: 1.14, top: [14, 20], model: 'CORSARO V8' },
  cab: { len: 4.8, wid: 1.96, sill: 0.5, deck: 0.32, cabin: 0.6, cabinLen: 0.54, roof: 0.9, top: [14, 21], model: 'MARLIN T' },
  van: { len: 5.6, wid: 2.14, sill: 0.68, deck: 1.14, cabin: 0.5, cabinLen: 0.44, roof: 1.2, top: [12, 17], model: 'CORSARO VAN' },
  cruiser: { len: 4.9, wid: 2.02, sill: 0.52, deck: 0.34, cabin: 0.64, cabinLen: 0.5, roof: 0.92, top: [22, 32], model: 'SOLEIL P7' },
};

export const TAXI_YELLOW = '#ffcc33';
export const CRUISER_WHITE = '#f2f3f5';

const shapes = new Map();

/** The body material alive cars share; a wreck swaps in its own black one. */
const paintMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.44, metalness: 0.28 });

function tint(hex) {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

/** A wheel: an eight-sided cylinder on the x axis with a hub disc at each end. */
function wheel(build, cx, cy, cz, radius, width, rubber, hub) {
  const sides = 8;
  for (let i = 0; i < sides; i += 1) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const y0 = cy + Math.cos(a0) * radius;
    const z0 = cz + Math.sin(a0) * radius;
    const y1 = cy + Math.cos(a1) * radius;
    const z1 = cz + Math.sin(a1) * radius;
    const n = [0, Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2)];
    build.quad([cx - width / 2, y0, z0], [cx + width / 2, y0, z0], [cx + width / 2, y1, z1], [cx - width / 2, y1, z1], [[0, 0], [1, 0], [1, 1], [0, 1]], n, rubber);
  }
  const r2 = radius * 0.52;
  for (const sx of [-1, 1]) {
    const x = cx + (sx * width) / 2 + sx * 0.01;
    build.quad([x, cy - r2, cz + r2], [x, cy - r2, cz - r2], [x, cy + r2, cz - r2], [x, cy + r2, cz + r2], [[0, 0], [1, 0], [1, 1], [0, 1]], [sx, 0, 0], hub);
  }
}

/** The merged geometry for one car kind in one paint: { body, lamps, shape }. */
export function carve(kind, paintHex) {
  const cacheKey = `${kind}|${paintHex}`;
  const known = shapes.get(cacheKey);
  if (known) return known;

  const k = SHAPES[kind] ?? SHAPES.sedan;
  const body = new Builder(paintMaterial, { shadows: true, tinted: true });
  const lamps = new Builder(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), { shadows: false, tinted: true });

  const paint = tint(paintHex);
  const glass = tint('#152436');
  const trim = tint('#191920');
  const rubber = tint('#0f0f14');
  const hub = tint('#c9d2dc');
  const head = tint('#fff4d4');
  const tail = tint('#8a1220');

  const floor = 0.34;
  const deckTop = floor + k.sill;
  body.box(0, floor, 0, k.wid, k.sill, k.len, { tile: [3, 2], colour: paint });
  body.box(0, deckTop, k.len * 0.3, k.wid * 0.94, k.deck, k.len * 0.34, { tile: [3, 2], colour: paint });

  if (kind === 'drop') {
    // A drop-top: no greenhouse. A raked screen across the cockpit, two seat backs above the sill,
    // and a tonneau behind them where the roof would fold.
    body.box(0, deckTop + k.deck, k.len * 0.1, k.wid * 0.84, 0.34, 0.1, { tile: [3, 1], colour: glass });
    for (const sx of [-1, 1]) {
      body.box(sx * k.wid * 0.22, deckTop + 0.1, -k.len * 0.02, k.wid * 0.34, 0.34, 0.16, { tile: [2, 2], colour: trim });
      body.box(sx * k.wid * 0.22, deckTop + 0.05, -k.len * 0.14, k.wid * 0.34, 0.16, 0.34, { tile: [2, 2], colour: paint });
    }
    body.box(0, deckTop + 0.06, -k.len * 0.26, k.wid * 0.9, 0.14, k.len * 0.2, { tile: [3, 1], colour: paint });
  } else {
    body.box(0, deckTop + k.deck - 0.02, -k.len * 0.04, k.wid * 0.82, k.cabin, k.len * k.cabinLen, { tile: [3, 2], colour: glass });
  }

  const roofBase = deckTop + k.deck + k.cabin;
  if (kind !== 'drop' && k.roof > k.cabin + k.deck + k.sill) {
    body.box(0, roofBase, -k.len * 0.04, k.wid * 0.84, k.roof - (roofBase - floor), k.len * k.cabinLen * 0.92, { tile: [3, 2], colour: paint });
  }

  body.box(0, floor + 0.02, 0, k.wid * 0.92, 0.16, k.len * 0.94, { tile: [3, 1], colour: trim });
  body.box(0, floor + 0.06, k.len / 2 - 0.06, k.wid * 0.98, 0.2, 0.14, { tile: [3, 1], colour: trim });
  body.box(0, floor + 0.06, -k.len / 2 + 0.06, k.wid * 0.98, 0.2, 0.14, { tile: [3, 1], colour: trim });

  const radius = kind === 'suv' || kind === 'van' ? 0.4 : 0.33;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      wheel(body, (sx * k.wid) / 2 - sx * 0.04, radius, (sz * k.len) / 2.5, radius, 0.24, rubber, hub);
    }
  }

  for (const sx of [-1, 1]) {
    lamps.box(sx * k.wid * 0.31, floor + k.sill * 0.72, k.len / 2 + 0.02, 0.36, 0.14, 0.05, { tile: [1, 1], colour: head });
    lamps.box(sx * k.wid * 0.31, floor + k.sill * 0.8, -k.len / 2 - 0.02, 0.34, 0.13, 0.05, { tile: [1, 1], colour: tail });
  }
  if (kind === 'cab') lamps.box(0, floor + k.roof + 0.14, -k.len * 0.04, 0.66, 0.18, 0.28, { tile: [1, 1], colour: tint('#ffd23c') });

  const built = { body: body.geometry(), lamps: lamps.geometry(), shape: k };
  shapes.set(cacheKey, built);
  return built;
}

/** The blackened material a wreck wears: the same vertex colours, most of the light taken out. */
const wreckMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, color: new THREE.Color('#241d1c'), roughness: 0.94, metalness: 0.08 });

/**
 * A car mesh: body, lamps, and the headlight pool that lies on the road ahead of it. All three hang
 * off one group, so posing the car poses its light.
 */
export function assemble(kind, paintHex) {
  const geo = carve(kind, paintHex);
  const group = new THREE.Group();
  const body = new THREE.Mesh(geo.body, paintMaterial);
  body.castShadow = true;
  body.receiveShadow = false;
  const lamps = new THREE.Mesh(geo.lamps, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  lamps.castShadow = false;

  // The headlight: a long soft cone of light lying on the tarmac, drawn additively so it reads as
  // spill and not as paint. Its opacity is the day/night rig's.
  const beam = new THREE.Mesh(
    new THREE.PlaneGeometry(9.5, 26),
    new THREE.MeshBasicMaterial({
      map: glow('#ffe9c0'),
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  beam.rotation.x = -Math.PI / 2;
  beam.position.set(0, 0.08, geo.shape.len / 2 + 11);
  beam.renderOrder = 3;
  beam.name = 'headlight';

  group.add(body, lamps, beam);
  return { group, body, lamps, beam, shape: geo.shape };
}

/**
 * Dress a cruiser: navy flank panels, a roof bar with a red and a blue lamp, a halo round each and
 * a pool of coloured light on the road. Returns the parts the frame loop flashes.
 */
export function outfitCruiser(mesh) {
  const k = mesh.shape;
  const top = 0.34 + k.sill + k.deck + k.cabin;
  const livery = new Builder(new THREE.MeshLambertMaterial({ color: new THREE.Color('#1b2b57') }), { shadows: false });
  for (const sx of [-1, 1]) {
    livery.box(sx * (k.wid / 2 + 0.02), 0.72, -0.1, 0.04, 0.34, k.len * 0.66, { tile: [2, 1] });
    livery.box(sx * (k.wid / 2 + 0.05), 0.86, 0.5, 0.03, 0.5, 1.5, { tile: [1, 1] });
  }

  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.11, 0.34), new THREE.MeshLambertMaterial({ color: new THREE.Color('#141419') }));
  bar.position.set(0, top + 0.06, -0.1);

  const beacon = (colour, x) => {
    const g = new THREE.Group();
    const light = new THREE.Color(colour);
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.19, 0.3), new THREE.MeshBasicMaterial({ color: light.clone(), toneMapped: false, transparent: true }));
    // Two camera-facing sprites: a tight one where the lamp is, and a soft wide one that carries
    // the colour across the street. A plane would vanish edge-on; a sprite never does.
    const spark = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glow(colour),
        color: light.clone(),
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        fog: false,
      }),
    );
    spark.scale.set(2.6, 2.6, 1);
    const flare = new THREE.Sprite(spark.material.clone());
    flare.material.opacity = 0.4;
    flare.scale.set(8.2, 8.2, 1);
    spark.renderOrder = 8;
    flare.renderOrder = 7;
    g.add(core, spark, flare);
    g.position.set(x, top + 0.2, -0.1);
    g.userData.light = { core, spark, flare };
    return g;
  };
  const red = beacon('#ff2a48', -0.34);
  const blue = beacon('#3d7bff', 0.34);

  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(15, 10),
    new THREE.MeshBasicMaterial({ map: glow('#ff3355'), transparent: true, opacity: 0.34, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.06;
  pool.renderOrder = 2;

  mesh.group.add(livery.mesh('livery'), bar, red, blue, pool);
  return { red, blue, pool };
}

/** Put a car group at a position and a heading, remembering the model's quarter turn. */
export function park(group, x, z, yaw) {
  group.position.set(x, 0, z);
  group.rotation.y = Math.PI / 2 - yaw;
}

/** The name on the speedometer for a car. */
export function modelName(car) {
  return SHAPES[car.kind]?.model ?? 'MARLIN 4';
}

/** Blacken a car: swap in the wreck material and kill its headlights. */
export function char(mesh) {
  if (!mesh) return;
  if (mesh.body) mesh.body.material = wreckMaterial;
  if (mesh.beam) {
    mesh.beam.material.opacity = 0;
    mesh.beam.visible = false;
  }
}

/** The body height of a car kind, so a fire sits on its roof rather than at its wheels. */
export function bodyTop(car) {
  const k = SHAPES[car.kind] ?? SHAPES.sedan;
  return 0.34 + k.roof;
}
