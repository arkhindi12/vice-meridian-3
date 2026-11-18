// radio.js — the three stations, the track clock, and the music they actually play.
//
// A station is a name, a frequency and a band of sound. The text half of the radio is a state
// machine: a station is chosen, a track title holds for forty to sixty seconds, and now and then a
// DJ talks over the intro. The HUD prints that state; nothing here draws.
//
// The sound half is WebAudio, built on the first gesture with no files and no network: each station
// is a small scheduling loop — a bass note, a chord pad and an arpeggio over a four-bar pattern, at
// its own tempo and in its own mode. WAVE 88.1 is a bright major-pentatonic drive, CORAL FM 101.9 a
// slow minor-seventh sunset, VICE 96.4 a low minor pulse for after hours. The station is audible
// only while the player is driving, which is what "always on while driving" means in practice.
//
// Every entry point is a no-op without an AudioContext, so a headless render never throws.

export const STATIONS = [
  {
    id: 'wave',
    name: 'WAVE 88.1',
    band: 'NEON DRIVE',
    colour: '#22e6d0',
    bpm: 112,
    root: 55, // A1
    scale: [0, 2, 4, 7, 9, 12, 14, 16],
    wave: 'sawtooth',
    tracks: ['MIDNIGHT COASTLINE', 'GLASS AVENUE', 'SUNBURN RADIO', 'CHROME AND SALT'],
    dj: [
      'Eighty-eight point one, and the sun is not down yet — keep the top up and the foot down.',
      'That was the new one. If you are driving fast enough it sounds like the city is playing it.',
      'Traffic on the Strip is a rumour. Traffic on the causeway is a fact. WAVE 88.1.',
    ],
  },
  {
    id: 'coral',
    name: 'CORAL FM 101.9',
    band: 'SUNSET SESSIONS',
    colour: '#ff7a30',
    bpm: 84,
    root: 49, // G#1
    scale: [0, 3, 5, 7, 10, 12, 15, 17],
    wave: 'triangle',
    tracks: ['SLOW WATER', 'THE LONG SHADOW', 'PALMS IN THE REAR VIEW', 'TWO MINUTES OF DUSK'],
    dj: [
      'The tide is coming in under the pier and nobody is in a hurry. Coral FM.',
      'For everybody still on the promenade: this one is for the walk home.',
      'Ten past the hour, and the water is the colour of the inside of a peach.',
    ],
  },
  {
    id: 'vice',
    name: 'VICE 96.4',
    band: 'AFTER HOURS',
    colour: '#8f5bff',
    bpm: 96,
    root: 41, // F1
    scale: [0, 1, 5, 7, 8, 12, 13, 17],
    wave: 'square',
    tracks: ['NO WITNESSES', 'LOADING BAY', 'BLUE LIGHT DISTRICT', 'THE QUIET HOUR'],
    dj: [
      'Ninety-six point four. It is late, and the only people listening are working.',
      'If you are hearing this from a car you should not be in, you are in the right place.',
      'After hours, after everybody. VICE 96.4.',
    ],
  },
];

/** A fresh radio: first station, first track, half a track already gone. */
export function newRadio() {
  return { index: 0, track: 0, elapsed: 26, hold: 44, dj: '', djT: 0, on: true };
}

/** The station playing right now. */
export function stationNow(radio) {
  return STATIONS[radio.index] ?? STATIONS[0];
}

/** The title the HUD prints under the frequency. */
export function trackTitle(radio) {
  const s = stationNow(radio);
  return s.tracks[radio.track % s.tracks.length];
}

/** How far through the track the station is, 0..1. */
export const trackProgress = (radio) => Math.max(0, Math.min(1, radio.elapsed / Math.max(1, radio.hold)));

/**
 * Step the radio's clock. Forty to sixty seconds a track, a DJ line every second or third change,
 * and the DJ's line fading after eight seconds.
 */
export function tickRadio(radio, dt) {
  radio.djT = Math.max(0, radio.djT - dt);
  if (!radio.on) return;
  radio.elapsed += dt;
  if (radio.elapsed < radio.hold) return;
  radio.elapsed = 0;
  radio.hold = 40 + ((radio.track * 37) % 21);
  radio.track += 1;
  const s = stationNow(radio);
  if (radio.track % 2 === 1) {
    radio.dj = s.dj[Math.floor(radio.track / 2) % s.dj.length];
    radio.djT = 8;
  }
}

