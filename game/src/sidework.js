// sidework.js — what to do when nobody is paying for a mission.
//
// Four things live outside the story, and all four are the same shape: a marker in the world, a
// prompt when the player is close, a state machine while it runs, and a payout at the end.
//
//   TAXI     a rank on the Strand. Stop inside it on foot or in a car to take a fare; the fare wants
//            a destination somewhere across town, and the meter pays by the distance actually
//            driven, so a straight line is worth more than a lap of the block.
//   TAPE     twelve cassettes on corners, forecourts, the beach and the pier, counted "TAPES 3/12".
//            Walking over one picks it up: they are the only collectible and they pay a little.
//   RESPRAY  a garage on the Strip. Pay, and the stars come off and the car is repainted: the way out
//            of a chase that does not involve dying.
//   STUNT    a ramp on the Strip. Any second off the ground over the ramp pays; a long one pays a
//            lot, and the number floats up over the car.
//
// A district banner is the last piece: entering a district the player was not in slides its name in
// at the left of the screen and fades it out. The banner is HUD state, but the detection is here,
// because "which district is this" is a question about the world.

import { WORK, DAMAGE } from './units.js';
import { districtAt } from './cityPlan.js';
import { announce, speak, addRespect } from './story.js';
import { addStars } from './officers.js';

/** A fresh side-work record: nothing taken, nothing running, the banner blank. */
export function newSideWork(plan) {
  return {
    taxi: null, // { fare, at, from, distance, paid, t }
    taxiCount: 0,
    taxiCash: 0,
    tapes: 0,
    tapesTotal: plan.tapes.length,
    resprays: 0,
    stunts: 0,
    stuntCash: 0,
    air: 0,
    bestAir: 0,
    district: null,
    banner: null, // { name, accent, t, life }
    floaters: [],
    lastPrompt: null,
  };
}

/** Show a district's name in the banner, if it is not the one already on screen. */
export function enterDistrict(work, name, accent) {
  if (work.district === name) return;
  work.district = name;
  work.banner = { name, accent, t: 0, life: 3.6 };
}

/** Step the banner's clock and the floating payout numbers. */
export function tickBanner(work, dt) {
  if (work.banner) {
    work.banner.t += dt;
    if (work.banner.t >= work.banner.life) work.banner = null;
  }
  for (let i = work.floaters.length - 1; i >= 0; i -= 1) {
    const f = work.floaters[i];
    f.t += dt;
    f.y += dt * 1.6;
    if (f.t > f.life) work.floaters.splice(i, 1);
  }
}

/** A number that floats up over a point in the world: a fare, a tape, airtime. */
export function floatCash(work, x, y, z, text, colour = '#8dffcf') {
  work.floaters.push({ x, y, z, text, colour, t: 0, life: 1.9 });
}

/** Where the taxi rank is, so the fare and the rank agree. */
const RANK = { x: 36, z: 1826 };

const FARE_SPOTS = [
  { x: 906, z: 906, name: 'NEON HEIGHTS' },
  { x: 1806, z: 606, name: 'DOCKSIDE' },
  { x: 1206, z: 1806, name: 'CORAL STRAND' },
  { x: 306, z: 1206, name: 'THE SUNGLASS STRIP' },
  { x: 2106, z: 1206, name: 'THE DOCKS' },
];

/**
 * The prompt for whatever the player is standing at, or null. This is what the HUD draws as "E —
 * TAKE THE FARE" and it is the only place the interaction radius is decided.
 */
