// damage.js — condition, smoke, fire, the explosion, the wreck and the scorch mark.
//
// Every car in the city carries a condition from 100 down to 0. Collisions and pistol rounds take it
// down; the thresholds are the ones in units.js DAMAGE, so the HUD, the fire and the engine note can
// never disagree about when a car is in trouble:
//
//   above 25%   running normally
//   below 25%   the engine coughs: slow grey smoke out of the bonnet
//   below 15%   it burns: flame and heavy black smoke, and the fire spreads to a car parked close
//   at 0%       it EXPLODES — a flash, a burst of debris, a scorch mark, and a blackened hull that
//               keeps smoking where it died
//
// The explosion is the one event in the game that reaches past its own car: it throws a light, it
// burns whatever is within DAMAGE.chain metres, it kills a pedestrian or an officer standing in the
// ring, it hurts the player, and if the player is in the car that went up, that is a wasted screen.
//
// Everything here is a record plus up to four meshes per car — smoke, flame, scorch, debris — and
// all of them are built lazily, so a healthy car costs nothing but its number.

import * as THREE from '../vendor/three/three.module.min.js';
import { DAMAGE } from './units.js';
import { stream } from './random.js';

/** What a burnt car is painted with: the same vertex colours, most of the light taken out. */
const WRECK_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  color: new THREE.Color('#241d1c'),
  roughness: 0.94,
  metalness: 0.08,
});

const SMOKE_PUFFS = 16;
const FLAME_TONGUES = 9;
const DEBRIS_BITS = 14;

/** A pool of soft additive/normal quads that one emitter can recycle: smoke, flame, debris. */
function puffPool(scene, count, colour, { additive = false, size = 1, opacity = 0.5 } = {}) {
  const group = new THREE.Group();
  group.name = 'fx-pool';
  scene.add(group);
  const items = [];
  for (let i = 0; i < count; i += 1) {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colour),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    mesh.visible = false;
    mesh.renderOrder = additive ? 9 : 8;
    group.add(mesh);
    items.push({ mesh, mat, life: 0, max: 1, vx: 0, vy: 0, vz: 0, spin: 0, grow: 1, base: opacity });
  }
  let next = 0;
  return {
    group,
    items,
    /** Emit one puff at a point. */
    emit(x, y, z, { life = 1, scale = 1, rise = 1, spread = 0.4, opacity = opacity } = {}) {
      const p = items[next];
      next = (next + 1) % items.length;
      p.mesh.visible = true;
      p.mesh.position.set(x + (Math.random() - 0.5) * spread, y, z + (Math.random() - 0.5) * spread);
      p.mesh.scale.setScalar(scale);
      p.life = life;
      p.max = life;
      p.vx = (Math.random() - 0.5) * 0.8;
      p.vy = rise * (0.6 + Math.random() * 0.7);
      p.vz = (Math.random() - 0.5) * 0.8;
      p.spin = (Math.random() - 0.5) * 2;
      p.grow = 1 + Math.random() * 0.8;
      p.base = opacity;
      p.mat.opacity = opacity;
      return p;
    },
    /** Advance every puff; a dead puff hides itself. */
    tick(dt, camera) {
      for (const p of items) {
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.mesh.visible = false;
          p.mat.opacity = 0;
          continue;
        }
        const t = 1 - p.life / p.max;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        p.vy += 0.35 * dt;
        const s = p.mesh.scale.x + p.grow * dt * 2.4;
        p.mesh.scale.setScalar(s);
        p.mat.opacity = p.base * (1 - t) * (1 - t);
        if (camera) p.mesh.quaternion.copy(camera.quaternion);
        else p.mesh.rotation.z += p.spin * dt;
      }
    },
    hide() {
      for (const p of items) {
        p.life = 0;
        p.mesh.visible = false;
      }
    },
  };
}

