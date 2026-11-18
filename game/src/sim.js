// sim.js — the world's clock: one fixed step that moves everything, in the right order.
//
// The whole game is a plain record (`sim`) and one function that advances it. Nothing in here draws,
// and nothing in here knows about three.js; the renderer poses meshes from these records and the HUD
// paints numbers from them. That split is what lets a staged screenshot hold a frame: the scene is
// posed once, from a record, and no step runs between the pose and the picture.
//
// The order of a step matters and is the reason this file exists rather than each system ticking
// itself:
//
//   1  the clock          the hour advances, and the light rig is derived from it
//   2  the player         input becomes movement, in a car or on foot
//   3  collisions         the player's car against the fleet, hard enough to cost condition
//   4  the fleet          traffic drives its lanes
//   5  the law            stars, cruisers, officers, the air
//   6  the crowd          walks, panics, and gets out of the way
//   7  rounds             the player's and the police's, resolved against bodies and bodywork
//   8  damage             smoke, fire, the explosion, the wreck, the chain
//   9  side work          tapes, fares, airtime, the district banner
//   10 the story          the mission test, and the reward if it passed
//
// A step is 1/60 s. The caller runs as many as the frame needs, so a slow machine sees the same
// world at the same speed as a fast one.

import { DAMAGE, WORK, GUN, LAW } from './units.js';
import { newPlayer, stepOnFoot, stepCar, fireGun, beginReload, stepReload, takeCar, leaveCar, hurt, heal, muzzlePoint } from './player.js';
import { newTraffic, tickTraffic, makeCar } from './traffic.js';
import { newCrowd, tickCrowd, fell } from './crowd.js';
import { newPolice, tickPolice, addStars, clearStars, dispatchOf, officerNear } from './officers.js';
import { newStory, tickClock, tickSpeech, testMission, currentMission, speak, announce } from './story.js';
import { newRadio, tickRadio } from './radio.js';
import { newSideWork, tickSideWork, promptAt, usePrompt, sideObjective } from './sidework.js';
import { rigAt } from './daylight.js';
import { clamp } from './mathKit.js';

export const STEP = 1 / 60;

/**
 * A fresh world: the plan it is made of, and every record the step needs. Systems that need a scene
 * (the GPS route, the fire, the camera) are attached by main.js, because the sim must be buildable
 * without a renderer — a staged screenshot builds the same sim and poses meshes from it.
 */
export function createSim(plan, seed = 1) {
  const sim = {
    seed,
    plan,
    time: 0,
    frames: 0,
    mode: 'play', // play | paused | wasted | busted
    player: newPlayer(plan),
    story: newStory(),
    police: newPolice(),
    radio: newRadio(),
    work: newSideWork(plan),
    traffic: newTraffic(plan, seed),
    crowd: newCrowd(plan, seed),
    wrecks: [],
    rounds: [],
    impacts: [],
    hostiles: [],
    crewDown: 0,
    turning: 0,
    shake: 0,
    rig: rigAt(18.87),
    light: { head: 0 },
    prompt: null,
    dispatch: [],
    gps: null, // attached by main.js
    damage: null, // attached by main.js
    events: {},
    threat: null,
    repaint: null,
    saved: 0,
    message: '',
  };
  return sim;
}

// ---------------------------------------------------------------- the step

