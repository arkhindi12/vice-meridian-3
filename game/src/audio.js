// audio.js — the sounds with no music in them: guns, engines, tyres, sirens, explosions, footfalls.
//
// All of it is synthesised on a WebAudio graph the first time the player touches a key, because a
// game that has to download a gunshot is not a game that loads offline. Three voices do most of the
// work: a filtered noise burst (gunshots, tyres, impacts, explosion tails), a tone with an envelope
// (sirens, the engine's body) and a short chirp (the cash register, the radio's click).
//
// The engine is the one continuous voice: two oscillators whose frequency follows the car's speed
// and whose gain follows the throttle, plus a noise layer that rises with speed. It is started once
// and then only retuned, which is why a car can be driven for an hour without allocating anything.
//
// Every entry point is a no-op when there is no AudioContext, so a headless browser render runs the
// whole game and throws nothing.

export function makeAudio() {
  let ctx = null;
  let master = null;
  let engine = null;
  let siren = null;
  let muted = false;
  let started = false;

  function build() {
    if (ctx) return ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    return ctx;
  }

  /** A band of noise, shaped by an envelope: the workhorse for anything that hits or hisses. */
  function noise({ dur = 0.2, gain = 0.3, type = 'highpass', freq = 900, q = 0.8, sweepTo = null } = {}) {
    if (!ctx) return;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, ctx.currentTime);
    if (sweepTo) filt.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), ctx.currentTime + dur);
    filt.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(filt);
    filt.connect(env);
    env.connect(master);
    src.start();
    src.stop(ctx.currentTime + dur + 0.02);
  }

  /** A tone with an attack and a decay, optionally gliding between two pitches. */
  function tone({ freq = 440, to = null, dur = 0.3, gain = 0.16, type = 'sine', delay = 0 } = {}) {
    if (!ctx) return;
    const at = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(env);
    env.connect(master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  /** Start the engine and the siren loops, once, when the player first asks for sound. */
  function start() {
    if (started || !build()) return;
    started = true;
    if (ctx.state === 'suspended') ctx.resume();

    // The engine: two detuned oscillators through a lowpass, quiet until a car is taken.
    const eg = ctx.createGain();
    eg.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const a = ctx.createOscillator();
    a.type = 'sawtooth';
    a.frequency.value = 60;
    const b = ctx.createOscillator();
    b.type = 'square';
    b.frequency.value = 90;
    const bg = ctx.createGain();
    bg.gain.value = 0.35;
    a.connect(lp);
    b.connect(bg);
    bg.connect(lp);
    lp.connect(eg);
    eg.connect(master);
    a.start();
    b.start();
    engine = { gain: eg, filter: lp, a, b };

    // The siren: one oscillator, its pitch swung by frame() rather than by an LFO, so a still frame
    // and a moving one sound the same and the HUD can flash in step with it.
    const sg = ctx.createGain();
    sg.gain.value = 0;
    const so = ctx.createOscillator();
    so.type = 'triangle';
    so.frequency.value = 700;
    so.connect(sg);
    sg.connect(master);
    so.start();
    siren = { gain: sg, osc: so, phase: 0 };
  }

  return {
    resume() {
      start();
    },
    toggle() {
      muted = !muted;
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.55, ctx.currentTime, 0.05);
      return muted;
    },
    get muted() {
      return muted;
    },
    gunshot(near = 1) {
      if (!ctx) return;
      noise({ dur: 0.16, gain: 0.5 * near, type: 'highpass', freq: 1400, sweepTo: 300 });
      tone({ freq: 160, to: 55, dur: 0.13, gain: 0.3 * near, type: 'square' });
    },
    crunch() {
      if (!ctx) return;
      noise({ dur: 0.3, gain: 0.42, type: 'bandpass', freq: 320, q: 1.4 });
      tone({ freq: 90, to: 40, dur: 0.25, gain: 0.26, type: 'sawtooth' });
    },
    boom() {
      if (!ctx) return;
      // The body of the blast, the crack over it, and the long rumble under both.
      noise({ dur: 1.1, gain: 0.85, type: 'lowpass', freq: 900, sweepTo: 60 });
      noise({ dur: 0.22, gain: 0.6, type: 'highpass', freq: 2400 });
      tone({ freq: 74, to: 24, dur: 1.3, gain: 0.5, type: 'sawtooth' });
      tone({ freq: 190, to: 40, dur: 0.5, gain: 0.3, type: 'square', delay: 0.04 });
    },
    cash() {
      if (!ctx) return;
      tone({ freq: 1180, dur: 0.09, gain: 0.16, type: 'square' });
      tone({ freq: 1560, dur: 0.14, gain: 0.14, type: 'square', delay: 0.07 });
      noise({ dur: 0.1, gain: 0.1, type: 'highpass', freq: 3200 });
    },
    step(run = 0.4) {
      if (!ctx) return;
      noise({ dur: 0.08, gain: 0.06 + run * 0.05, type: 'bandpass', freq: 420, q: 1.1 });
    },
    screech(amount = 0.5) {
      if (!ctx) return;
      noise({ dur: 0.34, gain: 0.16 * amount, type: 'bandpass', freq: 2100, q: 3.2, sweepTo: 1500 });
    },
    airtime(pay) {
      if (!ctx) return;
      tone({ freq: 440, to: 880, dur: 0.3, gain: 0.12, type: 'triangle' });
      if (pay) tone({ freq: 880, to: 1320, dur: 0.35, gain: 0.1, type: 'triangle', delay: 0.16 });
    },
    /**
     * One frame of continuous sound: the engine follows the speed and the throttle, the siren
     * follows the wanted level and the distance to the nearest cruiser.
     */
    frame({ speed = 0, throttle = 0, driving = false, stars = 0, nearestCop = 999, fire = 0 }) {
      if (!ctx || !engine || !siren) return;
      const t = ctx.currentTime;
      const k = Math.min(1, Math.abs(speed) / 41);
      engine.a.frequency.setTargetAtTime(52 + k * 120 + throttle * 22, t, 0.08);
      engine.b.frequency.setTargetAtTime(78 + k * 175 + throttle * 30, t, 0.08);
      engine.filter.frequency.setTargetAtTime(700 + k * 2100, t, 0.1);
      engine.gain.gain.setTargetAtTime(driving ? 0.05 + k * 0.09 : 0, t, 0.14);

      const sirenOn = stars > 0 && nearestCop < 140;
      const reach = sirenOn ? Math.max(0.12, 1 - nearestCop / 140) * Math.min(1, stars / 3) : 0;
      siren.gain.gain.setTargetAtTime(reach * 0.075, t, 0.2);
      // A slow two-tone wail: the pitch is a function of the clock, so it is in step with the bars.
      siren.phase = (siren.phase + 0.02) % 1;
      siren.osc.frequency.setTargetAtTime(660 + Math.sin(siren.phase * Math.PI * 2) * 190, t, 0.06);
      void fire;
    },
    /** Fire crackle, called at most a few times a second while something is burning. */
    crackle(near = 1) {
      if (!ctx) return;
      noise({ dur: 0.09 + Math.random() * 0.1, gain: 0.06 * near, type: 'bandpass', freq: 1800, q: 2 });
    },
  };
}
