// officers.js — the VMPD: the stars, the cruisers, the officers who get out of them, the air.
//
// The wanted level is one number from 0 to 5 and everything else follows it. Each star adds a
// cruiser, up to five; each cruiser carries two officers who dismount when the car has to stop; at
// four stars the helicopter lifts and holds a searchlight on the street. Heat drains only after
// nobody has had eyes on the player for LAW.blindAfter seconds, so a chase does not simply evaporate
// when the player turns a corner — it has to be waited out, which is what makes the escape missions
// mean anything.
//
// A unit's tactic is what the dispatch list prints, and it is real: PURSUIT means the car is driving
// at the player; RAMMING means it is close enough to try; ROADBLOCK means it has lost the line and
// is cutting ahead; DEPLOYED means its crew is out of the car on foot; SEARCHLIGHT is the aircraft.
//
// Nothing here draws. The HUD reads dispatchOf() and the cast reads the records.

import { LAW, AIR } from './units.js';
import { AVENUES, KERB } from './cityPlan.js';
import { clamp, dist, turnToward, wrapAngle } from './mathKit.js';
import { makeCar } from './traffic.js';

export function newPolice() {
  return {
    stars: 0,
    heat: 0,
    seen: false,
    quiet: 0,
    units: [],
    air: null,
    rounds: [],
    nextId: 1,
    volleyCd: 0,
  };
}

/** Light up a star: the single entry point every crime calls. */
export function addStars(police, n, why = '') {
  const before = police.stars;
  police.stars = clamp(police.stars + n, 0, LAW.stars);
  police.heat = Math.max(police.heat, 1);
  police.quiet = 0;
  police.seen = true;
  if (police.stars > before) police.lastReason = why;
  return police.stars;
}

/** Clear the whole level: a respray, a bust, or a death. */
export function clearStars(police) {
  police.stars = 0;
  police.heat = 0;
  police.seen = false;
  police.quiet = 0;
  police.units = [];
  police.air = null;
  police.rounds = [];
}

/** The nearest point on a street to a spot, where a cruiser can actually be placed. */
function onStreet(plan, x, z) {
  const snap = plan.snapToRoad(x, z);
  return { x: clamp(snap.x, 0, 2400), z: clamp(snap.z, 0, 2400) };
}

/** Spawn a cruiser out of sight, on a street, between spawnNear and spawnFar from the player. */
function spawnUnit(police, sim, tactic = 'PURSUIT') {
  const p = sim.player;
  const base = p.driving ?? p;
  const plan = sim.plan;
  let spot = null;
  for (let tries = 0; tries < 40; tries += 1) {
    const a = Math.random() * Math.PI * 2;
    const r = LAW.spawnNear + Math.random() * (LAW.spawnFar - LAW.spawnNear);
    const candidate = onStreet(plan, base.x + Math.cos(a) * r, base.z + Math.sin(a) * r);
    if (Math.hypot(candidate.x - base.x, candidate.z - base.z) < LAW.spawnNear * 0.8) continue;
    spot = candidate;
    break;
  }
  if (!spot) spot = onStreet(plan, base.x + 200, base.z + 200);

  const yaw = Math.atan2(base.z - spot.z, base.x - spot.x);
  const car = makeCar('cruiser', '#f2f3f5', spot.x, spot.z, yaw);
  car.driver = 'cop';
  car.cruise = 30;
  car.id = `cruiser-${police.nextId}`;
  const unit = {
    id: police.nextId,
    label: `UNIT ${String(police.nextId).padStart(2, '0')}`,
    car,
    x: spot.x,
    z: spot.z,
    yaw,
    speed: 0,
    tactic,
    age: Math.random() * 6,
    deployed: false,
    officers: [],
    lost: 0,
  };
  police.nextId += 1;
  for (let i = 0; i < LAW.crew; i += 1) {
    unit.officers.push({
      x: spot.x,
      z: spot.z,
      yaw,
      inCar: true,
      alive: true,
      down: 0,
      moving: false,
      flash: 0,
      cd: Math.random(),
      hp: 100,
    });
  }
  police.units.push(unit);
  return unit;
}

