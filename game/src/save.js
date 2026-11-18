// save.js — the run, remembered between visits.
//
// One localStorage key holds the whole thing: which mission is up, how much money and respect the
// player has, the clock, the tapes they have collected, and where they were standing. Nothing about
// the city is saved, because the city is generated from the seed — so a save is a few hundred bytes
// and a load is fast.
//
// Every read is defensive: localStorage can be absent (a headless render, a private window), it can
// hold a value written by an older build, and it can be full. None of those is worth a thrown error
// in the middle of a load, so recall() returns null and the game starts fresh.

const KEY = 'vice-meridian-iii/save/v1';

/** Write a story record down. Failures are silent: a save is a convenience, not a promise. */
export function remember(story, extra = {}) {
  try {
    const payload = {
      v: 1,
      at: Date.now(),
      index: story.index,
      done: story.done,
      cash: story.cash,
      respect: story.respect,
      kills: story.kills,
      spent: story.spent,
      passed: story.passed,
      day: story.day,
      hour: story.hour,
      tapes: extra.tapes ?? [],
      where: extra.where ?? null,
      car: extra.car ?? null,
    };
    window.localStorage.setItem(KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/** Read a save back into `story`, and answer whether there was one. */
export function recall(story, limit = 10) {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1) return null;
    if (typeof data.index !== 'number' || data.index < 0 || data.index > limit) return null;
    story.index = data.index;
    story.done = typeof data.done === 'number' ? data.done : data.index;
    story.cash = typeof data.cash === 'number' ? data.cash : story.cash;
    story.respect = typeof data.respect === 'number' ? data.respect : 0;
    story.kills = typeof data.kills === 'number' ? data.kills : 0;
    story.spent = typeof data.spent === 'number' ? data.spent : 0;
    story.passed = Array.isArray(data.passed) ? data.passed.filter((id) => typeof id === 'string') : [];
    story.day = typeof data.day === 'number' && data.day > 0 ? Math.floor(data.day) : 1;
    story.hour = typeof data.hour === 'number' ? ((data.hour % 24) + 24) % 24 : story.hour;
    return data;
  } catch {
    return null;
  }
}

/** Forget the save: the "start again" button, and what a corrupt record leads to. */
export function forget() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to do: a storage that cannot be written cannot be cleared either.
  }
}
