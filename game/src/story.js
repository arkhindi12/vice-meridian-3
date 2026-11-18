// story.js — the ten-mission chain, the people who talk, and the numbers that climb.
//
// The arc is THE LONG SHADOW: a courier who saw the wrong ledger, a fixer who wants it, and a
// department that would rather the file never surfaced. Ten missions, each a place in the world, a
// radius, a line for the HUD and a cash reward, in the order the story tells them.
//
// A mission is passed on one of six beats:
//   reach   — stand in the marker on foot
//   deliver — arrive in a car
//   clear   — drop the crew working the marker
//   escape  — reach the marker with no stars lit
//   finish  — reach the marker, any way at all
//   buy     — stand at a shop's marker and buy what it sells
//
// The clock lives here too, but it is only a pair of numbers: day and decimal hour, advanced by
// tickClock and read by daylight.js, which decides what colour the world is at that hour. A mission
// run on a saved file starts where that file's clock stopped.
//
// The cast speak in their own voices, and only in a subtitle. Nobody here is a narrator.

export const ARC = 'THE LONG SHADOW';

/** The four people who talk. `tag` is the line's attribution, always in caps. */
export const CAST = {
  vance: { tag: 'MARLOWE VANCE', role: 'fixer' },
  juno: { tag: 'JUNO AKERS', role: 'wheelman' },
  rusk: { tag: 'DET. RUSK', role: 'VMPD' },
  sable: { tag: 'SABLE', role: 'the Neon Room' },
};

/**
 * The ten. `at` is a corner rather than a raw coordinate: every marker sits on a junction or a
 * forecourt where a car can reach it, so a deliver mission is drivable and a clear mission has room
 * for its crew to stand.
 */