export class DamageSystem {
  constructor(scene) {
    this.scene = scene;
    this.smoke = puffPool(scene, SMOKE_PUFFS, '#3a3a40', { size: 3.4, opacity: 0.4 });
    this.fire = puffPool(scene, FLAME_TONGUES, '#ff8a2a', { additive: true, size: 2.6, opacity: 0.7 });
    this.debris = puffPool(scene, DEBRIS_BITS, '#221c1a', { size: 0.9, opacity: 0.95 });
    this.sparks = puffPool(scene, 18, '#ffe6a0', { additive: true, size: 1.6, opacity: 0.9 });

    // The flash: one big additive sprite, reused by every explosion in the session.
    this.flash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: new THREE.Color('#ffd9a0'),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        fog: false,
      }),
    );
    this.flash.name = 'explosion-flash';
    this.flash.renderOrder = 12;
    this.flash.visible = false;
    scene.add(this.flash);
    this.flashT = 0;

    // The scorch: a dark star burnt into the tarmac, one mesh per explosion, and they stay.
    this.scorches = [];
    this.rand = stream(7331);
    this.events = { onBoom: null };
    this.debrisBits = [];
    this.debrisT = 0;
  }

  /**
   * Take condition off a car. `reason` is 'crash' or 'round'; the caller has already worked out the
   * amount. Returns true if this hit was the one that killed it.
   */
  hit(car, amount) {
    if (!car || car.wrecked) return false;
    car.condition = Math.max(0, car.condition - Math.max(0, amount));
    if (car.condition <= 0) {
      this.explode(car);
      return true;
    }
    return false;
  }

  /** A collision: the closing speed decides the damage, with a floor so a nudge is still a nudge. */
  crash(car, closing) {
    if (!car || car.wrecked) return 0;
    const amount = Math.max(1.2, closing * DAMAGE.ram * 3.2);
    this.hit(car, amount);
    return amount;
  }

  /**
   * Blow a car up. The flash, the debris, the scorch, the black hull, the chain to its neighbours and
   * the shock to anybody standing in the ring are all here, in that order, and the car is left where
   * it died: stopped, on fire, smoking.
   */
  explode(car, world = null) {
    if (car.wrecked) return;
    car.wrecked = true;
    car.condition = 0;
    car.speed = 0;
    car.fireT = 0;
    car.smokeT = 0;
    // Blacken it: the body takes the wreck material and the headlights go out. The car record carries
    // its own meshes, so this is the only place that has to know what a burnt car looks like.
    if (car.mesh?.body) car.mesh.body.material = WRECK_MATERIAL;
    if (car.mesh?.beam) {
      car.mesh.beam.material.opacity = 0;
      car.mesh.beam.visible = false;
    }
    // The wreck sits a little lower, on its rims.
    if (car.mesh?.group) {
      car.mesh.group.position.y = -0.16;
      car.mesh.group.rotation.z = 0.03;
    }

    const x = car.x;
    const z = car.z;
    const y = 1.2;

    // The flash: a hot core that is gone in a quarter of a second.
    this.flash.position.set(x, y + 1.2, z);
    this.flash.scale.setScalar(1);
    this.flash.material.opacity = 1;
    this.flash.visible = true;
    this.flashT = 0.34;

    // The burst: fire, smoke and debris, all thrown from the same point.
    for (let i = 0; i < 10; i += 1) {
      this.fire.emit(x, y + 0.6, z, { life: 0.7 + this.rand() * 0.6, scale: 2.4 + this.rand() * 2.6, rise: 5.5, spread: 2.2, opacity: 0.85 });
    }
    for (let i = 0; i < 8; i += 1) {
      this.smoke.emit(x, y + 1.0, z, { life: 2.6 + this.rand() * 1.8, scale: 3.6 + this.rand() * 3.2, rise: 3.2, spread: 2.6, opacity: 0.5 });
    }
    for (let i = 0; i < 12; i += 1) {
      const a = this.rand() * Math.PI * 2;
      const up = 4 + this.rand() * 8;
      const out = 3 + this.rand() * 8;
      this.debris.emit(x, y, z, { life: 1.1 + this.rand() * 0.9, scale: 0.5 + this.rand() * 0.9, rise: 0.6, spread: 0.4, opacity: 0.95 });
      const p = this.debris.items[(this.debris.items.length - 1) % this.debris.items.length];
      p.vx = Math.cos(a) * out;
      p.vz = Math.sin(a) * out;
      p.vy = up;
      p.grow = 0.2;
    }
    for (let i = 0; i < 10; i += 1) {
      const a = this.rand() * Math.PI * 2;
      this.sparks.emit(x, y + 0.4, z, { life: 0.35 + this.rand() * 0.35, scale: 0.8 + this.rand(), rise: 0.2, spread: 0.6, opacity: 0.9 });
      const p = this.sparks.items[(this.sparks.items.length - 1) % this.sparks.items.length];
      p.vx = Math.cos(a) * (9 + this.rand() * 12);
      p.vz = Math.sin(a) * (9 + this.rand() * 12);
      p.vy = 3 + this.rand() * 7;
      p.grow = 0.4;
    }

    this.scorch(x, z, car.yaw ?? 0, world);
    this.events.onBoom?.(car, x, z);
  }

  /** A burnt ring of tarmac. Kept in a list so a city full of wrecks is a city full of marks. */
  scorch(x, z, yaw = 0, world = null) {
    const r = DAMAGE.scorchRadius;
    const geo = new THREE.CircleGeometry(r, 20);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#0d0b10'),
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = yaw;
    mesh.position.set(x, 0.045, z);
    mesh.renderOrder = 1;
    mesh.name = 'scorch';
    this.scene.add(mesh);
    this.scorches.push({ mesh, t: 0 });
    // A second, paler ring outside it, so the mark has a lip where the paint bubbled.
    const halo = new THREE.Mesh(new THREE.CircleGeometry(r * 1.35, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color('#3a2a24'), transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false }));
    halo.rotation.copy(mesh.rotation);
    halo.position.set(x, 0.04, z);
    halo.renderOrder = 1;
    this.scene.add(halo);
    void world;
  }

  /**
   * One step. Emits smoke and flame from every damaged car, bleeds the flash, keeps burning cars
   * losing condition until they go, and lets a fire reach its neighbours.
   */
  tick(dt, cars, camera, world = null, onChain = null) {
    for (const car of cars) {
      if (!car) continue;
      if (car.wrecked) {
        // A wreck smokes for a while and then only glows.
        car.smokeT = (car.smokeT ?? 0) + dt;
        if (car.smokeT > 0.22) {
          car.smokeT = 0;
          const top = 1.1;
          this.smoke.emit(car.x, top, car.z, { life: 2.2 + this.rand(), scale: 1.6 + this.rand(), rise: 1.8, spread: 1.2, opacity: 0.34 });
        }
        if ((car.fireT ?? 999) < 900) {
          car.fireT += dt;
          if (car.fireT < 5 && this.rand() < 0.35) {
            this.fire.emit(car.x, 1.0, car.z, { life: 0.4 + this.rand() * 0.4, scale: 1.1 + this.rand(), rise: 2.2, spread: 1.1, opacity: 0.55 });
          }
        }
        continue;
      }

      // A burning car loses the rest of its condition on the DAMAGE.burnTime clock, so the
      // explosion is inevitable but not instant: the player can still get out and run.
      if (car.condition < DAMAGE.fireAt) {
        car.burning = true;
        car.condition = Math.max(0, car.condition - (DAMAGE.max / DAMAGE.burnTime) * dt * 0.06);
      } else {
        car.burning = false;
      }

      const top = 1.15;
      if (car.condition < DAMAGE.smokeAt) {
        car.smokeT = (car.smokeT ?? 0) + dt;
        const rate = car.condition < DAMAGE.fireAt ? 0.06 : 0.16;
        if (car.smokeT > rate) {
          car.smokeT = 0;
          this.smoke.emit(car.x, top, car.z, {
            life: 1.4 + this.rand() * 0.8,
            scale: 0.8 + this.rand() * 0.6,
            rise: 1.4,
            spread: 0.6,
            opacity: car.condition < DAMAGE.fireAt ? 0.55 : 0.3,
          });
          if (car.condition < DAMAGE.fireAt) {
            this.fire.emit(car.x + (this.rand() - 0.5) * 0.8, top - 0.1, car.z + (this.rand() - 0.5) * 0.8, {
              life: 0.32 + this.rand() * 0.36,
              scale: 0.9 + this.rand() * 0.7,
              rise: 2.6,
              spread: 0.5,
              opacity: 0.75,
            });
          }
        }
      }

      if (car.condition <= 0 && !car.wrecked) this.explode(car, world);

      // A fire spreads: any car within the chain radius catches, which is how a pile-up becomes a car
      // park full of fire. The callback is only the announcement; the spread itself always happens.
      if (car.burning) {
        for (const other of cars) {
          if (other === car || !other || other.wrecked || other.burning) continue;
          if (other.condition < DAMAGE.fireAt) continue;
          if (Math.hypot(other.x - car.x, other.z - car.z) < DAMAGE.chain) {
            other.condition = Math.min(other.condition, DAMAGE.fireAt - 1);
            onChain?.(car, other);
          }
        }
      }
    }

    this.smoke.tick(dt, camera);
    this.fire.tick(dt, camera);
    this.debris.tick(dt, null);
    this.sparks.tick(dt, null);

    if (this.flashT > 0) {
      this.flashT -= dt;
      const t = Math.max(0, this.flashT / 0.34);
      this.flash.material.opacity = t * t;
      this.flash.scale.setScalar(1 + (1 - t) * 16);
      if (this.flashT <= 0) this.flash.visible = false;
    }
  }

  /** How much fire is in the world, for the audio bus: 0 quiet, 1 several cars alight. */
  intensity(cars) {
    let n = 0;
    for (const car of cars) if (car && (car.burning || car.wrecked)) n += 1;
    return Math.min(1, n / 4);
  }
}

/** The soft radial texture the flash uses; kept local so damage.js needs no texture imports. */
function glowTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,250,1)');
  grad.addColorStop(0.2, 'rgba(255,236,190,0.95)');
  grad.addColorStop(0.55, 'rgba(255,150,70,0.4)');
  grad.addColorStop(1, 'rgba(255,110,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
