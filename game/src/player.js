// player.js — the body on foot and behind the wheel.
//
// One record holds the player whatever they are in: position, heading, gait phase, health, armour,
// the magazine and the pouch. `driving` is either null or the car being driven, and every function
// here branches on it once, at the top.
//
// On foot: WASD moves in world space (the camera maps it), shift runs, the aim heading leads the body
// and the gun arm. In a car: W is throttle and S is brake or reverse whatever way the nose points,
// A and D turn the wheel, and the steering rate falls off with speed so a fast car is not twitchy.
// A car pushes through a pedestrian and stops at a wall; a body stops at both.
//
// Condition, fire and the explosion are the damage system's; this module only tells it when a
// collision happened and how hard, and reacts when the player's own car is the one that goes up.

import { GAIT, DRIVE, GUN } from './units.js';
import { clamp, approach, turnToward, wrapAngle } from './mathKit.js';

export function newPlayer(plan) {
  const spawn = { x: 30, z: 1516 };
  return {
    x: spawn.x,
    z: spawn.z,
    yaw: -Math.PI / 2,
    aimYaw: -Math.PI / 2,
    vx: 0,
    vz: 0,
    phase: 0,
    moving: false,
    running: false,
    hp: 100,
    hpMax: 100,
    armour: 0,
    clip: GUN.magazine,
    ammo: GUN.pouch,
    reload: 0,
    fireCd: 0,
    muzzle: 0,
    driving: null,
    air: 0, // metres of air under the wheels
    airtime: 0,
    lastCrash: 0,
    dead: false,
    plan,
  };
}

/** Is the player in a car? */
export const inCar = (p) => p.driving !== null;

/**
 * One step on foot. `move` is a world-space direction already scaled to -1..1; `run` asks for the
 * sprint. The body turns toward where it is going but keeps its aim, so a player can strafe.
 */
export function stepOnFoot(p, dt, move, run, plan) {
  const speed = run ? GAIT.sprint : GAIT.walk;
  const mx = move.x;
  const mz = move.z;
  const len = Math.hypot(mx, mz);
  p.moving = len > 0.05;
  p.running = run && p.moving;

  if (p.moving) {
    const nx = mx / (len || 1);
    const nz = mz / (len || 1);
    // Accelerate toward the wish velocity rather than snapping to it: a body has weight.
    p.vx = approach(p.vx, nx * speed, GAIT.pivot * dt);
    p.vz = approach(p.vz, nz * speed, GAIT.pivot * dt);
    p.yaw = turnToward(p.yaw, Math.atan2(nz, nx), GAIT.pivot * dt * 1.4);
    p.phase += dt * (run ? 13 : 8);
  } else {
    p.vx = approach(p.vx, 0, GAIT.pivot * 2 * dt);
    p.vz = approach(p.vz, 0, GAIT.pivot * 2 * dt);
    p.phase += dt * 1.6;
  }

  // Slide along walls instead of stopping dead: try x and z separately.
  const nx = p.x + p.vx * dt;
  const nz = p.z + p.vz * dt;
  if (plan.isOpen(nx, p.z, 0.55)) p.x = nx;
  else p.vx *= 0.2;
  if (plan.isOpen(p.x, nz, 0.55)) p.z = nz;
  else p.vz *= 0.2;

  p.x = clamp(p.x, -180, 2460);
  p.z = clamp(p.z, -60, 2460);
}

/**
 * One step behind the wheel. The car's own physics: throttle and brake along its heading, a wheel
 * that turns more slowly the faster it is going, drag that scales with speed, and a stop that is a
 * stop. Returns the distance it travelled, which the caller uses to roll the wheels' sound.
 */