export const MISSIONS = [
  {
    id: 'shadow',
    title: 'The Long Shadow',
    beat: 'reach',
    at: { x: 118, z: 1500 },
    radius: 9,
    reward: 400,
    line: 'Meet Marlowe under the palms on the Strand — he has work and no patience',
    who: 'vance',
    say: 'Two minutes of scanner window, and then the whole department knows your face. Move.',
    next: 'A car is waiting on the boulevard. Take it before the light goes.',
  },
  {
    id: 'signal',
    title: 'Bad Signal',
    beat: 'deliver',
    at: { x: 1200, z: 300 },
    radius: 13,
    reward: 650,
    line: 'Drive the grey coupe to the Neon Heights lock-up without losing the paint',
    who: 'juno',
    say: 'That coupe is worth more than your whole week. Put it in the lock-up, not in a wall.',
    next: 'Juno has the door open. She does not hold it long.',
    car: { x: 268, z: 1500, kind: 'coupe', paint: '#c9c2b6' },
  },
  {
    id: 'salt',
    title: 'Salt and Glass',
    beat: 'buy',
    at: { x: 30, z: 750 },
    radius: 4.2,
    shop: 'gun',
    reward: 520,
    line: 'Restock at Ironside Arms on the Strip before the meet at the marina',
    who: 'vance',
    say: 'Buy the ammunition. This is not the evening to be counting rounds.',
    next: 'Loaded. Now the marina, and try not to be followed.',
  },
  {
    id: 'courier',
    title: 'The Courier',
    beat: 'clear',
    at: { x: 1200, z: 1800 },
    radius: 34,
    need: 3,
    reward: 900,
    line: 'Clear the three men holding the courier at the Coral Strand lot',
    who: 'juno',
    say: 'Three of them, one of you, and the courier is the one who has to walk out.',
    next: 'The courier talks. What he says puts a name on the ledger.',
  },
  {
    id: 'ladder',
    title: 'Neon Ladder',
    beat: 'reach',
    at: { x: 606, z: 906 },
    radius: 11,
    reward: 1200,
    line: 'Climb to the Neon Heights rooftop bar and put the ledger in Sable’s hand',
    who: 'sable',
    say: 'You brought it up ten floors for me. That is either loyalty or a very good price.',
    next: 'Sable opens the book. The name in it is a police captain.',
  },
  {
    id: 'tide',
    title: 'What the Tide Left',
    beat: 'escape',
    at: { x: 306, z: 2094 },
    radius: 12,
    reward: 1500,
    line: 'Lose the cruiser tail, then reach the jetty at the south end of the Strand',
    who: 'rusk',
    say: 'You are not the first courier to run this beach. You will not be the last to stop.',
    next: 'The jetty is clear for ninety seconds. Do not waste them.',
  },
  {
    id: 'houselights',
    title: 'House Lights',
    beat: 'deliver',
    at: { x: 1800, z: 1200 },
    radius: 14,
    reward: 1800,
    line: 'Run the van of club stock to the docks before the shift change',
    who: 'juno',
    say: 'The van is heavy and the road is wet. That is the whole plan, so drive it well.',
    next: 'Stock delivered. The docks are awake now, and they are looking for you.',
    car: { x: 1506, z: 268, kind: 'van', paint: '#177d95' },
  },
  {
    id: 'quiethour',
    title: 'The Quiet Hour',
    beat: 'clear',
    at: { x: 2100, z: 2100 },
    radius: 34,
    need: 4,
    reward: 2100,
    line: 'Take the four men off the marina forecourt before the boat leaves',
    who: 'vance',
    say: 'Four of them, and the boat leaves at the hour. I would start with the one on the crane.',
    next: 'The forecourt is quiet. The boat is not going anywhere now.',
  },
  {
    id: 'kingsmen',
    title: "All the King's Men",
    beat: 'escape',
    at: { x: 906, z: 306 },
    radius: 13,
    reward: 2600,
    line: 'Shake the whole department, then get to the Strip club with the ledger',
    who: 'rusk',
    say: 'Every unit on this island is answering the same call tonight. Yours.',
    next: 'The club door is open. Somebody inside is very interested in what you are carrying.',
  },
  {
    id: 'lasttide',
    title: 'Last Tide',
    beat: 'finish',
    at: { x: 2400, z: 2400 },
    radius: 14,
    reward: 5000,
    line: 'Reach the marina head and put the ledger on the boat — then it is over',
    who: 'sable',
    say: 'Put it on the boat and the city forgets your name by morning. That is the price.',
    next: '',
  },
];

/** A fresh run: nothing done, a little walking-around money, the clock at eight minutes to seven. */
export function newStory() {
  return {
    index: 0,
    done: 0,
    cash: 480,
    respect: 0,
    kills: 0,
    shots: 0,
    passed: [],
    toast: '',
    toastT: 0,
    sub: null, // { tag, line, t, life }
    day: 1,
    hour: 18.87, // 18:52
    spent: 0,
    minutesPerSecond: 0.6, // one game minute every 1.67 real seconds
  };
}

/** The mission in front of the player, or null once the chain is finished. */
export function currentMission(story) {
  return MISSIONS[story.index] ?? null;
}

/** Put a line on the HUD for a few seconds. */
export function announce(story, text, seconds = 3.4) {
  story.toast = text;
  story.toastT = seconds;
}

/**
 * A character speaks. The subtitle box carries the speaker's tag and the line; three lines is all
 * the box ever holds, because a fourth would be a paragraph and this is a game.
 */
export function speak(story, who, line, seconds = 5.6) {
  const person = CAST[who];
  if (!person || !line) return;
  story.sub = { tag: person.tag, line, t: 0, life: seconds };
}

/** Step the subtitle's own clock. Called from the sim, so a staged frame can hold one open. */
export function tickSpeech(story, dt) {
  if (!story.sub) return;
  story.sub.t += dt;
  if (story.sub.t >= story.sub.life) story.sub = null;
}

/**
 * Test the current mission against the world and bank it if it passed. `ctx` carries how many of
 * the crew are down inside the marker, the wanted level and what was last bought. Returns the
 * mission just passed, or null.
 */
