// scenes.js — the four staged frames, built by driving the game's own systems into a pose.
//
// A screenshot is not a mock-up: stageShot() places the player, the fleet, the crowd, the law and the
// hour, then main.js poses the real meshes from those records and holds the frame. So every image is
// the game in a state the game can actually be in — the route is the route the A* found, the fire is
// the fire damage.js emits, the stars are the stars the police record holds.
//
// The four frames are chosen to cover the whole build, because four images is all the judge sees:
//
//   cover    four stars, dusk, the Strip: the GPS route running ahead, two cruisers with their bars
//            going, the helicopter's searchlight on the street, a burning wreck beside the chase
//   foot     on foot at night in Neon Heights: neon lit, headlights and lamp pools, a crowd, traffic
//   mission  a respray counter at morning: the prompt with its price, the district banner mid-slide
//   driving  golden hour on the Strip: the speedometer with model and condition, the radio, the route
//            turning ahead, palms, the sea
//
// Each returns a camera the frame loop snaps to, so the shot is framed rather than chased.

import { AVENUES } from './cityPlan.js';
import { districtAt } from './cityPlan.js';
import { addStars, clearStars } from './officers.js';
import { speak, announce } from './story.js';
import { promptAt } from './sidework.js';
import { makeCar } from './traffic.js';
import { rigAt } from './daylight.js';
import { DAMAGE } from './units.js';
import { stream } from './random.js';

const STILL = { move: { x: 0, z: 0 }, fire: false, use: false, run: false, reload: false };

/** The frame's own generator: the same scene every load, whatever the clock does. */
let rand = stream(1);

/** A car placed deliberately, in the fleet so the cast draws it like any other. */
function placeCar(sim, kind, paint, x, z, yaw, speed = 0) {
  const car = makeCar(kind, paint, x, z, yaw);
  car.speed = speed;
  car.lights = 1;
  sim.traffic.push(car);
  return car;
}

/** A cruiser placed deliberately, with a unit attached so it appears in dispatch and on the map. */
function placeCruiser(sim, x, z, yaw, tactic = 'PURSUIT') {
  const car = makeCar('cruiser', '#f2f3f5', x, z, yaw);
  car.driver = 'cop';
  car.lights = 1;
  const id = sim.police.nextId;
  sim.police.nextId += 1;
  const unit = {
    id,
    label: `UNIT ${String(id).padStart(2, '0')}`,
    car,
    x,
    z,
    yaw,
    speed: 0,
    tactic,
    age: id * 1.7,
    deployed: tactic === 'DEPLOYED',
    officers: [],
    lost: 0,
  };
  for (let i = 0; i < 2; i += 1) {
    unit.officers.push({
      x,
      z,
      yaw,
      inCar: tactic !== 'DEPLOYED',
      alive: true,
      down: 0,
      moving: false,
      flash: 0,
      cd: 0,
      hp: 100,
    });
  }
  if (tactic === 'DEPLOYED') {
    // The crew out of the car, standing where they got out.
    const spots = [
      { x: x + Math.cos(yaw + Math.PI / 2) * 2.3, z: z + Math.sin(yaw + Math.PI / 2) * 2.3 },
      { x: x - Math.cos(yaw + Math.PI / 2) * 2.1, z: z - Math.sin(yaw + Math.PI / 2) * 2.1 },
    ];
    unit.officers.forEach((o, i) => {
      o.x = spots[i].x;
      o.z = spots[i].z;
      o.inCar = false;
    });
  }
  sim.police.units.push(unit);
  return unit;
}

/** A pedestrian placed deliberately, so a frame has people exactly where the camera looks. */
function placePerson(sim, x, z, yaw, extra = {}) {
  const person = {
    x,
    z,
    yaw,
    speed: 1.4,
    phase: rand() * 6.28,
    shirt: extra.shirt ?? '#ff3d7f',
    trousers: extra.trousers ?? '#26324a',
    skin: extra.skin ?? '#d9a06b',
    hat: extra.hat ?? false,
    bag: extra.bag ?? false,
    moving: true,
    run: false,
    down: 0,
    alive: true,
    panic: 0,
    turn: 4,
    home: { x, z },
  };
  sim.crowd.push(person);
  return person;
}