export function promptAt(sim) {
  const p = sim.player;
  const work = sim.work;
  const plan = sim.plan;

  // A running fare outranks everything: the job is to drive.
  if (work.taxi) {
    const d = Math.hypot(work.taxi.at.x - p.x, work.taxi.at.z - p.z);
    if (p.driving && d < 12) {
      return { kind: 'taxi-drop', title: 'DROP THE FARE', line: `STOP IN THE MARKER · ${Math.round(d)}M`, accent: '#ffd23c', price: 0 };
    }
    if (!p.driving) return { kind: 'taxi-wait', title: 'TAXI FARE WAITING', line: 'GET BACK IN A CAR', accent: '#ffd23c', price: 0 };
    return { kind: 'taxi-run', title: 'FARE ABOARD', line: `${Math.round(d)}M TO ${work.taxi.name}`, accent: '#ffd23c', price: 0 };
  }

  // The rank.
  const rank = plan.sites.find((s) => s.kind === 'taxi');
  if (rank && Math.hypot(rank.at.x - p.x, rank.at.z - p.z) < rank.radius) {
    return { kind: 'taxi', title: 'TAXI RANK', line: p.driving ? 'E · TAKE THE FARE' : 'E · CALL A FARE', accent: '#ffd23c', price: 0, site: rank };
  }

  // The respray: only worth offering with a car and something to clear.
  const garage = plan.sites.find((s) => s.kind === 'respray');
  if (garage && Math.hypot(garage.at.x - p.x, garage.at.z - p.z) < garage.radius) {
    return {
      kind: 'respray',
      title: 'RESPRAY · PANEL & PAINT',
      line: p.driving ? `E · PAY $${WORK.respray} · CLEAR ${sim.police.stars} STARS` : 'BRING A CAR TO THE BAY',
      accent: '#22e6d0',
      price: WORK.respray,
      site: garage,
    };
  }

  // The ramp.
  const ramp = plan.sites.find((s) => s.kind === 'stunt');
  if (ramp && Math.hypot(ramp.at.x - p.x, ramp.at.z - p.z) < ramp.radius) {
    return { kind: 'stunt', title: 'STUNT RAMP', line: 'HIT IT FAST · PAID BY THE SECOND', accent: '#ff7a30', price: 0, site: ramp };
  }

  // A tape underfoot.
  const tape = plan.tapeNear(p.x, p.z, 5);
  if (tape) {
    return { kind: 'tape', title: 'TAPE', line: 'WALK OVER IT TO TAKE IT', accent: '#ff2f86', price: 0 };
  }

  // A shop's counter, which is the story's business as much as the player's.
  const shop = plan.shopNear(p.x, p.z);
  if (shop && !p.driving) {
    return { kind: 'shop', title: shop.name, line: `E · BUY ${shop.effect} · $${shop.price}`, accent: shop.accent, price: shop.price, shop };
  }
  return null;
}

/**
 * Do the thing the prompt offers. Called from the sim when E is pressed with a prompt on screen.
 * Returns true if something happened, so the caller knows the press was spent.
 */
export function usePrompt(sim, prompt) {
  const p = sim.player;
  const work = sim.work;
  if (!prompt) return false;

  switch (prompt.kind) {
    case 'taxi': {
      if (!p.driving) {
        announce(sim.story, 'GET A CAR FIRST · THE FARE WILL NOT RIDE ON THE HANDLEBARS');
        return true;
      }
      const spot = FARE_SPOTS[work.taxiCount % FARE_SPOTS.length];
      // The fare rides in the back of the player's car; the destination is a junction across town.
      work.taxi = { at: { x: spot.x, z: spot.z }, name: spot.name, from: { x: p.x, z: p.z }, distance: 0, t: 0 };
      speak(sim.story, 'juno', `Corner of ${spot.name.toLowerCase()}, and I am not in a hurry. Mostly.`, 4.4);
      announce(sim.story, `FARE ABOARD · ${spot.name} · $${WORK.taxiFare}+`, 3.4);
      sim.events.onCash?.();
      return true;
    }
    case 'taxi-drop': {
      const fare = work.taxi;
      if (!p.driving) return false;
      const pay = Math.round(WORK.taxiFare + Math.min(WORK.taxiFar, fare.distance * 0.9));
      sim.story.cash += pay;
      addRespect(sim.story, 18, 'FARE DELIVERED');
      work.taxiCount += 1;
      work.taxiCash += pay;
      floatCash(work, p.x, 2.4, p.z, `+$${pay}`, '#ffd23c');
      announce(sim.story, `FARE PAID  +$${pay}`, 3);
      sim.events.onCash?.();
      work.taxi = null;
      return true;
    }
    case 'respray': {
      const car = p.driving;
      if (!car) {
        announce(sim.story, 'THE BAY IS FOR CARS · BRING ONE IN');
        return true;
      }
      if (sim.story.cash < WORK.respray) {
        announce(sim.story, `NOT ENOUGH CASH · $${WORK.respray} FOR A RESPAY`);
        return true;
      }
      sim.story.cash -= WORK.respray;
      sim.story.spent += WORK.respray;
      car.paint = `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`;
      car.condition = DAMAGE.max;
      work.resprays += 1;
      const cleared = sim.police.stars;
      sim.police.stars = 0;
      sim.police.heat = 0;
      sim.police.units.forEach((u) => {
        u.gone = true;
      });
      sim.police.units = [];
      sim.police.air = null;
      sim.police.seen = false;
      sim.police.quiet = 0;
      addRespect(sim.story, 12, 'CLEAN PAINT');
      announce(sim.story, cleared > 0 ? `RESPRAYED · ${cleared} STARS CLEARED` : 'RESPRAYED · FULL REPAIR', 3.2);
      sim.events.onCash?.();
      // The car is rebuilt in its new colour by the cast on the next frame; the old mesh is dropped.
      sim.repaint = car;
      return true;
    }
    case 'shop': {
      const shop = prompt.shop;
      if (sim.story.cash < shop.price) {
        announce(sim.story, `NOT ENOUGH CASH · $${shop.price} AT ${shop.name}`);
        return true;
      }
      sim.story.cash -= shop.price;
      sim.story.spent += shop.price;
      if (shop.kind === 'gun') p.ammo = Math.min(240, p.ammo + 45);
      if (shop.kind === 'garage' && p.driving) p.driving.condition = DAMAGE.max;
      if (shop.kind === 'clothier') {
        p.hpMax = Math.max(p.hpMax, 120);
        p.hp = p.hpMax;
      }
      sim.story.bought = shop.id;
      announce(sim.story, `${shop.name} · ${shop.effect}`, 3.2);
      sim.events.onShop?.();
      speak(sim.story, 'sable', shop.kind === 'gun' ? 'No questions, no receipt. Enjoy the evening.' : 'Wear it well. Everybody is looking anyway.', 4);
      return true;
    }
    default:
      return false;
  }
}

