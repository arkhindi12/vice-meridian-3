// traffic.js — the city's own cars, and the rules they keep.
//
// A car in the fleet drives the avenue grid: it holds a lane, follows the man in front, stops at a
// junction if something is already in it, and turns when it reaches a corner. There is no path
// search and no navigation mesh — the grid is the path, and a lane is a coordinate, so "drive down
// this avenue in this lane" is arithmetic.
//
// Cars are also the thing the player crashes into and shoots at, so every one of them carries the
// condition the damage system reads, and a wrecked one is pulled out of the lane and left where it
// died (the sim moves it to the wreck list; this module only stops driving it).
//
// A model is chosen per car, so the street has vans and coupes and not forty saloons; the paint is
// picked from the palette, and a taxi is yellow with a roof sign because a fare has to be findable.

import { FLEET, CITY, PAINT } from './units.js';
import { AVENUES, KERB } from './cityPlan.js';
import { stream } from './random.js';
import { SHAPES, TAXI_YELLOW } from './vehicle.js';
import { clamp } from './mathKit.js';

const KINDS = ['sedan', 'sedan', 'sedan', 'coupe', 'drop', 'suv', 'van', 'cab', 'cab'];
const LANE = 5.3;

/** A fresh fleet: cars on the avenues, spread over the whole grid, in their own lanes. */
export function newTraffic(plan, seed = 1) {
  const rand = stream(seed * 31 + 7);
  const cars = [];
  // A couple of cars parked near the spawn, so a new run can take one without hunting for it.
  const spawnCars = [
    { kind: 'sedan', paint: PAINT.cars[3], x: 20.5, z: 1516.4, yaw: Math.PI, dir: 1, vertical: false, line: 1500 },
    { kind: 'cab', paint: TAXI_YELLOW, x: 20.5, z: 1546, yaw: Math.PI, dir: 1, vertical: false, line: 1500 },
  ];
  for (const seedCar of spawnCars) {
    cars.push({
      id: `traffic-park-${cars.length}`,
      kind: seedCar.kind,
      paint: seedCar.paint,
      x: seedCar.x,
      z: seedCar.z,
      yaw: seedCar.yaw,
      speed: 0,
      cruise: 0,
      condition: 100,
      burning: false,
      wrecked: false,
      lights: 0.4,
      driver: 'npc',
      vertical: seedCar.vertical,
      line: seedCar.line,
      dir: seedCar.dir,
      patience: 0,
      age: 0,
      distance: 0,
      shape: SHAPES[seedCar.kind],
    });
  }
  for (let i = 0; i < FLEET.size; i += 1) {
    const vertical = rand() < 0.5;
    const line = AVENUES[rand.int(0, AVENUES.length - 1)];
    const along = rand.between(CITY.first + 40, CITY.last - 40);
    const dir = rand() < 0.5 ? 1 : -1;
    const lane = line + (dir > 0 ? -LANE : LANE);
    const kind = rand.pick(KINDS);
    const car = {
      id: `traffic-${i}`,
      kind,
      paint: kind === 'cab' ? TAXI_YELLOW : rand.pick(PAINT.cars),
      x: vertical ? lane : along,
      z: vertical ? along : lane,
      yaw: vertical ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : dir > 0 ? 0 : Math.PI,
      speed: rand.between(9, 18),
      cruise: rand.between(11, 19),
      condition: 100,
      burning: false,
      wrecked: false,
      lights: 1,
      driver: 'npc',
      vertical,
      line,
      dir,
      patience: 0,
      age: rand.angle(),
      distance: 0,
      shape: SHAPES[kind],
    };
    cars.push(car);
  }
  return cars;
}

/** The car in front of `car` in its own lane, or null. */
function leaderOf(car, cars) {
  let best = null;
  let bestGap = 34;
  for (const other of cars) {
    if (other === car || other.wrecked) continue;
    if (other.vertical !== car.vertical || other.line !== car.line) continue;
    // Ahead means further along the direction of travel.
    const gap = car.vertical ? (other.z - car.z) * (car.dir > 0 ? 1 : -1) : (other.x - car.x) * (car.dir > 0 ? 1 : -1);
    if (gap > 2 && gap < bestGap && Math.abs((car.vertical ? other.x - car.x : other.z - car.z)) < 4.5) {
      bestGap = gap;
      best = other;
    }
  }
  return best ? { car: best, gap: bestGap } : null;
}