export function stepCar(p, dt, input, plan, onCrash) {
  const car = p.driving;
  if (!car) return 0;
  const throttle = input.throttle ?? 0; // -1 brake/reverse .. 1 throttle
  const wheel = input.wheel ?? 0; // -1 left .. 1 right

  const vmax = DRIVE.vmax * (car.wrecked ? 0 : 1);
  if (car.wrecked) {
    car.speed = approach(car.speed, 0, DRIVE.stop * dt);
  } else {
    if (throttle > 0) car.speed += DRIVE.push * throttle * dt * (1 - Math.min(1, Math.abs(car.speed) / Math.max(1, vmax)) * 0.6);
    else if (throttle < 0) {
      if (car.speed > 0.5) car.speed -= DRIVE.stop * -throttle * dt;
      else car.speed -= DRIVE.push * 0.6 * -throttle * dt;
    } else {
      car.speed = approach(car.speed, 0, DRIVE.coast * dt);
    }
    car.speed = clamp(car.speed, -DRIVE.vreverse, vmax);
  }

  // Steering: the wheel bites hardest at walking pace and barely at all at top speed.
  const grip = 1 - Math.min(0.72, Math.abs(car.speed) / DRIVE.vmax * 0.72);
  car.yaw = wrapAngle(car.yaw + wheel * DRIVE.steer * grip * dt * Math.sign(car.speed || 1));
  car.steer = wheel;

  const dx = Math.cos(car.yaw) * car.speed * dt;
  const dz = Math.sin(car.yaw) * car.speed * dt;
  const nx = car.x + dx;
  const nz = car.z + dz;

  // A car is wider than a body: pad the wall test and, when it hits, take the speed off it.
  if (plan.isOpen(nx, nz, 1.5)) {
    car.x = nx;
    car.z = nz;
  } else {
    const before = Math.abs(car.speed);
    car.speed *= -0.18;
    if (before > 7 && onCrash) onCrash(car, before);
    // Nudge out along the free axis so a car cannot wedge itself into a corner.
    if (plan.isOpen(nx, car.z, 1.5)) car.x = nx;
    else if (plan.isOpen(car.x, nz, 1.5)) car.z = nz;
  }

  car.x = clamp(car.x, -170, 2450);
  car.z = clamp(car.z, -50, 2450);
  car.lights = car.speed > 0.5 ? 1 : 0.4;
  car.distance = (car.distance ?? 0) + Math.abs(car.speed) * dt;
  return Math.abs(car.speed) * dt;
}

/** Fire the pistol, if there is a round in it and the trigger has cycled. */
export function fireGun(p, dt) {
  p.fireCd = Math.max(0, p.fireCd - dt);
  if (p.reload > 0) return false;
  if (p.fireCd > 0) return false;
  if (p.clip <= 0) return false;
  p.clip -= 1;
  p.fireCd = GUN.cycle;
  p.muzzle = 1;
  return true;
}

/** Start a reload if there is anything to load and nothing already in the chamber. */
export function beginReload(p) {
  if (p.reload > 0 || p.clip >= GUN.magazine || p.ammo <= 0) return false;
  p.reload = GUN.reloadTime;
  return true;
}

/** Step the reload, and put the rounds in the magazine when it finishes. */
export function stepReload(p, dt) {
  if (p.reload <= 0) return false;
  p.reload -= dt;
  if (p.reload > 0) return false;
  const need = GUN.magazine - p.clip;
  const take = Math.min(need, p.ammo);
  p.clip += take;
  p.ammo -= take;
  return true;
}

/** Take a car: the player's body disappears into it and the car becomes theirs. */
export function takeCar(p, car) {
  p.driving = car;
  car.driver = 'player';
  car.speed = 0;
  p.vx = 0;
  p.vz = 0;
  car.lights = 1;
}

/** Step out, on the pavement side if there is room. */
export function leaveCar(p, plan) {
  const car = p.driving;
  if (!car) return;
  car.driver = null;
  p.driving = null;
  const side = car.yaw + Math.PI / 2;
  const candidates = [
    { x: car.x + Math.cos(side) * 2.4, z: car.z + Math.sin(side) * 2.4 },
    { x: car.x - Math.cos(side) * 2.4, z: car.z - Math.sin(side) * 2.4 },
    { x: car.x + Math.cos(car.yaw) * -3.4, z: car.z + Math.sin(car.yaw) * -3.4 },
  ];
  for (const spot of candidates) {
    if (plan.isOpen(spot.x, spot.z, 0.6)) {
      p.x = spot.x;
      p.z = spot.z;
      break;
    }
  }
  p.yaw = car.yaw;
  p.aimYaw = car.yaw;
  p.vx = 0;
  p.vz = 0;
}

/** Hurt the player. Armour takes it first, and a hit that empties health is the caller's to notice. */
export function hurt(p, amount) {
  let left = amount;
  if (p.armour > 0) {
    const soak = Math.min(p.armour, left);
    p.armour -= soak;
    left -= soak;
  }
  p.hp = Math.max(0, p.hp - left);
  return p.hp <= 0;
}

/** Heal, up to the maximum. */
export function heal(p, amount) {
  p.hp = Math.min(p.hpMax, p.hp + amount);
}

/** Where the muzzle is, and which way the round should go. */
export function muzzlePoint(p) {
  if (p.driving) {
    const car = p.driving;
    return { x: car.x + Math.cos(car.yaw) * 2.4, y: 1.0, z: car.z + Math.sin(car.yaw) * 2.4, yaw: car.yaw };
  }
  return { x: p.x + Math.cos(p.aimYaw) * 0.7, y: 1.32, z: p.z + Math.sin(p.aimYaw) * 0.7, yaw: p.aimYaw };
}

/** The point an aimed round meets: straight out from the muzzle at chest height. */
export function aimPoint(p) {
  const m = muzzlePoint(p);
  return { x: m.x + Math.cos(m.yaw) * GUN.reach, z: m.z + Math.sin(m.yaw) * GUN.reach, yaw: m.yaw };
}