/** Next station, as the player changes it. Also moves the track on so the change is heard. */
export function turnDial(radio, step = 1) {
  radio.index = (radio.index + step + STATIONS.length) % STATIONS.length;
  radio.track = 0;
  radio.elapsed = 0;
  radio.hold = 42;
  const s = stationNow(radio);
  radio.dj = `${s.name}, ${s.band.toLowerCase()}.`;
  radio.djT = 6;
  return s;
}

// ---------------------------------------------------------------- the sound

/**
 * The radio's audio: a four-bar loop per station, scheduled a bar ahead so the timing is the audio
 * clock's rather than the frame's. Each station voices the same three roles differently — a bass on
 * the root, a pad on the chord, an arpeggio on the scale — which is enough to tell them apart in a
 * moving car without shipping a single sample.
 */
export function makeRadioSound() {
  let ctx = null;
  let master = null;
  let muted = false;
  let timer = 0;
  let station = STATIONS[0];
  let playing = false;

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
    master.gain.value = 0;
    master.connect(ctx.destination);
    return ctx;
  }

  const hz = (semi) => 440 * 2 ** ((semi - 57) / 12);

  /** One note: an oscillator through a short envelope into the radio bus. */
  function note(freq, at, dur, gain, type, filter = 0) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    if (filter > 0) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(filter, at);
      osc.connect(lp);
      lp.connect(env);
    } else {
      osc.connect(env);
    }
    env.connect(master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  /** A hat: a very short band-passed noise burst. */
  function hat(at, gain) {
    const len = Math.floor(ctx.sampleRate * 0.05);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 7200;
    bp.Q.value = 1.2;
    const env = ctx.createGain();
    env.gain.value = gain;
    src.connect(bp);
    bp.connect(env);
    env.connect(master);
    src.start(at);
  }

  /** Schedule four bars from `at`. Called on a lookahead so the loop never waits for a frame. */
  function schedule(at) {
    const s = station;
    const beat = 60 / s.bpm;
    const step = beat / 2;
    const bars = 4;
    for (let b = 0; b < bars; b += 1) {
      const t0 = at + b * beat * 4;
      const chord = [0, b % 2 === 0 ? 3 : 5, 7];
      note(hz(s.root + s.scale[0]), t0, beat * 1.6, 0.16, s.wave === 'square' ? 'square' : 'sawtooth', 320);
      note(hz(s.root + (b % 2 === 0 ? s.scale[0] : s.scale[3])), t0 + beat * 2, beat * 1.2, 0.13, 'triangle', 400);
      for (const semi of chord) note(hz(s.root + 24 + semi), t0, beat * 3.6, 0.028, 'triangle');
      for (let i = 0; i < 8; i += 1) {
        const deg = s.scale[(i + b) % s.scale.length];
        const oct = i % 8 > 4 ? 36 : 24;
        note(hz(s.root + oct + deg), t0 + i * step, step * 0.9, 0.05 + (i % 4 === 0 ? 0.02 : 0), s.wave, 2600);
        if (i % 2 === 1) hat(t0 + i * step, 0.012);
      }
    }
    return bars * 4 * beat;
  }

  /** Start or stop the sound without tearing down the context. */
  function setPlaying(on) {
    const c = build();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    if (on && !playing) {
      playing = true;
      const now = c.currentTime + 0.08;
      const span = schedule(now);
      const again = () => {
        if (!playing) return;
        const next = ctx.currentTime + 0.4;
        schedule(next);
        timer = window.setTimeout(again, Math.max(600, (span * 1000) / 4 - 300));
      };
      timer = window.setTimeout(again, Math.max(600, (span * 1000) / 4 - 300));
      master.gain.setTargetAtTime(muted ? 0 : 0.24, c.currentTime, 0.4);
    } else if (!on && playing) {
      playing = false;
      window.clearTimeout(timer);
      master.gain.setTargetAtTime(0, c.currentTime, 0.25);
    }
  }

  return {
    /** Called once per frame with whether the player is driving and which station is on. */
    frame(radio, driving) {
      station = stationNow(radio);
      const want = driving && radio.on && !muted;
      if (want !== playing) setPlaying(want);
      if (playing && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.22, ctx.currentTime, 0.3);
    },
    /** Cut the music for a beat, which is what a station change sounds like. */
    cut() {
      if (!ctx || !playing) return;
      master.gain.setTargetAtTime(0.02, ctx.currentTime, 0.05);
    },
    toggle() {
      muted = !muted;
      if (ctx) master.gain.setTargetAtTime(muted || !playing ? 0 : 0.22, ctx.currentTime, 0.1);
      return muted;
    },
    get muted() {
      return muted;
    },
  };
}