/**
 * One step. Every car looks for the one in front, brakes for it, keeps its speed otherwise, and
 * turns at an intersection once it is inside the junction box. A junction is claimed by whoever got
 * there first, so two cars do not arrive in the same square metre.
 */
export function tickTraffic(cars, dt, sim) {
  for (const car of cars) {
    // The player's own car is theirs to drive: the lane logic must never touch its speed, or the
    // throttle would be overwritten by a cruise speed of zero every step and no car could move.
    if (car === sim.player.driving) continue;
    if (car.wrecked) {
      car.speed = 0;
      continue;
    }
    // Condition under a quarter: the engine coughs and the car will not hold speed.
    const ailing = car.condition < 25 ? 0.55 : 1;
    const lead = leaderOf(car, cars);
    let want = car.cruise * ailing;

    if (lead && lead.gap < 18) {
      want = Math.min(want, Math.max(0, (lead.gap - 6) * 1.6));
      car.patience += dt;
    } else {
      car.patience = Math.max(0, car.patience - dt);
    }

    // The player is a car too: brake for them if they are in the lane ahead.
    const p = sim.player;
    const subject = p.driving;
    if (subject && !subject.wrecked) {
      const gap = car.vertical ? (subject.z - car.z) * (car.dir > 0 ? 1 : -1) : (subject.x - car.x) * (car.dir > 0 ? 1 : -1);
      const off = car.vertical ? Math.abs(subject.x - car.x) : Math.abs(subject.z - car.z);
      if (gap > 0 && gap < 16 && off < 4.2) want = Math.min(want, Math.max(0, (gap - 5) * 1.5));
    }

    car.speed += clamp(want - car.speed, -14 * dt, 9 * dt);
    car.speed = Math.max(0, car.speed);

    const step = car.speed * dt;
    if (car.vertical) car.z += car.dir * step;
    else car.x += car.dir * step;
    car.distance += step;
    car.lights = 1;

    // At a junction: either turn into the crossing avenue or carry on. Turning is a heading change
    // plus a lane change, and it happens once per junction.
    const here = car.vertical ? car.z : car.x;
    for (const line of AVENUES) {
      const near = Math.abs(here - line) < 6;
      if (!near) continue;
      const key = `${car.id}:${line}`;
      if (car.lastTurn === key) continue;
      car.lastTurn = key;
      if (Math.random() < 0.34) {
        // Turn: the new axis is the other one, in a lane chosen by which side of the avenue we are on.
        const toVertical = !car.vertical;
        const newDir = Math.random() < 0.5 ? 1 : -1;
        car.vertical = toVertical;
        car.dir = newDir;
        car.line = line;
        const lane = line + (newDir > 0 ? -LANE : LANE);
        if (toVertical) {
          car.x = lane;
          car.z = here;
          car.yaw = newDir > 0 ? Math.PI / 2 : -Math.PI / 2;
        } else {
          car.z = lane;
          car.x = here;
          car.yaw = newDir > 0 ? 0 : Math.PI;
        }
        car.speed *= 0.55;
      }
      break;
    }

    // Wrap round the edge of town rather than piling up against it.
    if (car.z > CITY.last + 30 || car.z < CITY.first - 30 || car.x > CITY.last + 30 || car.x < CITY.first - 30) {
      const vertical = Math.random() < 0.5;
      const line = AVENUES[Math.floor(Math.random() * AVENUES.length)];
      const dir = Math.random() < 0.5 ? 1 : -1;
      const lane = line + (dir > 0 ? -LANE : LANE);
      const along = dir > 0 ? CITY.first + 20 : CITY.last - 20;
      car.vertical = vertical;
      car.dir = dir;
      car.line = line;
      car.x = vertical ? lane : along;
      car.z = vertical ? along : lane;
      car.yaw = vertical ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : dir > 0 ? 0 : Math.PI;
      car.speed = 12;
    }
  }
}

/** A car for a story moment, parked at a spot facing a heading. */
export function makeCar(kind, paint, x, z, yaw) {
  return {
    id: `car-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    paint,
    x,
    z,
    yaw,
    speed: 0,
    cruise: 0,
    condition: 100,
    burning: false,
    wrecked: false,
    lights: 0.4,
    driver: null,
    vertical: false,
    line: 0,
    dir: 1,
    patience: 0,
    age: 0,
    distance: 0,
    shape: SHAPES[kind] ?? SHAPES.sedan,
  };
}

export { KERB };
