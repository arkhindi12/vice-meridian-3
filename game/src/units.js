// units.js — the numbers the city is measured in, and its palette.
//
// One unit is one metre. Nine avenues on a 300 m pitch, each 46 m wide from kerb to kerb: 2.4 km
// across, which a car crosses in about a minute and a chase needs to breathe. Between two avenues
// sits a 254 m block with a 13 m pavement ring for the crowd, the shopfronts and the neon.
//
// Everything else in the game asks this file how big a thing is, so a car, a door and a bullet
// cannot disagree about scale. The colours live here too, for the same reason: three of them do the
// talking (pink for the city's own light, cyan for what the player owns, gold for the law), and no
// module keeps a private copy that can drift.

export const GRID = {
  cols: 9,
  rows: 9,
  pitch: 300,
  half: 23, // avenue centre line to kerb
  setback: 13, // pavement depth, kerb to frontage
  storey: 3.7,
};

// The town in world coordinates: the outer kerbs bound the drivable ground.
export const CITY = {
  first: -GRID.half,
  last: (GRID.cols - 1) * GRID.pitch + GRID.half,
  blockSide: GRID.pitch - GRID.half * 2,
};

/** The avenue centre lines, on both axes: the lattice the city — and the route — is built on. */
export const AVENUES = Object.freeze(Array.from({ length: GRID.cols }, (_, i) => i * GRID.pitch));

// The shoreline. The promenade starts at the first avenue's west kerb, sand follows it, then water:
// close enough that a car on the coast road has the sea in the corner of the windscreen.
export const SHORE = {
  kerb: -GRID.half,
  promenade: -96,
  sand: -150,
  water: -196,
  quay: CITY.last,
  bay: CITY.last + 40,
};

// On foot.
export const GAIT = {
  walk: 4.3,
  sprint: 8.8,
  pivot: 12,
  girth: 0.42,
  reach: 3.8,
};

// Behind the wheel. vmax 41 m/s is 148 km/h: enough that the speedometer has a top end.
export const DRIVE = {
  vmax: 41,
  vreverse: 12,
  push: 10.4,
  stop: 26,
  coast: 2.2,
  steer: 1.95,
};

// The pistol.
export const GUN = {
  magazine: 15,
  pouch: 60,
  reloadTime: 1.15,
  cycle: 0.16,
  reach: 95,
  muzzle: 210,
  scatter: 0.02,
};

export const CROWD = { size: 132, stroll: [1.0, 1.9], bolt: 5.4, panic: 3.2 };

export const FLEET = { size: 44 };

// The law: one cruiser per star up to five, two officers a cruiser, a heat that only drains once
// nobody has had eyes on the player for a while.
export const LAW = {
  stars: 5,
  perStar: [0, 1, 2, 3, 4, 5],
  crew: 2,
  run: 5.7,
  walk: 3.1,
  volley: 0.64,
  round: 150,
  range: 58,
  blindAfter: 9,
  drainTime: 7,
  spawnNear: 175,
  spawnFar: 255,
  dismount: 34,
  airFrom: 4,
};

// Air support: an orbit round the player, high enough to clear the towers and low enough that the
// searchlight reaches the street at a readable angle.
export const AIR = {
  radius: 42,
  alt: 38,
  orbit: 0.28,
  cone: 0.1,
  poolRadius: 6.5,
  reach: 165,
  fadeIn: 1.3,
};

// A car is a body with a condition. These are the thresholds every system agrees on.
export const DAMAGE = {
  smokeAt: 25,
  fireAt: 15,
  max: 100,
  ram: 0.09, // condition lost per m/s of closing speed in a collision
  round: 7.5, // a pistol round through the bodywork
  chain: 26, // metres: a car this close to an explosion catches fire
  burnTime: 0.9, // seconds a burning car takes to reach zero
  scorchRadius: 6.4,
};

// Side work pays. Rates are per second or per job.
export const WORK = {
  taxiFare: 180,
  taxiFar: 320,
  respray: 250,
  tapeReward: 60,
  tapes: 12,
  airtimeRate: 140, // dollars per second of air
  stuntMin: 0.35,
};

// Sky and light. The rig reads these as the neutral midday state; the cycle moves them.
export const PAINT = {
  asphalt: '#5b5867',
  laneDash: '#f2e2b0',
  centre: '#ffcf5a',
  crossing: '#fbf4e2',
  kerb: '#c9b79c',
  pavement: '#bda88f',
  grass: '#4e8b5d',
  dune: '#efd2a4',
  water: '#0d6b7c',
  facades: ['#a35c4a', '#b8845e', '#6f5a86', '#456a68', '#b39b82', '#8c4a44', '#4e6088', '#c3ab92', '#96634f'],
  curtain: ['#22414f', '#2c3850', '#3a5250', '#4e3550'],
  neon: ['#ff2f86', '#22e6d0', '#ffd23c', '#8f5bff', '#ff7a30', '#3d8bff'],
  skins: ['#f1c7a0', '#d9a06b', '#a86b3f', '#7a4a2a', '#e8b98c', '#f6d9c1'],
  tops: ['#ff3d7f', '#22e6d0', '#ffd23c', '#f4efe3', '#3d8bff', '#8f5bff', '#ff7a30', '#63d07a', '#e8483f'],
  legs: ['#26324a', '#2f2f36', '#e6e0d2', '#5b4530', '#37415a', '#1f1f26'],
  cars: ['#ff3d7f', '#22e6d0', '#ffd23c', '#f2f0ea', '#232331', '#8f5bff', '#e8483f', '#177d95', '#ff7a30', '#0f5f8a'],
};