export function testMission(story, dt, player, ctx) {
  story.toastT = Math.max(0, story.toastT - dt);
  const m = currentMission(story);
  if (!m) return null;
  const d = Math.hypot(m.at.x - player.x, m.at.z - player.z);

  let passed = false;
  switch (m.beat) {
    case 'reach':
      passed = d < m.radius && !player.driving;
      break;
    case 'deliver':
      passed = d < m.radius && !!player.driving;
      break;
    case 'clear':
      passed = (ctx.crewDown ?? 0) >= m.need;
      break;
    case 'escape':
      passed = d < m.radius && (ctx.stars ?? 0) === 0;
      break;
    case 'finish':
      passed = d < m.radius;
      break;
    case 'buy':
      passed = (ctx.bought ?? '') === m.shop && d < m.radius + 5;
      break;
    default:
      passed = false;
  }
  if (!passed) return null;

  story.cash += m.reward;
  story.respect += 60 + m.reward * 0.05;
  story.bought = '';
  story.done += 1;
  story.passed.push(m.id);
  story.index += 1;
  const next = currentMission(story);
  if (next) {
    announce(story, `MISSION PASSED  +$${m.reward}  ·  NEXT: ${next.title.toUpperCase()}`, 4.6);
    speak(story, next.who, next.say, 5.8);
  } else {
    announce(story, `THE LONG SHADOW IS CLOSED  +$${m.reward}`, 6);
    speak(story, 'sable', 'The boat is gone and the file is ash. Go and spend it before somebody notices.', 6);
  }
  return m;
}

/**
 * The short line under the objective: what the player has to do right now, in the HUD's voice. This
 * is the only place a mission's live condition is spelled out.
 */
export function liveCondition(m, player, ctx) {
  if (!m) return '';
  const d = Math.round(Math.hypot(m.at.x - player.x, m.at.z - player.z));
  switch (m.beat) {
    case 'reach':
      return d < m.radius ? 'STEP INTO THE MARKER' : 'GO TO THE MARKER';
    case 'deliver':
      return player.driving ? 'DELIVER THE CAR' : 'TAKE A CAR FIRST';
    case 'clear':
      return `${ctx.crewDown ?? 0} / ${m.need} DOWN`;
    case 'escape':
      return (ctx.stars ?? 0) > 0 ? `${ctx.stars} STARS · SHAKE THEM` : 'CLEAN · GO NOW';
    case 'finish':
      return 'THE BOAT';
    case 'buy':
      return d < m.radius + 5 ? 'PRESS E AT THE COUNTER' : 'GET TO THE SHOP';
    default:
      return `${d} M`;
  }
}

// ---------------------------------------------------------------- the clock and the rank

/**
 * Advance the clock. `story.minutesPerSecond` is the rate: about one game minute every 1.7 real
 * seconds, so a fifteen-minute session covers an evening and the cycle is visible while playing,
 * not only between screenshots.
 */
export function tickClock(story, dt, moving) {
  const rate = story.minutesPerSecond * (moving ? 1.45 : 1);
  story.hour += (dt * rate) / 60;
  while (story.hour >= 24) {
    story.hour -= 24;
    story.day += 1;
  }
}

/** RESPECT climbs on its own clock: a takedown, a stunt, a fare, a mission. */
export function addRespect(story, amount, reason = '') {
  story.respect = Math.max(0, story.respect + amount);
  if (reason) announce(story, `RESPECT +${Math.round(amount)}  ·  ${reason}`, 2.2);
}

/** The rank a player's RESPECT buys, for the caption under the number. */
export function rankOf(respect) {
  if (respect >= 2000) return 'KINGPIN';
  if (respect >= 1200) return 'RUNNER';
  if (respect >= 700) return 'KNOWN';
  if (respect >= 350) return 'CONNECTED';
  if (respect >= 120) return 'STREET';
  return 'NOBODY';
}
