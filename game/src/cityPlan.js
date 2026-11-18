// cityPlan.js — the town as plain records, and the questions the rest of the game asks of it.
//
// No meshes, no three.js. This module decides what stands where and answers "may a body stand at
// this point", "is this the sea", "which avenue is nearest" and "which district is this". The
// renderer builds its geometry from these same records and the collision tests read them too, so
// what you can see and what you can walk into can never disagree.
//
// A block is the square between four avenues. Its buildings stand one pavement-depth inside the
// kerb, which leaves a walking ring around every block — that ring is where the crowd lives and
// where the shopfronts and neon face. Three coast blocks carry a shop on a paved forecourt, which
// is what gives the Strip its arms dealer, its respray garage and its clothier.

import { GRID, CITY, SHORE, PAINT, AVENUES } from './units.js';
import { stream } from './random.js';

export const PITCH = GRID.pitch;
export const KERB = GRID.half;
export const WALK = GRID.setback;

export const EDGE = { x0: SHORE.water, x1: CITY.last, z0: CITY.first, z1: SHORE.bay };
export { CITY, SHORE, AVENUES };

/** The three shops, by block. The frontage faces west onto the coast boulevard. */
export const SHOPS = [
  { id: 'gun', name: 'IRONSIDE ARMS', strap: 'AMMO · NO QUESTIONS', kind: 'gun', block: [0, 2], accent: '#ff2f86', price: 350, effect: '+45 ROUNDS OF 9MM' },
  { id: 'garage', name: 'SOLEIL GARAGE', strap: 'PANEL & PAINT', kind: 'garage', block: [0, 4], accent: '#22e6d0', price: 420, effect: 'FULL REPAIR + TYRES' },
  { id: 'clothier', name: 'CASA VELA', strap: 'TAILORED FOR THE HEAT', kind: 'clothier', block: [0, 6], accent: '#ffd23c', price: 600, effect: 'MAX HEALTH +20 · FULL HEAL' },
];

/**
 * The four districts. Ordered: the first that holds the point names it, and the last holds
 * everything, so every square metre of the map has exactly one name and the banner can never be
 * blank. `accent` is the colour the banner and the minimap caption take.
 */
export const DISTRICTS = [
  { id: 'strip', name: 'THE SUNGLASS STRIP', accent: '#22e6d0', holds: (x) => x < 340 },
  { id: 'neon', name: 'NEON HEIGHTS', accent: '#ff2f86', holds: (x, z) => x < 1680 && z >= 280 && z < 1720 },
  { id: 'dockside', name: 'DOCKSIDE', accent: '#ffd23c', holds: (x) => x >= 1680 },
  { id: 'coral', name: 'CORAL STRAND', accent: '#ff7a30', holds: () => true },
];

/** The district record a point falls in. Never null. */
export function districtAt(x, z) {
  for (const d of DISTRICTS) if (d.holds(x, z)) return d;
  return DISTRICTS[DISTRICTS.length - 1];
}

// ---------------------------------------------------------------- side work sites

/**
 * Where the side work lives. Each is a marker on the minimap and a prompt when the player is close:
 * a taxi rank that pays for a fare, a ramp on the Strip that pays for air, and the garage that sells
 * a respray and a clean record. The tapes are their own list below.
 */
export function sideSites() {
  return [
    {
      id: 'taxi',
      kind: 'taxi',
      name: 'TAXI RANK',
      strap: 'FARE WAITING',
      at: { x: 30, z: 1834 },
      accent: '#ffd23c',
      radius: 9,
      price: 0,
    },
    {
      id: 'respray',
      kind: 'respray',
      name: 'RESPRAY',
      strap: 'WANTED STARS CLEARED',
      at: { x: 29.5, z: 1350 },
      accent: '#22e6d0',
      radius: 10,
      price: 250,
    },
    {
      id: 'stunt',
      kind: 'stunt',
      name: 'STUNT RAMP',
      strap: 'PAYS FOR AIRTIME',
      at: { x: -11, z: 1420 },
      accent: '#ff7a30',
      radius: 12,
      price: 0,
    },
  ];
}

/** The twelve tapes, hand-placed: on corners, a forecourt, the beach, the pier, a park. */
export const TAPE_SPOTS = [
  { x: 30, z: 210, name: 'IRONSIDE FORECOURT' },
  { x: -150, z: 470, name: 'THE SAND' },
  { x: 292, z: 620, name: 'NEON CORNER' },
  { x: 610, z: 320, name: 'PARK BENCH' },
  { x: 905, z: 1180, name: 'TOWER LOBBY' },
  { x: 1210, z: 640, name: 'PARKING DECK' },
  { x: 1510, z: 1440, name: 'ALLEY MOUTH' },
  { x: 1790, z: 300, name: 'DOCKSIDE CRANE' },
  { x: 2110, z: 900, name: 'CONTAINER ROW' },
  { x: 2380, z: 2180, name: 'PIER HEAD' },
  { x: 150, z: 1500, name: 'GARAGE ROOF' },
  { x: 120, z: 2010, name: 'CORAL BOARDWALK' },
];