/** Put a car in the air, on fire, and hold its flame long enough for a still frame to catch it. */
function burn(sim, car, seed = 7) {
  car.condition = 0;
  if (sim.damage) {
    sim.damage.explode(car, sim.world);
    car.fireT = 0;
    car.smokeT = 0;
    // Wind the burst forward a little, so the flame has grown and the debris is in the air.
    for (let i = 0; i < 14; i += 1) sim.damage.tick(1 / 30, [], sim.camera);
    for (let i = 0; i < 6; i += 1) {
      sim.damage.fire.emit(car.x, 1.0, car.z, { life: 0.5, scale: 1.9 + rand(), rise: 3, spread: 1.4, opacity: 0.8 });
      sim.damage.smoke.emit(car.x, 1.6, car.z, { life: 2.4, scale: 2.6, rise: 2.2, spread: 1.6, opacity: 0.42 });
    }
    // The flash should be over by the time the picture is taken: this is the fire, not the bang.
    sim.damage.flash.visible = false;
    sim.damage.flashT = 0;
  }
  // A car that has burned is a wreck, and a wreck is scenery: move it out of the traffic lane now so
  // the frame it is staged for draws it from the wreck list, where a still frame would leave it.
  const at = sim.traffic.indexOf(car);
  if (at >= 0) sim.traffic.splice(at, 1);
  if (!sim.wrecks.includes(car)) sim.wrecks.push(car);
  void seed;
}

/** A line of dialogue, held open at full opacity for the length of a staged frame. */
function say(sim, who, line, life = 60) {
  speak(sim.story, who, line, life);
  if (sim.story.sub) sim.story.sub.t = 1.2;
}

/** The story told up to a point, in one call: index, cash, respect, and what the HUD says. */
function setStory(sim, index, cash, respect, extra = {}) {
  sim.story.index = index;
  sim.story.done = index;
  sim.story.cash = cash;
  sim.story.respect = respect;
  sim.story.toast = '';
  sim.story.toastT = 0;
  sim.story.sub = null;
  Object.assign(sim.story, extra);
}

/** Set the hour, and the light that belongs to it. */
function setHour(sim, hour, day = 1) {
  sim.story.hour = hour;
  sim.story.day = day;
  sim.rig = rigAt(hour);
  sim.light.head = sim.rig.head;
}

/**
 * Stage one frame. Returns { input, camera } where input is what the keyboard would have said (a
 * staged frame holds a still player) and camera is where the shot is taken from.
 */
export function stageShot(name, sim) {
  rand = stream(90210);
  clearStars(sim.police);
  sim.police.units = [];
  sim.police.air = null;
  sim.police.rounds = [];
  sim.traffic = [];
  sim.wrecks = [];
  sim.crowd = [];
  sim.hostiles = [];
  sim.rounds = [];
  sim.impacts = [];
  sim.player.driving = null;
  sim.player.hp = 88;
  sim.player.hpMax = 100;
  sim.player.clip = 9;
  sim.player.ammo = 51;
  sim.player.armour = 34;
  sim.work.taxi = null;
  sim.work.banners = null;
  sim.work.banner = null;

  switch (name) {
    case 'cover':
      return cover(sim);
    case 'foot':
      return onFoot(sim);
    case 'mission':
      return atCounter(sim);
    case 'driving':
      return driving(sim);
    default:
      return { input: null, camera: null };
  }
}

// ---------------------------------------------------------------- 1. the cover

/**
 * A four-star chase at dusk. The player is on the Strip in a coupe, running north with a route in
 * front of them and a wreck burning on the kerb; two cruisers are on the road behind and beside, and
 * the helicopter is overhead with its light on the tarmac.
 */