/** Advance the world one fixed step. */
export function tick(sim, dt, input) {
  if (sim.mode === 'paused') return;
  sim.time += dt;
  sim.frames += 1;

  // 1. The hour, and the light that follows it.
  const moving = !!(sim.player.driving || sim.player.moving);
  tickClock(sim.story, dt, moving);
  sim.rig = rigAt(sim.story.hour);
  sim.light.head = sim.rig.head;

  // 2. The player.
  if (sim.mode === 'play') stepPlayer(sim, dt, input);
  else {
    // Wasted or busted: the body stays where it fell.
    if (sim.player.driving) sim.player.driving.speed *= 0.9;
  }

  // 3. Collisions between the player's car and the fleet.
  if (sim.player.driving) bumpFleet(sim, dt);

  // 4. The fleet.
  tickTraffic(sim.traffic, dt, sim);

  // 5. The law.
  armCrew(sim);
  tickHostiles(sim, dt);
  tickPolice(sim.police, sim, dt);

  // 6. The crowd.
  tickCrowd(sim.crowd, dt, sim);
  sim.threat = decayThreat(sim.threat, dt);

  // 7. Rounds.
  stepRounds(sim, dt);

  // 8. Damage: smoke, fire, the explosion, the chain.
  if (sim.damage) {
    sim.damage.events.onBoom = (car) => onBoom(sim, car);
    const all = [...sim.traffic, ...sim.wrecks, ...(sim.player.driving ? [sim.player.driving] : [])];
    sim.damage.tick(dt, all, sim.camera, sim.world, (a, b) => {
      announce(sim.story, 'THE FIRE IS SPREADING', 2);
      void a;
      void b;
    });
  }
  harvestWrecks(sim);

  // 9. Side work.
  tickSideWork(sim, dt);

  // 10. The story.
  const passed = testMission(sim.story, dt, sim.player, {
    crewDown: sim.crewDown,
    stars: sim.police.stars,
    bought: sim.story.bought,
  });
  if (passed) onMissionPassed(sim, passed);
  tickSpeech(sim.story, dt);
  tickRadio(sim.radio, dt);

  sim.prompt = promptAt(sim);
  sim.dispatch = dispatchOf(sim);
  sim.shake = Math.max(0, sim.shake - dt * 1.6);
  if (sim.player.muzzle > 0) sim.player.muzzle = Math.max(0, sim.player.muzzle - dt * 5);
  if (sim.player.air > 0) sim.player.air = Math.max(0, sim.player.air - dt * 2.2);

  // The autosave: every half minute of play, and on a mission pass.
  sim.saved += dt;
  if (sim.saved > 30) {
    sim.saved = 0;
    sim.events.onSave?.(sim);
  }
}

/** The player: input in, movement and gunfire out, in whichever mode they are in. */
function stepPlayer(sim, dt, input) {
  const p = sim.player;
  stepReload(p, dt);
  if (p.driving) {
    const car = p.driving;
    const wheel = (input.wheel ?? 0) + (input.move ? input.move.x : 0);
    const throttle = input.move ? input.move.z : 0;
    const before = car.speed;
    stepCar(p, dt, { wheel, throttle }, sim.plan, (c, closing) => {
      sim.shake = Math.max(sim.shake, Math.min(1, closing / 26));
      sim.events.onCrunch?.();
      if (sim.damage) {
        sim.damage.crash(c, closing);
        // A hard enough hit hurt whoever was inside.
        if (closing > 18) hurt(p, Math.min(30, closing - 14));
      }
    });
    sim.turning = Math.abs(wheel);
    if (before !== car.speed && Math.abs(car.speed) > 0.1 && Math.random() < dt * 2) sim.player.phase += 0.4;
    // The wheels leave the ground on the ramp.
    stepRamp(sim, dt);
    if (p.hp <= 0) sim.mode = 'wasted';
  } else {
    stepOnFoot(p, dt, input.move ?? { x: 0, z: 0 }, !!input.run, sim.plan);
    p.air = 0;
    if (p.hp <= 0) sim.mode = 'wasted';
  }

  // The trigger.
  if (input.fire) {
    if (p.driving) {
      // Shooting from a car is a drive-by: the round goes where the nose points.
      if (fireGun(p, dt)) shoot(sim, p.driving.yaw);
    } else if (fireGun(p, dt)) {
      shoot(sim, p.aimYaw);
    }
  }
  if (input.reload) beginReload(p);

  // E: leave the car, take the nearest one, or use whatever is being offered.
  if (input.use) {
    if (sim.prompt && sim.prompt.kind !== 'taxi-run' && sim.prompt.kind !== 'taxi-wait') {
      usePrompt(sim, sim.prompt);
    } else if (p.driving) {
      leaveCar(p, sim.plan);
    } else {
      const car = nearestCar(sim, p.x, p.z, 12.5);
      if (car) takeCar(p, car);
    }
  }
}