export class CityPlan {
  constructor(seed = 1) {
    this.seed = seed;
    this.blocks = [];
    this.buildings = [];
    this.parks = [];
    this.plazas = [];
    this.shops = [];
    this.sites = sideSites();
    this.tapes = TAPE_SPOTS.map((t, i) => ({ ...t, id: `tape-${i + 1}`, index: i, taken: false }));
    this.survey(stream(seed));
    this.placeShops();
  }

  /**
   * Walk the lattice once and give every block a character, then fill it. `centrality` is 1 at the
   * middle of town and 0 at the edge: glass towers where the money is, low busy shopfronts out on
   * the rim, which is what makes a skyline read from the water.
   */
  survey(rand) {
    for (let row = 0; row < GRID.rows - 1; row += 1) {
      for (let col = 0; col < GRID.cols - 1; col += 1) {
        const block = {
          col,
          row,
          x: col * PITCH + KERB,
          z: row * PITCH + KERB,
          w: CITY.blockSide,
          h: CITY.blockSide,
          centrality: Math.max(0, 1 - Math.hypot((col - 4.4) / 3.4, (row - 4.4) / 3.6)),
          kind: 'street',
        };
        const roll = rand();
        if (block.centrality > 0.2 && roll < 0.86) block.kind = 'tower';
        else if (roll < 0.1) block.kind = 'park';
        for (const shop of SHOPS) if (shop.block[0] === col && shop.block[1] === row) block.kind = 'shop';
        this.blocks.push(block);

        if (block.kind === 'park') {
          this.parks.push({ block, x: block.x, z: block.z, w: block.w, h: block.h, palms: rand.int(16, 24) });
        } else if (block.kind === 'shop') {
          this.plazas.push({ block, x: block.x, z: block.z, w: 78, h: block.h });
          this.arcade(block, rand);
        } else {
          this.lots(block, rand);
        }
      }
    }
  }

  /** A shop block's back half: one long three-storey arcade of small frontages. */
  arcade(block, rand) {
    const x = block.x + 84;
    const w = block.w - 92;
    const z = block.z + 10;
    const d = block.h - 20;
    const bays = 4;
    for (let i = 0; i < bays; i += 1) {
      const bayH = d / bays;
      const floors = rand.int(2, 4);
      this.buildings.push({
        x,
        z: z + i * bayH + 3,
        w,
        d: bayH - 6,
        floors,
        height: floors * GRID.storey + 1.4,
        podium: 0,
        shaft: null,
        wall: rand.pick(PAINT.facades),
        shade: 1,
        lit: rand.between(0.4, 0.72),
        neon: rand() < 0.85 ? rand.pick(PAINT.neon) : null,
        neonFace: 3,
        seed: rand.int(1, 99999),
        crown: 'ac',
      });
    }
  }