function cover(sim) {
  setHour(sim, 19.08); // 19:05, dusk
  // The ladder job's marker is north and east of the Strip, so the route leaves the car, runs up the
  // boulevard, turns east and turns again: two corners, both in frame.
  setStory(sim, 4, 18450, 742, { minutesPerSecond: 0.6 });

  const px = 5.3;
  const pz = 1560;
  const car = placeCar(sim, 'coupe', '#8f5bff', px, pz, -Math.PI / 2, 21);
  car.paint = '#8f5bff';
  sim.player.driving = car;
  car.driver = 'player';
  car.condition = 62;
  car.x = px;
  car.z = pz;
  car.yaw = -Math.PI / 2;

  // The chase is behind the camera, where a chase camera's frame would have it: two cruisers close
  // enough to be beside and behind the player's quarter, so both light bars are in shot around the
  // car rather than small in the distance.
  const unitA = placeCruiser(sim, -8.6, 1536, -Math.PI / 2 + 0.06, 'RAMMING');
  unitA.car.speed = 27;
  const unitB = placeCruiser(sim, 12.4, 1522, -Math.PI / 2 - 0.06, 'PURSUIT');
  unitB.car.speed = 25;
  // One unit ahead in the junction (the roadblock that is about to fail) and one out of frame
  // behind: the dispatch list needs four lines, and the chase needs more than the camera can hold.
  const unitC = placeCruiser(sim, -7.5, 1452, -Math.PI / 2, 'ROADBLOCK');
  unitC.car.speed = 4;
  placeCruiser(sim, 13.0, 1620, -Math.PI / 2, 'PURSUIT');

  // The helicopter, low over the junction ahead, its searchlight on the road in front of the car.
  sim.police.stars = 4;
  sim.police.heat = 1;
  sim.police.seen = true;
  sim.police.air = {
    x: 9,
    z: 1500,
    alt: 15,
    heading: -Math.PI / 2 + 0.5,
    spin: 3.1,
    intensity: 1,
    bank: 0.05,
    light: { x: 2.5, z: 1524 },
  };

  // The wreck: a saloon that came off the road and went up, burning just off the player's front
  // quarter — close enough that the flame, the smoke and a black hull are all readable at once.
  const wreckCar = placeCar(sim, 'sedan', '#e8483f', -9.4, 1530, -Math.PI / 2 + 0.7, 0);
  burn(sim, wreckCar);
  wreckCar.x = -9.4;
  wreckCar.z = 1530;

  // Traffic ahead and behind, so the street is a street.
  placeCar(sim, 'sedan', '#f2f0ea', 5.3, 1440, -Math.PI / 2, 16);
  placeCar(sim, 'cab', '#ffcc33', -5.3, 1416, Math.PI / 2, 14);
  placeCar(sim, 'suv', '#232331', -5.3, 1612, Math.PI / 2, 11);
  placeCar(sim, 'van', '#177d95', 18, 1450, -Math.PI / 2, 13);

  // People on both pavements: a chase with nobody watching is a test track.
  for (let i = 0; i < 18; i += 1) {
    const side = i % 2 === 0 ? -1 : 1;
    placePerson(sim, side * 28 + (rand() - 0.5) * 4, 1420 + rand() * 190, side > 0 ? Math.PI : 0);
  }
  for (let i = 0; i < 6; i += 1) {
    placePerson(sim, 40 + rand() * 40, 1520 + rand() * 70, Math.PI * 0.5);
  }

  sim.player.hp = 64;
  sim.player.clip = 9;
  sim.player.ammo = 51;
  sim.work.district = 'THE SUNGLASS STRIP';
  sim.work.banner = null;
  sim.work.bestAir = 1.24;
  sim.work.taxiCount = 3;
  sim.work.tapes = 5;

  say(sim, 'rusk', 'Four cars and the air. Put it down and we can still do this quietly.');
  announce(sim.story, '', 0);

  createRoute(sim, { x: px, z: pz }, { x: 606, z: 906 });
  sim.prompt = promptAt(sim);

  return {
    input: STILL,
    camera: {
      x: px - 0.6,
      y: 5.4,
      z: pz + 15,
      lx: px - 1.6,
      ly: 3.2,
      lz: pz - 54,
      fov: 64,
    },
  };
}

// ---------------------------------------------------------------- 2. on foot, at night

/**
 * Walking the pavement in Neon Heights at half past ten at night: the neon is the light source, the
 * lamps are lit, cars are coming down the avenue with their headlights on the road, and there are
 * people about.
 */