/**
 * One step of everything outside the story. Tapes are taken by walking over them; airtime is
 * measured while the wheels are off the ground; the taxi meter runs while a fare is aboard; the
 * district banner follows the player's position.
 */
export function tickSideWork(sim, dt) {
  const p = sim.player;
  const work = sim.work;
  const plan = sim.plan;

  // The district banner. It reads off the player's own position, so a boundary crossed at 140 km/h
  // still lands the moment the car is over the line.
  const district = districtAt(p.x, p.z);
  enterDistrict(work, district.name, district.accent);
  tickBanner(work, dt);

  // Tapes: walking over one takes it, whether the player is on foot or in a car.
  const near = plan.tapeNear(p.x, p.z, 4.6);
  if (near) {
    near.taken = true;
    work.tapes += 1;
    sim.story.cash += WORK.tapeReward;
    addRespect(sim.story, 8);
    floatCash(work, near.x, 1.6, near.z, `TAPE ${work.tapes}/${work.tapesTotal}`, '#ff2f86');
    announce(sim.story, `TAPE ${work.tapes}/${work.tapesTotal}  ·  ${near.name}`, 2.8);
    sim.events.onCash?.();
    if (work.tapes === work.tapesTotal) {
      announce(sim.story, 'ALL TWELVE TAPES · THE STRAND SINGS', 5);
      addRespect(sim.story, 120, 'ALL TAPES');
    }
  }

  // The taxi meter.
  if (work.taxi) {
    work.taxi.t += dt;
    const car = p.driving;
    if (car) work.taxi.distance += Math.abs(car.speed) * dt;
    else {
      // Out of the car for too long and the fare walks.
      if (work.taxi.t > 40) {
        announce(sim.story, 'THE FARE GOT OUT AND WALKED', 3);
        work.taxi = null;
      }
    }
    const d = Math.hypot(work.taxi ? work.taxi.at.x - p.x : 0, work.taxi ? work.taxi.at.z - p.z : 0);
    if (work.taxi && car && d < 12) {
      // Auto-drop when the player stops in the marker: the fare does not wait to be told.
      if (Math.abs(car.speed) < 2.2) usePrompt(sim, { kind: 'taxi-drop' });
    }
  }

  // Airtime and the stunt ramp. `p.air` is set by the sim's own jump physics; the payout is what
  // happens when the wheels come back down.
  if (p.air > 0.2) {
    work.air += dt;
    p.airtime += dt;
  } else if (work.air > WORK.stuntMin) {
    const pay = Math.round(work.air * WORK.airtimeRate);
    work.stunts += 1;
    work.stuntCash += pay;
    work.bestAir = Math.max(work.bestAir, work.air);
    sim.story.cash += pay;
    addRespect(sim.story, 10 + Math.round(work.air * 12), 'AIRTIME');
    floatCash(work, p.x, 2.6, p.z, `${work.air.toFixed(2)}S  +$${pay}`, '#ff7a30');
    announce(sim.story, `STUNT LANDED · ${work.air.toFixed(2)}S AIR · +$${pay}`, 3.2);
    sim.events.onCash?.();
    sim.events.onAirtime?.(pay);
    work.air = 0;
  } else {
    work.air = 0;
  }

  // A jumper who lands badly loses the car: the ramp is not a conveyor belt.
  if (p.driving && (p.driving.condition ?? 100) < 20 && p.air > 0 && Math.random() < dt * 0.2) {
    p.driving.condition = Math.max(0, p.driving.condition - 6);
  }
}

/** The marker's world position for the current side job, so the GPS and the map can point at it. */
export function sideObjective(sim) {
  const work = sim.work;
  if (work.taxi) return { at: work.taxi.at, name: `FARE · ${work.taxi.name}`, accent: '#ffd23c', kind: 'taxi' };
  return null;
}

export { RANK, addStars };