  /**
   * Cut a block into lots: normally two by two with a service lane between them, occasionally one
   * squat tower. Each lot is inset a few metres more than the pavement, so every frontage keeps a
   * strip of its own for the shopfront band and the neon that hangs over it.
   */
  lots(block, rand) {
    const oneTower = block.kind === 'tower' && rand() < 0.42;
    const cols = oneTower ? 1 : 2;
    const rows = oneTower ? 1 : 2;
    const lane = oneTower ? 0 : 6;
    const innerW = block.w - WALK * 2;
    const innerH = block.h - WALK * 2;
    const cellW = (innerW - lane * (cols - 1)) / cols;
    const cellH = (innerH - lane * (rows - 1)) / rows;

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const trim = rand.between(4, 7.2);
        const w = cellW - trim * 2;
        const d = cellH - trim * 2;
        if (w < 12 || d < 12) continue;

        const floors = oneTower ? rand.int(22, 44) : block.kind === 'tower' ? rand.int(10, 28) : rand.int(2, 7);
        const podiumFloors = Math.max(2, Math.round(floors * rand.between(0.3, 0.48)));
        const stepped = floors > podiumFloors + 3 && rand() < 0.72;

        this.buildings.push({
          x: block.x + WALK + c * (cellW + lane) + trim,
          z: block.z + WALK + r * (cellH + lane) + trim,
          w,
          d,
          floors,
          height: floors * GRID.storey + 1.4,
          podium: stepped ? podiumFloors * GRID.storey : 0,
          shaft: stepped ? { w: w * rand.between(0.5, 0.8), d: d * rand.between(0.52, 0.82) } : null,
          wall: rand.pick(block.kind === 'tower' ? PAINT.curtain : PAINT.facades),
          shade: rand.between(0.86, 1.12),
          lit: rand.between(0.28, 0.7),
          neon: rand() < (block.kind === 'tower' ? 0.72 : 0.9) ? rand.pick(PAINT.neon) : null,
          neonFace: rand.int(0, 3),
          seed: rand.int(1, 99999),
          crown: floors > 8 ? rand.pick(['antenna', 'box', 'none', 'box']) : rand.pick(['none', 'box', 'ac', 'none']),
        });
      }
    }
  }

  /**
   * Put the three shops on their forecourts. Each is a real building record — drawn, blocking, and
   * standing exactly where its marker is — plus the affordance the HUD reads when the player is
   * close enough to buy.
   */
  placeShops() {
    for (const site of SHOPS) {
      const block = this.blocks.find((b) => b.col === site.block[0] && b.row === site.block[1]);
      if (!block) continue;
      const zc = block.z + block.h * 0.5;
      const w = 11;
      const d = 26;
      const x = block.x + WALK + w / 2;
      const shop = {
        ...site,
        x,
        z: zc,
        w,
        d,
        at: { x: block.x + 7, z: zc },
        door: { x: block.x + WALK + 0.4, z: zc },
        radius: 3.6,
        floors: 2,
      };
      this.shops.push(shop);
      this.buildings.push({
        x: x - w / 2,
        z: zc - d / 2,
        w,
        d,
        floors: 2,
        height: 2 * GRID.storey + 2.2,
        podium: 0,
        shaft: null,
        wall: '#3a3040',
        shade: 1,
        lit: 0.8,
        neon: null,
        neonFace: 3,
        seed: 4242,
        crown: 'box',
        shop: shop.id,
      });
    }
  }

  /** The first building whose footprint, grown by `pad`, holds the point — or null. */
  buildingAt(x, z, pad = 0) {
    const list = this.buildings;
    for (let i = 0; i < list.length; i += 1) {
      const b = list[i];
      if (x > b.x - pad && x < b.x + b.w + pad && z > b.z - pad && z < b.z + b.d + pad) return b;
    }
    return null;
  }

  /** True outside the drivable shore: past the waterline, or south of the bay. */
  inWater(x, z) {
    return x < SHORE.water || z > SHORE.bay;
  }

  /** May a body stand here? Not in the sea, not inside a wall, not off the edge of the map. */
  isOpen(x, z, pad = 0.4) {
    if (this.inWater(x, z)) return false;
    if (x > CITY.last - 4 || z > CITY.last - 4) return false;
    return this.buildingAt(x, z, pad) === null;
  }

  /** True within `pad` of an avenue centreline, on either axis. */
  onAvenue(x, z, pad = 0) {
    for (let i = 0; i < AVENUES.length; i += 1) {
      if (Math.abs(x - AVENUES[i]) < KERB + pad) return true;
      if (Math.abs(z - AVENUES[i]) < KERB + pad) return true;
    }
    return false;
  }

  /** The avenue line nearest one coordinate. */
  nearestAvenue(v) {
    let best = AVENUES[0];
    for (const line of AVENUES) if (Math.abs(line - v) < Math.abs(best - v)) best = line;
    return best;
  }

  /** The nearest point on the street grid to a world point: where a road vehicle can legally sit. */
  snapToRoad(x, z) {
    const ax = this.nearestAvenue(x);
    const az = this.nearestAvenue(z);
    if (Math.abs(x - ax) < Math.abs(z - az)) return { x: ax, z };
    return { x, z: az };
  }

  /** The walking ring of a block: past the kerb, before the frontage. */
  onPavement(x, z) {
    for (const line of AVENUES) {
      const dz = Math.abs(z - line);
      const dx = Math.abs(x - line);
      if (dz > KERB && dz < KERB + WALK && x > SHORE.promenade && x < CITY.last) return true;
      if (dx > KERB && dx < KERB + WALK && z > CITY.first && z < SHORE.quay) return true;
    }
    return false;
  }

  /** The shop whose counter the point is standing at, or null. */
  shopNear(x, z) {
    for (const shop of this.shops) if (Math.hypot(shop.at.x - x, shop.at.z - z) < shop.radius + 1.6) return shop;
    return null;
  }

  /** The side-work site the point is standing at, or null. */
  siteNear(x, z) {
    for (const site of this.sites) if (Math.hypot(site.at.x - x, site.at.z - z) < site.radius) return site;
    return null;
  }

  /** The nearest untaken tape within `reach`, or null. */
  tapeNear(x, z, reach = 4.5) {
    let best = null;
    let bestD = reach;
    for (const tape of this.tapes) {
      if (tape.taken) continue;
      const d = Math.hypot(tape.x - x, tape.z - z);
      if (d < bestD) {
        best = tape;
        bestD = d;
      }
    }
    return best;
  }
}