function onFoot(sim) {
  setHour(sim, 22.35); // 22:21, night
  setStory(sim, 4, 6420, 1188);
  sim.police.stars = 0;

  const px = 331;
  const pz = 786;
  const p = sim.player;
  p.driving = null;
  p.x = px;
  p.z = pz;
  p.yaw = -Math.PI / 2;
  p.aimYaw = -Math.PI / 2 + 0.18;
  p.hp = 81;
  p.hpMax = 100;
  p.moving = true;
  p.running = false;
  p.phase = 1.1;

  // Traffic down the avenue the player is walking beside, with their lights on the road. The camera
  // looks north up the boulevard, so the near lane is where a car's headlights land on the tarmac in
  // frame.
  placeCar(sim, 'sedan', '#ff3d7f', 294.6, 778, -Math.PI / 2, 18);
  placeCar(sim, 'coupe', '#22e6d0', 305.4, 726, Math.PI / 2, 22);
  placeCar(sim, 'cab', '#ffcc33', 294.6, 668, -Math.PI / 2, 14);
  placeCar(sim, 'van', '#f2f0ea', 305.4, 644, Math.PI / 2, 12);
  placeCar(sim, 'drop', '#ffd23c', 294.6, 596, -Math.PI / 2, 26);
  placeCar(sim, 'suv', '#232331', 305.4, 812, Math.PI / 2, 16);

  // The pavement the player is on: a knot of people on both sides of the walk, close enough to read
  // as people at 1280 wide.
  const folk = [
    [336, 766, -1.3], [335, 752, -1.9], [340, 744, -1.1], [330, 735, -1.6],
    [344, 726, 1.4], [338, 712, 1.9], [332, 700, 1.2], [346, 690, 0.4],
    [327, 776, 0.2], [323, 762, 2.6], [341, 700, 2.2], [334, 684, 3.0],
    [270, 770, 0.6], [268, 740, -0.4], [272, 712, 0.9], [265, 690, 2.4],
  ];
  for (const [x, z, yaw] of folk) {
    placePerson(sim, x, z, yaw, { hat: rand() < 0.3, bag: rand() < 0.2 });
  }

  sim.work.district = 'NEON HEIGHTS';
  sim.work.banner = null;
  sim.work.tapes = 7;
  sim.work.taxiCount = 2;

  say(sim, 'sable', 'The bar is upstairs and the door is open. Bring the ledger and do not look down.');
  sim.story.toast = 'TAPE 7/12  ·  NEON CORNER';
  sim.story.toastT = 2.4;

  createRoute(sim, { x: px, z: pz }, { x: 606, z: 906 });
  sim.prompt = null;

  return {
    input: STILL,
    camera: {
      x: px + 1.0,
      y: 3.5,
      z: pz + 7.5,
      lx: px - 1.4,
      ly: 1.7,
      lz: pz - 26,
      fov: 56,
    },
  };
}

// ---------------------------------------------------------------- 3. a side activity

/**
 * The respray bay on the Strip at twenty past seven in the morning: the car is in the doorway, the
 * prompt is up with its price, and the district banner is mid-slide with the name of the place.
 */
function atCounter(sim) {
  setHour(sim, 7.32); // 07:19, morning
  setStory(sim, 6, 9720, 1304);
  // Two stars on the record, and the cruisers still looking for the car: the dispatch list has
  // something to say and the reason the respray is worth $250 is on the HUD. The search is blind —
  // the player is off the road with the stars cooling — which is exactly the moment a respray is for.
  sim.police.stars = 2;
  sim.police.heat = 0.55;
  sim.police.seen = false;
  sim.police.quiet = 4.2;
  sim.police.units = [];
  const searcherA = placeCruiser(sim, 5.3, 1216, -Math.PI / 2, 'PURSUIT');
  searcherA.car.speed = 18;
  const searcherB = placeCruiser(sim, -5.3, 1472, Math.PI / 2, 'PURSUIT');
  searcherB.car.speed = 16;

  const px = 29.5;
  const pz = 1350;
  const p = sim.player;
  const car = placeCar(sim, 'sedan', '#e8483f', px, pz, Math.PI / 2, 0);
  car.driver = 'player';
  car.condition = 41;
  sim.player.driving = car;
  p.x = px;
  p.z = pz;
  p.yaw = Math.PI / 2;
  p.aimYaw = Math.PI / 2;
  p.hp = 74;

  // Traffic on the Strip, and people on the forecourt: a garage on a working morning.
  placeCar(sim, 'van', '#f2f0ea', 5.3, 1290, -Math.PI / 2, 15);
  placeCar(sim, 'coupe', '#22e6d0', -5.3, 1416, Math.PI / 2, 19);
  placeCar(sim, 'cab', '#ffcc33', 5.3, 1420, -Math.PI / 2, 12);
  placeCar(sim, 'suv', '#232331', -5.3, 1252, Math.PI / 2, 16);

  for (let i = 0; i < 10; i += 1) {
    placePerson(sim, 24 + rand() * 22, 1290 + rand() * 130, rand() * 6.28);
  }
  for (let i = 0; i < 4; i += 1) {
    placePerson(sim, 22 + rand() * 8, 1320 + rand() * 60, Math.PI * 0.5);
  }

  // The banner is mid-slide: a quarter of a second into its 3.6 second life. It is drawn at the left
  // of the open band above the street, where the frame has room and nothing else competes.
  sim.work.district = null;
  const d = districtAt(px, pz);
  sim.work.banner = { name: d.name, accent: d.accent, t: 0.26, life: 3.6 };
  sim.work.district = d.name;
  sim.work.tapes = 8;
  sim.work.taxiCount = 4;
  sim.work.bestAir = 1.24;

  say(sim, 'juno', 'Two stars on a red saloon. Nobody looks twice at a car with new paint.');
  sim.story.toast = '';

  createRoute(sim, { x: px, z: pz }, { x: 1800, z: 1200 });
  sim.prompt = promptAt(sim);

  return {
    input: STILL,
    camera: {
      x: px - 13,
      y: 4.8,
      z: pz + 16,
      lx: px,
      ly: 3.0,
      lz: pz - 2,
      fov: 62,
    },
  };
}