/** The officer record on foot who is nearest a point, or null. */
export function officerNear(police, x, z, reach = 4.2) {
  let best = null;
  let bestD = reach;
  for (const unit of police.units) {
    for (const o of unit.officers) {
      if (!o.alive || o.inCar) continue;
      const d = dist(o.x, o.z, x, z);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
  }
  return best;
}

/**
 * One step of the law. Spawning, driving, dismounting, shooting, the air, and the slow drain of heat
 * once the player has broken line of sight.
 */
export function tickPolice(police, sim, dt) {
  const p = sim.player;
  const target = p.driving ?? p;
  const want = LAW.perStar[police.stars] ?? 0;

  // Keep the right number of cruisers on the road.
  if (police.units.length < want) spawnUnit(police, sim, 'PURSUIT');
  if (police.units.length > want) {
    const dropped = police.units.pop();
    if (dropped) dropped.gone = true;
  }

  // Line of sight: the player is seen if a unit is close enough and roughly facing them, or if the
  // air is up. Blind time is what drains the heat.
  let seen = false;
  for (const unit of police.units) {
    if (dist(unit.x, unit.z, target.x, target.z) < 130) seen = true;
  }
  if (police.air) seen = true;
  police.seen = seen;
  if (seen) police.quiet = 0;
  else police.quiet += dt;
  if (police.stars > 0 && police.quiet > LAW.blindAfter) {
    police.heat -= (1 / LAW.drainTime) * dt;
    if (police.heat <= 0) clearStars(police);
  }

  for (const unit of police.units) {
    if (unit.gone) continue;
    unit.age += dt;
    const car = unit.car;
    const d = dist(car.x, car.z, target.x, target.z);

    if (!unit.deployed) {
      // Drive at the player: aim the nose, throttle, and brake if very close.
      const wantYaw = Math.atan2(target.z - car.z, target.x - car.x);
      car.yaw = turnToward(car.yaw, wantYaw, (2.4 + Math.min(1.4, car.speed / 30)) * dt);
      const tooClose = d < 12;
      const wantSpeed = tooClose ? 6 : Math.min(38, 18 + police.stars * 4);
      car.speed += clamp(wantSpeed - car.speed, -22 * dt, 16 * dt);
      car.x += Math.cos(car.yaw) * car.speed * dt;
      car.z += Math.sin(car.yaw) * car.speed * dt;
      // A cruiser that runs into a wall takes the hit and keeps the nose off it.
      if (!sim.plan.isOpen(car.x, car.z, 1.4)) {
        car.x -= Math.cos(car.yaw) * car.speed * dt;
        car.z -= Math.sin(car.yaw) * car.speed * dt;
        car.speed *= -0.2;
        car.yaw += 0.7 * dt * (Math.random() < 0.5 ? 1 : -1);
      }
      car.lights = 1;
      car.condition = car.condition; // a cruiser's own damage is the player's doing, not the kerb's
      unit.tactic = d < 20 ? 'RAMMING' : 'PURSUIT';

      // Close enough, and the player is slow enough: the crew gets out.
      if (d < LAW.dismount && Math.abs(target.speed ?? 0) < 8) {
        unit.deployed = true;
        unit.tactic = 'DEPLOYED';
        for (const o of unit.officers) {
          if (!o.alive) continue;
          o.inCar = false;
          const a = car.yaw + Math.PI / 2 + (Math.random() - 0.5) * 0.6;
          o.x = car.x + Math.cos(a) * 2.2;
          o.z = car.z + Math.sin(a) * 2.2;
          o.yaw = car.yaw;
        }
        car.speed = 0;
      }
    } else {
      car.speed = Math.max(0, car.speed - 12 * dt);
      unit.tactic = 'DEPLOYED';
      // Out of the car, they close on foot and shoot: a volley every LAW.volley seconds from
      // however many are standing, aimed with a little scatter so it is not a guaranteed hit.
      police.volleyCd -= dt;
      let standing = 0;
      for (const o of unit.officers) {
        if (!o.alive) {
          o.down = Math.max(0, o.down - dt);
          continue;
        }
        standing += 1;
        o.flash = Math.max(0, o.flash - dt * 4);
        const od = dist(o.x, o.z, target.x, target.z);
        o.moving = od > 7;
        if (o.moving) {
          const wantYaw = Math.atan2(target.z - o.z, target.x - o.x);
          o.yaw = turnToward(o.yaw, wantYaw, 4 * dt);
          const speed = LAW.run * dt;
          const nx = o.x + Math.cos(o.yaw) * speed;
          const nz = o.z + Math.sin(o.yaw) * speed;
          if (sim.plan.isOpen(nx, nz, 0.5)) {
            o.x = nx;
            o.z = nz;
          } else {
            o.x += Math.cos(o.yaw + 1.4) * speed * 0.5;
            o.z += Math.sin(o.yaw + 1.4) * speed * 0.5;
          }
        } else {
          o.yaw = turnToward(o.yaw, Math.atan2(target.z - o.z, target.x - o.x), 3 * dt);
        }
        if (police.volleyCd <= 0 && od < LAW.range) {
          o.flash = 1;
          const a = Math.atan2(target.z - o.z, target.x - o.x) + (Math.random() - 0.5) * 0.12;
          police.rounds.push({
            x: o.x + Math.cos(a) * 0.7,
            y: 1.3,
            z: o.z + Math.sin(a) * 0.7,
            vx: Math.cos(a) * LAW.round,
            vz: Math.sin(a) * LAW.round,
            life: 0.6,
            max: 0.6,
            yaw: a,
            from: o,
          });
        }
      }
      if (standing > 0) police.volleyCd = police.volleyCd <= 0 ? LAW.volley : police.volleyCd;
    }

    unit.x = car.x;
    unit.z = car.z;
    unit.yaw = car.yaw;
  }

  // The rounds: fly, expire, and hit.
  for (let i = police.rounds.length - 1; i >= 0; i -= 1) {
    const r = police.rounds[i];
    r.x += r.vx * dt;
    r.z += r.vz * dt;
    r.life -= dt;
    if (r.life <= 0) {
      police.rounds.splice(i, 1);
      continue;
    }
    const hitPlayer = Math.abs(r.x - target.x) < 1 && Math.abs(r.z - target.z) < 1;
    if (hitPlayer) {
      police.rounds.splice(i, 1);
      sim.events.onHitPlayer?.(8);
    }
  }

  // The air: four stars or more puts the helicopter over the street, circling and lighting it.
  if (police.stars >= LAW.airFrom && !police.air) {
    police.air = { x: target.x + 30, z: target.z + 30, alt: AIR.alt, heading: 0, spin: 0, intensity: 0, light: { x: target.x, z: target.z }, bank: 0 };
  }
  if (police.stars < LAW.airFrom && police.air) police.air = null;
  if (police.air) {
    const air = police.air;
    air.intensity = Math.min(1, air.intensity + dt / AIR.fadeIn);
    air.spin += dt * 26;
    // Orbit the player, banking into the turn, and hold the light a little ahead of the car so the
    // cone lands on the road the player is about to use.
    const base = sim.player.driving ?? sim.player;
    const a = Math.atan2(air.z - base.z, air.x - base.x) + AIR.orbit * dt;
    air.x = base.x + Math.cos(a) * AIR.radius;
    air.z = base.z + Math.sin(a) * AIR.radius;
    air.alt = AIR.alt + Math.sin(air.spin * 0.02) * 1.6;
    air.heading = wrapAngle(-a + Math.PI / 2);
    air.bank = Math.sin(air.spin * 0.02) * 0.06;
    air.light.x = base.x + Math.cos(base.yaw ?? 0) * 8;
    air.light.z = base.z + Math.sin(base.yaw ?? 0) * 8;
    if (police.units.length > 0) police.units[0].tactic = police.units[0].tactic ?? 'PURSUIT';
  }
}

/**
 * The dispatch list the HUD prints: one line per unit, nearest first, the aircraft last. Each line
 * is a label, a distance in metres and the tactic it is working.
 */
export function dispatchOf(sim) {
  const target = sim.player.driving ?? sim.player;
  const lines = [];
  for (const unit of sim.police.units) {
    if (unit.gone) continue;
    lines.push({
      label: unit.label,
      dist: Math.round(dist(unit.x, unit.z, target.x, target.z)),
      tactic: unit.tactic,
      air: false,
      age: unit.age,
    });
  }
  lines.sort((a, b) => a.dist - b.dist);
  if (sim.police.air) {
    lines.push({
      label: 'AIR 1',
      dist: Math.round(dist(sim.police.air.x, sim.police.air.z, target.x, target.z)),
      tactic: 'SEARCHLIGHT',
      air: true,
      age: 0,
    });
  }
  return lines.slice(0, 5);
}

/** The cruiser a shot lands on, if any: for the player's rounds looking for a body. */
export function unitNear(police, x, z, reach = 2.2) {
  for (const unit of police.units) {
    if (unit.gone) continue;
    if (Math.hypot(unit.car.x - x, unit.car.z - z) < reach + 1.6) return unit;
  }
  return null;
}

export { KERB, AVENUES };
