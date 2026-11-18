// crowd.js — the people on the pavement.
//
// A pedestrian is a record with a lane, a heading and a mood. They walk the pavement ring around
// every block, turn at the corners, and panic — running away from the player — when a gun goes off
// or a car explodes near them. They are not agents with a plan; they are a hundred and thirty small
// loops that make a street look inhabited, which is what a still frame needs.
//
// Placement walks the pavement of each block a few metres at a time and drops a body at a random
// point on it, so nobody is ever standing inside a wall or in the road. A body that has been shot
// goes down and stays down for a while, then is picked up and respawned somewhere else, which keeps
// the count of living people constant without ever letting the pool grow.

import { CROWD, PAINT, SHORE, CITY } from './units.js';
import { AVENUES, KERB, WALK } from './cityPlan.js';
import { stream } from './random.js';
import { clamp, turnToward } from './mathKit.js';

export function newCrowd(plan, seed = 1) {
  const rand = stream(seed * 13 + 5);
  const people = [];
  const spots = pavementSpots(plan);
  for (let i = 0; i < CROWD.size; i += 1) {
    const at = spots[Math.floor(rand() * spots.length)] ?? { x: 0, z: 0 };
    people.push({
      x: at.x + rand.between(-1.2, 1.2),
      z: at.z + rand.between(-1.2, 1.2),
      yaw: rand.angle(),
      speed: rand.between(CROWD.stroll[0], CROWD.stroll[1]),
      phase: rand.angle(),
      shirt: rand.pick(PAINT.tops),
      trousers: rand.pick(PAINT.legs),
      skin: rand.pick(PAINT.skins),
      hat: rand() < 0.22,
      bag: rand() < 0.18,
      moving: true,
      run: false,
      down: 0,
      alive: true,
      panic: 0,
      turn: rand.between(2, 9),
      home: at,
    });
  }
  return people;
}

/**
 * Points on the pavement ring of every block, plus the beach and the promenade. Each block
 * contributes its four kerb lines, sampled every few metres, and the sampler is nudged outside the
 * kerb so a body is on the walk and not in the road.
 */
function pavementSpots(plan) {
  const out = [];
  for (const b of plan.blocks) {
    const step = 7;
    for (let t = b.z + 4; t < b.z + b.h; t += step) {
      out.push({ x: b.x + KERB * 0.5 + 2, z: t });
      out.push({ x: b.x + b.w - KERB * 0.5 - 2, z: t });
    }
    for (let t = b.x + 4; t < b.x + b.w; t += step) {
      out.push({ x: t, z: b.z + KERB * 0.5 + 2 });
      out.push({ x: t, z: b.z + b.h - KERB * 0.5 - 2 });
    }
  }
  // The promenade and the beach, where a crowd at sunset is the point of the place.
  for (let z = CITY.first + 20; z < SHORE.quay; z += 9) {
    out.push({ x: SHORE.promenade + 8, z });
    if (z % 27 < 9) out.push({ x: SHORE.sand + 6, z });
  }
  return out;
}

/** The pavement line a walker should follow: the nearest avenue's walk, on the side they are on. */
function walkTarget(p, plan) {
  let best = null;
  let bestD = Infinity;
  for (const line of AVENUES) {
    const dz = Math.abs(p.z - line);
    const dx = Math.abs(p.x - line);
    if (dz > KERB && dz < KERB + WALK + 4 && dx < bestD) {
      bestD = dx;
      best = { x: p.x + Math.cos(p.yaw) * 8, z: line + Math.sign(p.z - line) * (KERB + WALK * 0.4) };
    }
    if (dx > KERB && dx < KERB + WALK + 4 && dz < bestD) {
      bestD = dz;
      best = { x: line + Math.sign(p.x - line) * (KERB + WALK * 0.4), z: p.z + Math.sin(p.yaw) * 8 };
    }
  }
  return best;
}

/**
 * One step for every body. A walker keeps to the pavement by steering back toward the kerb line
 * when they stray; a panicked one runs directly away from the threat. Nobody is simulated against
 * anybody else: a hundred and thirty pairwise tests a step would cost more than the whole city and
 * buy nothing you can see.
 */
export function tickCrowd(people, dt, sim) {
  const p = sim.player;
  const threat = sim.threat ?? null; // { x, z, radius, strength } from a shot or an explosion
  for (const person of people) {
    if (!person.alive) {
      person.down = Math.max(0, person.down - dt);
      if (person.down <= 0) {
        // Get up somewhere else: the city keeps its population, and the pavement it left is freed.
        const spot = sim.plan.blocks[Math.floor(Math.random() * sim.plan.blocks.length)];
        person.x = spot.x + KERB * 0.7 + Math.random() * 4;
        person.z = spot.z + 6 + Math.random() * (spot.h - 12);
        person.alive = true;
        person.down = 0;
        person.panic = 0;
      }
      continue;
    }

    person.panic = Math.max(0, person.panic - dt);
    person.turn -= dt;

    if (threat && Math.hypot(threat.x - person.x, threat.z - person.z) < threat.radius) {
      person.panic = Math.max(person.panic, 3.4);
    }

    if (person.panic > 0) {
      // Run away from whatever scared them, and off the pavement if that is the way out.
      const away = Math.atan2(person.z - (threat?.z ?? p.z), person.x - (threat?.x ?? p.x));
      person.yaw = turnToward(person.yaw, away, 6 * dt);
      const run = CROWD.bolt * Math.min(1, person.panic / 1.6);
      const nx = person.x + Math.cos(person.yaw) * run * dt;
      const nz = person.z + Math.sin(person.yaw) * run * dt;
      if (sim.plan.isOpen(nx, nz, 0.4)) {
        person.x = nx;
        person.z = nz;
      } else {
        person.yaw += Math.PI * 0.5;
      }
      person.phase += dt * 15;
      person.run = true;
      person.moving = true;
      continue;
    }

    person.run = false;
    person.moving = true;
    if (person.turn <= 0) {
      person.turn = 3 + Math.random() * 7;
      person.yaw += (Math.random() - 0.5) * 1.9;
    }
    const lane = walkTarget(person, sim.plan);
    if (lane) {
      const want = Math.atan2(lane.z - person.z, lane.x - person.x);
      person.yaw = turnToward(person.yaw, want, 2.2 * dt);
    }
    const nx = person.x + Math.cos(person.yaw) * person.speed * dt;
    const nz = person.z + Math.sin(person.yaw) * person.speed * dt;
    if (sim.plan.isOpen(nx, nz, 0.35) && nx > SHORE.promenade - 20) {
      person.x = nx;
      person.z = nz;
    } else {
      person.yaw += Math.PI * (0.5 + Math.random() * 0.5);
    }
    person.phase += dt * 6.5;
    person.x = clamp(person.x, SHORE.sand, CITY.last);
    person.z = clamp(person.z, CITY.first, SHORE.quay + 20);
  }
}

/** Drop a body: the shooter's doing, and what the crowd reacts to. */
export function fell(person) {
  if (!person.alive) return false;
  person.alive = false;
  person.down = 9 + Math.random() * 5;
  person.panic = 0;
  return true;
}

/** Is a point within a body's reach? Used by a round looking for a target. */
export const within = (person, x, z, r = 0.75) => person.alive && Math.abs(person.x - x) < r && Math.abs(person.z - z) < r;