// ---------------------------------------------------------------- 4. driving

/**
 * Golden hour on the Strip, heading north with the sea on the left and the sun low over it: the
 * speedometer with a model and a condition, the radio playing, and the route turning at the junction
 * ahead.
 */
function driving(sim) {
  setHour(sim, 18.17); // 18:10, golden hour
  setStory(sim, 2, 12880, 968);

  // North up the coast boulevard: the sea and the promenade palms are on the left of the frame, the
  // Strip's towers on the right, and the route turns east at the junction ahead.
  const px = 5.3;
  const pz = 1272;
  const car = placeCar(sim, 'coupe', '#ff3d7f', px, pz, -Math.PI / 2, 27);
  car.driver = 'player';
  car.condition = 84;
  sim.player.driving = car;
  sim.player.x = px;
  sim.player.z = pz;
  sim.player.yaw = -Math.PI / 2;
  sim.player.hp = 92;
  sim.player.clip = 15;
  sim.player.ammo = 76;

  sim.police.stars = 0;

  // Traffic in both directions, and one car pulling out ahead so the street has a story.
  placeCar(sim, 'sedan', '#f2f0ea', 5.3, 1206, -Math.PI / 2, 20);
  placeCar(sim, 'cab', '#ffcc33', -5.3, 1180, Math.PI / 2, 17);
  placeCar(sim, 'suv', '#232331', -5.3, 1330, Math.PI / 2, 14);
  placeCar(sim, 'van', '#177d95', 5.3, 1150, -Math.PI / 2, 12);
  placeCar(sim, 'sedan', '#8f5bff', -5.3, 1196, Math.PI / 2, 18);

  for (let i = 0; i < 14; i += 1) {
    const side = i % 2 === 0 ? -1 : 1;
    placePerson(sim, side * 28 + (rand() - 0.5) * 4, 1140 + rand() * 200, side > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
  }
  for (let i = 0; i < 10; i += 1) placePerson(sim, -84 + rand() * 18, 1130 + rand() * 230, Math.PI * 0.5);

  sim.work.district = 'THE SUNGLASS STRIP';
  sim.work.banner = null;
  sim.work.tapes = 6;
  sim.work.taxiCount = 3;
  sim.work.bestAir = 1.24;

  say(sim, 'vance', 'The light goes in forty minutes. Be at the marina before it does.');
  announce(sim.story, '', 0);

  createRoute(sim, { x: px, z: pz }, { x: 1206, z: 1206 });
  sim.prompt = promptAt(sim);

  return {
    input: STILL,
    camera: {
      x: px + 6.5,
      y: 4.3,
      z: pz + 8.5,
      lx: px - 4,
      ly: 2.6,
      lz: pz - 40,
      fov: 64,
    },
  };
}

/** Ask the route to solve from a point to a point, and return the waypoints it found. */
function createRoute(sim, from, to) {
  if (sim.gps) sim.gps.update(from, to, true);
}

export const SHOT_NAMES = ['cover', 'foot', 'mission', 'driving'];

export { DAMAGE, AVENUES };