/** The ramp: while a car is on it, its nose is lifted; past the lip it is in the air. */
function stepRamp(sim, dt) {
  const ramp = sim.plan.ramp;
  const p = sim.player;
  const car = p.driving;
  if (!ramp || !car) return;
  const inRun = Math.abs(car.x - ramp.x) < ramp.w / 2 + 1 && Math.abs(car.z - ramp.z) < ramp.run / 2 + 2;
  if (!inRun) {
    p.air = Math.max(0, p.air - dt * 3);
    return;
  }
  // The deck: height rises along the run toward the lip at z - run/2.
  const t = clamp((ramp.z + ramp.run / 2 - car.z) / ramp.run, 0, 1);
  car.y = t * ramp.rise;
  if (t > 0.92 && Math.abs(car.speed) > 16) {
    p.air = Math.max(p.air, 1.2 + Math.abs(car.speed) / 50);
    p.airtime = p.air;
    sim.events.onAirtimeStart?.();
  }
  if (p.air > 0) {
    // In the air: the car keeps going, but the ground falls away underneath it.
    car.y = Math.min(car.y, ramp.rise + p.air * 2.2);
  }
}

/** Every car the player could take: the nearest one within reach, wrecks excluded. */
function nearestCar(sim, x, z, reach) {
  let best = null;
  let bestD = reach;
  for (const car of sim.traffic) {
    if (car.wrecked || car.driver === 'player') continue;
    const d = Math.hypot(car.x - x, car.z - z);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

/**
 * The player's car against the fleet: a proximity test at car scale, and if it is close enough the
 * closing speed decides who loses what. A cruiser is heavier than a coupe, so it takes less.
 */
function bumpFleet(sim, dt) {
  const mine = sim.player.driving;
  if (!mine || mine.wrecked) return;
  for (const car of sim.traffic) {
    if (car === mine || car.wrecked) continue;
    const dx = car.x - mine.x;
    const dz = car.z - mine.z;
    if (Math.abs(dx) > 3.4 || Math.abs(dz) > 3.4) continue;
    const closing = Math.abs(mine.speed - (car.speed ?? 0)) + Math.hypot(mine.vx ?? 0, 0);
    // Push apart so a collision is not a permanent overlap.
    const len = Math.hypot(dx, dz) || 1;
    const push = Math.min(2.2, 0.6 + closing * 0.05) * dt * 6;
    car.x += (dx / len) * push;
    car.z += (dz / len) * push;
    mine.x -= (dx / len) * push;
    mine.z -= (dz / len) * push;
    if (closing > 4) {
      mine.speed *= 0.55;
      car.speed = Math.min(car.cruise ?? 12, (car.speed ?? 0) + closing * 0.2);
      if (sim.damage) {
        sim.damage.crash(mine, closing * 0.8);
        sim.damage.crash(car, closing * 1.1);
      }
      sim.shake = Math.max(sim.shake, Math.min(1, closing / 30));
      sim.events.onCrunch?.();
    }
  }
}

// ---------------------------------------------------------------- rounds

/** The player's shot: a round that flies and everything it might hit along the way. */
function shoot(sim, yaw) {
  const p = sim.player;
  const m = muzzlePoint(p);
  const scatter = (Math.random() - 0.5) * GUN.scatter * 2;
  const a = yaw + scatter;
  sim.rounds.push({
    x: m.x,
    y: m.y,
    z: m.z,
    vx: Math.cos(a) * GUN.muzzle,
    vz: Math.sin(a) * GUN.muzzle,
    life: 0.5,
    max: 0.5,
    yaw: a,
  });
  sim.story.shots += 1;
  sim.events.onShot?.();
  // A gunshot is loud: the crowd scatters and the department hears it.
  sim.threat = { x: m.x, z: m.z, radius: 34, strength: 1 };
  if (sim.police.stars === 0) {
    addStars(sim.police, 1, 'SHOTS FIRED');
    speak(sim.story, 'rusk', 'Somebody is shooting on my island. Every unit, move.', 3.6);
  } else if (sim.police.stars < LAW.stars && Math.random() < 0.25) {
    addStars(sim.police, 1, 'SHOTS FIRED');
  }
}

/** Advance every round in the air and resolve the first thing it meets. */
function stepRounds(sim, dt) {
  const p = sim.player;
  for (let i = sim.rounds.length - 1; i >= 0; i -= 1) {
    const r = sim.rounds[i];
    r.x += r.vx * dt;
    r.z += r.vz * dt;
    r.life -= dt;
    let spent = false;

    // A body.
    for (const person of sim.crowd) {
      if (!person.alive) continue;
      if (Math.abs(person.x - r.x) < 0.6 && Math.abs(person.z - r.z) < 0.6) {
        if (fell(person)) {
          sim.story.kills += 1;
          sim.impacts.push({ x: r.x, y: 1.2, z: r.z, size: 1.1, life: 0.28, max: 0.28, colour: '#ff5a72' });
          addStars(sim.police, 1, 'CIVILIAN DOWN');
          spent = true;
        }
        break;
      }
    }

    // A hostile — the crew a clear mission puts on a corner.
    if (!spent) {
      for (const h of sim.hostiles) {
        if (!h.alive) continue;
        if (Math.abs(h.x - r.x) < 0.8 && Math.abs(h.z - r.z) < 0.8) {
          h.alive = false;
          h.hp = 0;
          sim.story.kills += 1;
          sim.impacts.push({ x: r.x, y: 1.2, z: r.z, size: 1.2, life: 0.3, max: 0.3, colour: '#ffb060' });
          spent = true;
          break;
        }
      }
    }

    // An officer.
    if (!spent) {
      const o = officerNear(sim.police, r.x, r.z, 0.9);
      if (o) {
        o.alive = false;
        o.down = 20;
        addStars(sim.police, 2, 'OFFICER DOWN');
        sim.impacts.push({ x: r.x, y: 1.2, z: r.z, size: 1.3, life: 0.3, max: 0.3, colour: '#ff5a72' });
        spent = true;
      }
    }

    // Bodywork: the fleet, the cruisers, the wrecks.
    if (!spent) {
      const cars = [...sim.traffic, ...sim.wrecks, ...sim.police.units.filter((u) => !u.gone).map((u) => u.car)];
      for (const car of cars) {
        if (car.wrecked) continue;
        if (Math.abs(car.x - r.x) < 2.2 && Math.abs(car.z - r.z) < 2.6) {
          sim.impacts.push({ x: r.x, y: 1.0, z: r.z, size: 0.9, life: 0.22, max: 0.22, colour: '#ffe0a8' });
          if (sim.damage) sim.damage.hit(car, DAMAGE.round);
          spent = true;
          break;
        }
      }
    }

    if (!spent && r.life <= 0.22) {
      // The end of its flight: a spark off whatever it reached.
      sim.impacts.push({ x: r.x, y: r.y, z: r.z, size: 0.7, life: 0.2, max: 0.2, colour: '#ffd9a0' });
    }
    if (spent || r.life <= 0) sim.rounds.splice(i, 1);
  }

  for (let i = sim.impacts.length - 1; i >= 0; i -= 1) {
    const f = sim.impacts[i];
    f.life -= dt;
    if (f.life <= 0) sim.impacts.splice(i, 1);
  }

  // The police's own rounds are resolved in officers.js; a hit there calls back into here.
  sim.events.onHitPlayer = (amount) => {
    if (hurt(sim.player, amount)) sim.mode = 'wasted';
    sim.shake = Math.max(sim.shake, 0.3);
  };
}

/** The scare a shot or an explosion leaves, fading over a second or two. */
function decayThreat(threat, dt) {
  if (!threat) return null;
  const next = { ...threat, strength: threat.strength - dt * 0.8 };
  return next.strength > 0 ? next : null;
}

// ---------------------------------------------------------------- the explosion

/**
 * What happens when a car goes up: the shake, the sound, the sound of it reaching the player, the
 * crowd scattering, and — if it was the player's own car — a wasted screen. The wreck is moved out
 * of the lane and into the list of things that stay where they died.
 */
function onBoom(sim, car) {
  const p = sim.player;
  sim.shake = Math.max(sim.shake, 1);
  sim.events.onBoom?.();
  sim.threat = { x: car.x, z: car.z, radius: DAMAGE.chain * 4, strength: 2 };
  const near = Math.hypot(car.x - p.x, car.z - p.z);
  if (near < DAMAGE.chain * 2.4) {
    hurt(p, Math.max(0, 34 * (1 - near / (DAMAGE.chain * 2.4))));
    if (p.hp <= 0) sim.mode = 'wasted';
  }
  if (p.driving === car) {
    sim.mode = 'wasted';
    speak(sim.story, 'rusk', 'The car went up with you in it. Some nights end like that.', 5);
  }
  // Anyone standing in the ring is thrown down.
  for (const person of sim.crowd) {
    if (Math.hypot(person.x - car.x, person.z - car.z) < DAMAGE.chain) fell(person);
  }
  for (const h of sim.hostiles) {
    if (h.alive && Math.hypot(h.x - car.x, h.z - car.z) < DAMAGE.chain) {
      h.alive = false;
      h.hp = 0;
    }
  }
}

/** Move a wreck out of the traffic list so it is never driven again, and keep it drawn. */
function harvestWrecks(sim) {
  for (let i = sim.traffic.length - 1; i >= 0; i -= 1) {
    const car = sim.traffic[i];
    if (!car.wrecked) continue;
    sim.traffic.splice(i, 1);
    sim.wrecks.push(car);
  }
  // A wreck is scenery after a minute: the smoke stops, the shell stays.
  if (sim.wrecks.length > 14) sim.wrecks.shift();
}

// ---------------------------------------------------------------- the story

/** A mission passed: the crew it needed is stood down, the next marker is fresh. */
function onMissionPassed(sim, mission) {
  sim.hostiles = [];
  sim.crewDown = 0;
  sim.events.onMission?.(mission);
  sim.events.onSave?.(sim);
  void mission;
}

/**
 * The hostile crew a `clear` mission puts on its corner. Spawned when the player comes within sight
 * of the marker, once per mission; they stand, they shoot, and they count toward the mission's need.
 */
export function armCrew(sim) {
  const m = currentMission(sim.story);
  if (!m || m.beat !== 'clear' || sim.hostiles.length > 0) return;
  const p = sim.player;
  if (Math.hypot(m.at.x - p.x, m.at.z - p.z) > 120) return;
  const need = m.need ?? 3;
  for (let i = 0; i < need; i += 1) {
    const a = (i / need) * Math.PI * 2;
    sim.hostiles.push({
      x: m.at.x + Math.cos(a) * 6,
      z: m.at.z + Math.sin(a) * 6,
      yaw: Math.atan2(p.z - m.at.z, p.x - m.at.x),
      alive: true,
      hp: 100,
      cd: 0.6 + i * 0.3,
      flash: 0,
    });
  }
  speak(sim.story, 'juno', 'They have seen you. Do not let them spread out.', 4);
}

/** Step the hostiles: they hold their corner, they shoot, and the count of the down ones is read. */
export function tickHostiles(sim, dt) {
  const p = sim.player;
  const target = p.driving ?? p;
  let down = 0;
  for (const h of sim.hostiles) {
    if (!h.alive) {
      down += 1;
      continue;
    }
    const d = Math.hypot(h.x - target.x, h.z - target.z);
    h.yaw = Math.atan2(target.z - h.z, target.x - h.x);
    h.flash = Math.max(0, h.flash - dt * 4);
    if (d < 46) {
      h.cd -= dt;
      if (h.cd <= 0) {
        h.cd = 0.9 + Math.random() * 0.7;
        h.flash = 1;
        const a = h.yaw + (Math.random() - 0.5) * 0.14;
        sim.police.rounds.push({ x: h.x + Math.cos(a) * 0.7, y: 1.3, z: h.z + Math.sin(a) * 0.7, vx: Math.cos(a) * 120, vz: Math.sin(a) * 120, life: 0.5, max: 0.5, yaw: a, from: h });
      }
    }
  }
  sim.crewDown = down;
}

// ---------------------------------------------------------------- the run

/** Start a run properly: the story opens with a line, the light is set, the save is read by main. */
export function startRun(sim) {
  sim.mode = 'play';
  const m = currentMission(sim.story);
  if (m) {
    speak(sim.story, m.who, m.say, 6);
    announce(sim.story, `THE LONG SHADOW · ${m.title.toUpperCase()}`, 4);
  }
  sim.player.hp = sim.player.hpMax;
  sim.player.clip = GUN.magazine;
  sim.player.ammo = GUN.pouch;
}

/** Put the player back on their feet after a wasted or busted screen. */
export function respawn(sim) {
  const p = sim.player;
  sim.police.rounds = [];
  sim.rounds = [];
  sim.impacts = [];
  p.hp = p.hpMax;
  p.armour = 0;
  p.clip = GUN.magazine;
  p.ammo = Math.max(p.ammo, 24);
  p.dead = false;
  if (p.driving) {
    leaveCar(p, sim.plan);
    p.driving = null;
  }
  const m = currentMission(sim.story);
  const at = m ? m.at : { x: 96, z: 1520 };
  p.x = at.x + 12;
  p.z = at.z + 12;
  p.yaw = -Math.PI / 2;
  p.aimYaw = p.yaw;
  sim.mode = 'play';
  clearStars(sim.police);
  sim.hostiles = [];
  sim.crewDown = 0;
  sim.story.cash = Math.max(0, sim.story.cash - 100);
  announce(sim.story, 'HOSPITAL BILL · $100 · BACK ON THE STREET', 3.6);
}

/** Wipe the run and start the chain over. */
export function restartRun(sim) {
  sim.story = newStory();
  sim.player = newPlayer(sim.plan);
  sim.police = newPolice();
  sim.traffic = newTraffic(sim.plan, sim.seed);
  sim.crowd = newCrowd(sim.plan, sim.seed);
  sim.work = newSideWork(sim.plan);
  sim.wrecks = [];
  sim.rounds = [];
  sim.impacts = [];
  sim.hostiles = [];
  sim.crewDown = 0;
  sim.time = 0;
  sim.mode = 'play';
  sim.rig = rigAt(sim.story.hour);
  startRun(sim);
}

/** The objective the GPS is routing to: the mission, or the fare if one is aboard. */
export function objectiveOf(sim) {
  const side = sideObjective(sim);
  if (side) return side;
  const m = currentMission(sim.story);
  if (!m) return null;
  return { at: m.at, name: m.title.toUpperCase(), accent: '#ffd23c', kind: 'mission', mission: m };
}

/** The line under the objective, for the HUD. */
export function missionText(sim) {
  const m = currentMission(sim.story);
  return m ? m.line : 'THE LONG SHADOW IS CLOSED · THE CITY IS YOURS';
}

export { dispatchOf, WORK, LAW, heal, makeCar };
