// sfx.js — synthesised sound effects for Sticky Space Paws.
// Web Audio API only: no audio files, no network, no dependencies.
//
//   import { makeSfx } from './sfx.js';
//   const sfx = makeSfx(audioContext);
//   sfx.clatter();                       // every function takes { gain = 1, when = 0 }
//   sfx.out.gain.value = 0.7;            // master volume
//
// Signal path: sound -> per-call bus (gain) -> limiter -> sfx.out -> ctx.destination

export function makeSfx(ctx) {
  const out = ctx.createGain();
  out.gain.value = 1;
  out.connect(ctx.destination);

  // Safety limiter: catches the rare case where several sounds stack up.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.15;
  limiter.connect(out);

  const sfx = { out, buffers: {} };

  // ───────────────────────── helpers ─────────────────────────

  const R = (a, b) => a + Math.random() * (b - a);

  // Cached 2 s noise buffers ('white' | 'brown').
  function buf(kind) {
    if (sfx.buffers[kind]) return sfx.buffers[kind];
    const n = Math.floor(ctx.sampleRate * 2);
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else {
        d[i] = w;
      }
    }
    sfx.buffers[kind] = b;
    return b;
  }

  // Start of a sound: returns [startTime, bus]. Optional stereo pan (-1..1).
  function begin(opts, pan = 0) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const gain = Number.isFinite(o.gain) ? o.gain : 1;
    const when = Number.isFinite(o.when) ? Math.max(0, o.when) : 0;
    const t = ctx.currentTime + when + 0.02;
    const bus = ctx.createGain();
    bus.gain.value = gain;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      bus.connect(p);
      p.connect(limiter);
    } else {
      bus.connect(limiter);
    }
    return [t, bus];
  }

  function gainNode(dest, v) {
    const g = ctx.createGain();
    g.gain.value = v;
    if (dest) g.connect(dest);
    return g;
  }

  // Percussive envelope: fast attack, exponential decay, ends at exactly 0.
  function pluck(dest, t, dur, peak, a = 0.004) {
    const g = ctx.createGain();
    const p = g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + a);
    p.exponentialRampToValueAtTime(Math.max(peak * 0.01, 1e-5), t + a + dur);
    p.linearRampToValueAtTime(0, t + a + dur + 0.015);
    g.connect(dest);
    return g;
  }

  // Sustained envelope: attack, hold, release.
  function swell(dest, t, dur, peak, a = 0.03, r = 0.06) {
    a = Math.min(a, dur * 0.45);
    r = Math.min(r, dur * 0.45);
    const g = ctx.createGain();
    const p = g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + a);
    p.setValueAtTime(peak, t + dur - r);
    p.linearRampToValueAtTime(0, t + dur);
    g.connect(dest);
    return g;
  }

  function osc(dest, type, t, dur, f) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (dest) o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.06);
    return o;
  }

  function noise(dest, t, dur, kind = 'white') {
    const s = ctx.createBufferSource();
    s.buffer = buf(kind);
    s.loop = true;
    if (dest) s.connect(dest);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.06);
    return s;
  }

  function filt(dest, type, f, q = 1) {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    if (dest) b.connect(dest);
    return b;
  }

  // Exponential glide through [[dt, value], ...] points.
  function glide(param, t, pts) {
    param.setValueAtTime(Math.max(pts[0][1], 0.001), t + pts[0][0]);
    for (let i = 1; i < pts.length; i++) {
      param.exponentialRampToValueAtTime(Math.max(pts[i][1], 0.001), t + pts[i][0]);
    }
  }

  // Low-frequency oscillator added onto a param.
  function lfo(param, t, dur, rate, depth, type = 'sine') {
    const g = gainNode(null, depth);
    g.connect(param);
    return osc(g, type, t, dur, rate);
  }

  // Cartoon voice: buzzy source through two moving formant band-passes.
  //   p  = pitch points [[dt, hz], ...]
  //   f1 = [startHz, endHz], f2 = [startHz, endHz]
  //   rasp = growl rate in Hz (amplitude flutter), vib = vibrato rate in Hz
  function vox(dest, t, dur, o) {
    const { p, f1, f2, peak = 0.4, a = 0.03, r = 0.06, q = 6, type = 'sawtooth', vib = 0, rasp = 0 } = o;
    const env = swell(dest, t, dur, peak, a, r);
    const mk = gainNode(env, 2.5);
    const b1 = filt(mk, 'bandpass', f1[0], q);
    b1.frequency.setValueAtTime(f1[0], t);
    b1.frequency.linearRampToValueAtTime(f1[1], t + dur);
    const b2 = filt(gainNode(mk, 0.6), 'bandpass', f2[0], q * 1.3);
    b2.frequency.setValueAtTime(f2[0], t);
    b2.frequency.linearRampToValueAtTime(f2[1], t + dur);
    const body = filt(gainNode(mk, 0.25), 'lowpass', 350, 0.7);
    const src = osc(null, type, t, dur, p[0][1]);
    glide(src.frequency, t, p);
    src.connect(b1);
    src.connect(b2);
    src.connect(body);
    if (vib) lfo(src.frequency, t, dur, vib, p[0][1] * 0.04);
    if (rasp) lfo(mk.gain, t, dur, rasp, 1.3, 'sawtooth');
    return env;
  }

  // One metallic can hit (inharmonic partials + a noise tick + a glassy tink).
  function metalHit(dest, t, amp, k) {
    const ratios = [1, 2.27, 3.58, 5.34];
    for (let i = 0; i < ratios.length; i++) {
      const g = pluck(dest, t, 0.2 - i * 0.03, amp * 0.17);
      osc(g, i === 0 ? 'triangle' : 'sine', t, 0.25, 540 * k * ratios[i]);
    }
    noise(filt(pluck(dest, t, 0.04, amp * 0.3, 0.002), 'bandpass', 4200, 1), t, 0.06);
    osc(pluck(dest, t, 0.09, amp * 0.1, 0.002), 'sine', t, 0.12, 3100 * k);
  }

  // ───────────────────────── the drop ─────────────────────────

  // Metal can bounces and rolls on glass, then a glass smash and tinkle.
  sfx.clatter = (opts) => {
    const [t, bus] = begin(opts);
    const bounces = [0, 0.22, 0.38, 0.49, 0.57, 0.62, 0.66];
    bounces.forEach((dt, i) => {
      metalHit(bus, t + dt, 0.9 * Math.pow(0.78, i), R(0.85, 1.25));
    });
    // rolling wobble, speeding up
    const rollEnv = swell(bus, t + 0.3, 0.6, 0.14, 0.08, 0.15);
    const am = gainNode(rollEnv, 0.5);
    const roll = filt(am, 'bandpass', 1300, 3);
    noise(roll, t + 0.3, 0.6);
    const wob = lfo(am.gain, t + 0.3, 0.6, 9, 0.5);
    glide(wob.frequency, t + 0.3, [[0, 9], [0.6, 24]]);
    // glass smash
    const ts = t + 0.95;
    noise(filt(pluck(bus, ts, 0.28, 0.32, 0.002), 'highpass', 4500, 0.7), ts, 0.32);
    for (let i = 0; i < 10; i++) {
      const tt = ts + R(0, 0.55);
      const d = R(0.06, 0.2);
      osc(pluck(bus, tt, d, R(0.05, 0.12), 0.002), 'sine', tt, d + 0.03, R(2600, 7200));
    }
  };

  // ───────────────────────── the house ─────────────────────────

  let snore = null; // { bus, timer, next }

  function snoreCycle(bus, t) {
    // inhale: "hhhrrrOnk"
    vox(bus, t, 1.1, {
      p: [[0, 58], [0.8, 82], [1.1, 96]],
      f1: [380, 680], f2: [1050, 1500], peak: 0.3, a: 0.25, r: 0.12, rasp: 24,
    });
    const nEnv = swell(bus, t, 1.1, 0.14, 0.3, 0.1);
    const nAm = gainNode(nEnv, 0.5);
    const nf = filt(nAm, 'bandpass', 420, 2.5);
    glide(nf.frequency, t, [[0, 420], [1.1, 900]]);
    noise(nf, t, 1.1);
    lfo(nAm.gain, t, 1.1, 24, 0.5, 'square');
    // exhale: descending whistle + "shooo"
    const te = t + 1.3;
    const w = osc(swell(bus, te, 0.9, 0.1, 0.2, 0.3), 'sine', te, 0.9, 1500);
    glide(w.frequency, te, [[0, 1550], [0.9, 820]]);
    lfo(w.frequency, te, 0.9, 6.5, 35);
    const sf = filt(swell(bus, te, 0.9, 0.12, 0.15, 0.4), 'bandpass', 3800, 1.2);
    glide(sf.frequency, te, [[0, 3800], [0.9, 1500]]);
    noise(sf, te, 0.9);
  }

  // Looping cartoon snore. Idempotent: a second call while snoring does nothing.
  sfx.snoreStart = (opts) => {
    if (snore) return;
    const [t, bus] = begin(opts);
    const s = { bus, next: t, timer: 0 };
    const tick = () => {
      while (s.next < ctx.currentTime + 0.6) {
        const at = Math.max(s.next, ctx.currentTime + 0.02);
        snoreCycle(s.bus, at);
        s.next = at + 2.5 + R(-0.1, 0.15);
      }
    };
    tick();
    s.timer = setInterval(tick, 250);
    snore = s;
  };

  // Ends the snore with a snort and a sleepy "mm.. hm?". No-op if not snoring.
  sfx.snoreStop = (opts) => {
    if (!snore) return;
    const s = snore;
    snore = null;
    clearInterval(s.timer);
    const [t, bus] = begin(opts);
    s.bus.gain.cancelScheduledValues(t);
    s.bus.gain.setTargetAtTime(0, t, 0.03);
    // snort
    const sEnv = swell(bus, t + 0.05, 0.24, 0.45, 0.02, 0.06);
    const sAm = gainNode(sEnv, 0.5);
    noise(filt(sAm, 'bandpass', 750, 2), t + 0.05, 0.24);
    lfo(sAm.gain, t + 0.05, 0.24, 46, 0.5, 'square');
    vox(bus, t + 0.05, 0.22, { p: [[0, 85], [0.22, 150]], f1: [450, 700], f2: [1300, 1700], peak: 0.25, rasp: 46 });
    // "mm.."
    vox(bus, t + 0.42, 0.13, { p: [[0, 112], [0.13, 104]], f1: [270, 280], f2: [950, 1000], peak: 0.3, q: 5 });
    // "hm?"
    vox(bus, t + 0.62, 0.36, {
      p: [[0, 118], [0.1, 112], [0.36, 225]],
      f1: [280, 360], f2: [1000, 1300], peak: 0.42, q: 5, a: 0.04, r: 0.1,
    });
  };

  // Light-switch click plus a small electric hum blip.
  sfx.windowOn = (opts) => {
    const [t, bus] = begin(opts);
    const click = (tt, amp) => {
      noise(filt(pluck(bus, tt, 0.018, amp, 0.001), 'highpass', 2000, 0.7), tt, 0.03);
      const o = osc(pluck(bus, tt, 0.03, amp * 0.8, 0.001), 'sine', tt, 0.04, 1800);
      glide(o.frequency, tt, [[0, 1800], [0.03, 300]]);
    };
    click(t, 0.45);
    click(t + 0.04, 0.25);
    const th = t + 0.06;
    const lp = filt(swell(bus, th, 0.3, 0.2, 0.03, 0.2), 'lowpass', 900, 1);
    osc(lp, 'sawtooth', th, 0.3, 100);
    osc(gainNode(lp, 0.5), 'square', th, 0.3, 200);
    // fluorescent "tink tink"
    osc(pluck(bus, th + 0.03, 0.06, 0.1, 0.002), 'sine', th + 0.03, 0.08, 3100);
    osc(pluck(bus, th + 0.1, 0.08, 0.08, 0.002), 'sine', th + 0.1, 0.1, 3700);
  };

  // Slow creaky door, ending on a rising squeak.
  sfx.doorCreak = (opts) => {
    const [t, bus] = begin(opts);
    const dur = 1.4;
    const env = swell(bus, t, dur, 0.5, 0.1, 0.12);
    const mk = gainNode(env, 2.2);
    const b1 = filt(mk, 'bandpass', 1100, 9);
    const b2 = filt(gainNode(mk, 0.7), 'bandpass', 2600, 11);
    glide(b1.frequency, t, [[0, 900], [0.9, 1300], [dur, 1900]]);
    glide(b2.frequency, t, [[0, 2300], [0.9, 2800], [dur, 3600]]);
    const src = osc(null, 'sawtooth', t, dur, 35);
    glide(src.frequency, t, [[0, 34], [0.3, 72], [0.55, 48], [0.9, 105], [1.15, 78], [dur, 170]]);
    lfo(src.frequency, t, dur, 5.3, 6);
    src.connect(b1);
    src.connect(b2);
  };

  // 1.5 s of grumpy wordless muttering, ending in a "hrmph".
  sfx.angryMumble = (opts) => {
    const [t, bus] = begin(opts);
    const vowels = [[500, 1000], [450, 800], [700, 1100], [450, 1300], [320, 800], [600, 950]];
    let dt = 0;
    for (let i = 0; i < 7 && dt < 1.1; i++) {
      const d = R(0.1, 0.19);
      const v0 = vowels[Math.floor(Math.random() * vowels.length)];
      const v1 = vowels[Math.floor(Math.random() * vowels.length)];
      const base = R(92, 138) * (i % 3 === 1 ? 1.25 : 1);
      vox(bus, t + dt, d, {
        p: [[0, base], [d * 0.3, base * 1.12], [d, base * 0.82]],
        f1: [v0[0], v1[0]], f2: [v0[1], v1[1]],
        peak: R(0.3, 0.4), a: 0.02, r: 0.04, rasp: 31,
      });
      dt += d + R(0.01, 0.06);
    }
    // closing "hrrMPH"
    dt = Math.max(dt, 1.12);
    vox(bus, t + dt, 0.34, {
      p: [[0, 150], [0.08, 175], [0.34, 70]],
      f1: [650, 300], f2: [1150, 800], peak: 0.45, a: 0.02, r: 0.12, rasp: 38,
    });
    noise(filt(pluck(bus, t + dt, 0.1, 0.12, 0.01), 'bandpass', 1500, 1), t + dt, 0.12);
  };

  // Two cartoon barks in the distance (muffled, with an echo).
  sfx.dogBark = (opts) => {
    const [t, bus] = begin(opts);
    const far = filt(bus, 'lowpass', 2400, 0.7);
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.19;
    const fb = gainNode(delay, 0.28);
    delay.connect(fb);
    delay.connect(gainNode(far, 0.5));
    const bark = (tt, k) => {
      const mix = gainNode(far, 1);
      mix.connect(delay);
      vox(mix, tt, 0.15, {
        p: [[0, 380 * k], [0.04, 640 * k], [0.15, 300 * k]],
        f1: [750, 1150], f2: [1700, 2100], peak: 0.4, a: 0.008, r: 0.06, q: 4, rasp: 70,
      });
      noise(filt(pluck(mix, tt, 0.05, 0.2, 0.003), 'bandpass', 1300, 1.2), tt, 0.06);
    };
    bark(t, 1);
    bark(t + 0.27, 1.12);
  };

  // ───────────────────────── the badger ─────────────────────────

  // Three wet happy chomps ("nom nom nom") and a gulp.
  sfx.chomp = (opts) => {
    const [t, bus] = begin(opts);
    for (let i = 0; i < 3; i++) {
      const tt = t + i * 0.22;
      const k = 1 + i * 0.12;
      // wet "ch"
      const nf = filt(pluck(bus, tt, 0.09, 0.3, 0.004), 'lowpass', 2600, 4);
      glide(nf.frequency, tt, [[0, 2800], [0.09, 420]]);
      noise(nf, tt, 0.1);
      // spit click
      const c = osc(pluck(bus, tt, 0.03, 0.2, 0.002), 'sine', tt, 0.04, 1400);
      glide(c.frequency, tt, [[0, 1500], [0.03, 220]]);
      // "omp"
      vox(bus, tt + 0.02, 0.13, {
        p: [[0, 185 * k], [0.13, 125 * k]],
        f1: [720, 300], f2: [1150, 700], peak: 0.36, a: 0.012, r: 0.05,
      });
    }
    // gulp: dip then "gloop" up
    const tg = t + 0.76;
    const g = osc(swell(bus, tg, 0.2, 0.5, 0.02, 0.06), 'sine', tg, 0.2, 190);
    glide(g.frequency, tg, [[0, 190], [0.08, 95], [0.2, 460]]);
    const g2 = osc(swell(bus, tg, 0.2, 0.12, 0.02, 0.06), 'triangle', tg, 0.2, 380);
    glide(g2.frequency, tg, [[0, 380], [0.08, 190], [0.2, 920]]);
  };

  // Short tummy rumble with bubbles and a final "blorp".
  sfx.stomachRumble = (opts) => {
    const [t, bus] = begin(opts);
    const dur = 0.9;
    const env = swell(bus, t, dur, 0.4, 0.12, 0.2);
    const am = gainNode(env, 0.55);
    lfo(am.gain, t, dur, 7.3, 0.3);
    lfo(am.gain, t, dur, 11.7, 0.15);
    // growl with enough harmonics to be heard on small headset speakers
    const lp = filt(am, 'lowpass', 520, 2);
    lfo(lp.frequency, t, dur, 3.1, 180);
    const s = osc(lp, 'sawtooth', t, dur, 62);
    glide(s.frequency, t, [[0, 58], [0.3, 86], [0.6, 52], [dur, 74]]);
    lfo(s.frequency, t, dur, 13, 9);
    noise(filt(gainNode(am, 0.9), 'lowpass', 260, 1), t, dur, 'brown');
    // bubbles
    for (let i = 0; i < 4; i++) {
      const tb = t + R(0.1, 0.7);
      const f = R(180, 380);
      const b = osc(pluck(bus, tb, 0.06, 0.16, 0.006), 'sine', tb, 0.08, f);
      glide(b.frequency, tb, [[0, f], [0.06, f * 1.8]]);
    }
    const tb = t + 0.72;
    const b = osc(swell(bus, tb, 0.14, 0.3, 0.02, 0.05), 'sine', tb, 0.14, 90);
    glide(b.frequency, tb, [[0, 95], [0.14, 300]]);
  };

  // Two quick animal sniffs.
  sfx.sniff = (opts) => {
    const [t, bus] = begin(opts);
    [0, 0.17].forEach((dt, i) => {
      const tt = t + dt;
      const f = filt(swell(bus, tt, 0.1, 0.42, 0.035, 0.03), 'bandpass', 1800, 2);
      glide(f.frequency, tt, [[0, 1500 + i * 300], [0.1, 3600 + i * 500]]);
      noise(f, tt, 0.1);
    });
  };

  // Small sticky honey squelch. Cheap: one noise source + one oscillator.
  sfx.squelch = (opts) => {
    const [t, bus] = begin(opts);
    const k = R(0.8, 1.3);
    const f = filt(swell(bus, t, 0.14, 0.4, 0.02, 0.06), 'bandpass', 300, 5);
    glide(f.frequency, t, [[0, 300 * k], [0.07, 1700 * k], [0.14, 500 * k]]);
    noise(f, t, 0.14);
    const o = osc(pluck(bus, t + 0.05, 0.07, 0.25, 0.008), 'sine', t + 0.05, 0.1, 260);
    glide(o.frequency, t + 0.05, [[0, 240 * k], [0.07, 760 * k]]);
  };

  // ───────────────────────── the bin and the throw ─────────────────────────

  // Springy hinge "boing-creak".
  sfx.lidOpen = (opts) => {
    const [t, bus] = begin(opts);
    // creak
    const cb = filt(gainNode(swell(bus, t, 0.26, 0.4, 0.03, 0.08), 2), 'bandpass', 1900, 10);
    glide(cb.frequency, t, [[0, 1500], [0.26, 2700]]);
    const c = osc(cb, 'sawtooth', t, 0.26, 60);
    glide(c.frequency, t, [[0, 55], [0.26, 135]]);
    // boing: rising tone with a big decaying wobble
    const tb = t + 0.18;
    const env = pluck(bus, tb, 0.6, 0.45, 0.008);
    const o = osc(env, 'triangle', tb, 0.65, 200);
    glide(o.frequency, tb, [[0, 190], [0.6, 360]]);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(110, tb);
    depth.gain.exponentialRampToValueAtTime(4, tb + 0.6);
    depth.connect(o.frequency);
    osc(depth, 'sine', tb, 0.65, 15);
    const o2 = osc(gainNode(env, 0.3), 'sine', tb, 0.65, 400);
    glide(o2.frequency, tb, [[0, 380], [0.6, 720]]);
    depth.connect(o2.frequency);
    // lid ping
    osc(pluck(bus, tb, 0.12, 0.12, 0.002), 'sine', tb, 0.15, 2300);
  };

  // Soft throw whoosh.
  sfx.whoosh = (opts) => {
    const [t, bus] = begin(opts);
    const dur = 0.36;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.42, t + 0.16);
    g.gain.linearRampToValueAtTime(0, t + dur);
    g.connect(bus);
    const f = filt(g, 'bandpass', 400, 1.3);
    glide(f.frequency, t, [[0, 380], [0.17, 1900], [dur, 620]]);
    noise(f, t, dur);
  };

  // Something hits a wooden house wall, then a short rattle.
  sfx.clonk = (opts) => {
    const [t, bus] = begin(opts);
    const o = osc(pluck(bus, t, 0.14, 0.5, 0.003), 'sine', t, 0.18, 190);
    glide(o.frequency, t, [[0, 210], [0.14, 105]]);
    osc(pluck(bus, t, 0.05, 0.22, 0.002), 'triangle', t, 0.07, 430);
    noise(filt(pluck(bus, t, 0.03, 0.3, 0.002), 'lowpass', 1300, 1), t, 0.05);
    // rattle: quick knocks, getting closer together and quieter
    let dt = 0.13;
    let gap = 0.075;
    for (let i = 0; i < 6; i++) {
      const tt = t + dt;
      const amp = 0.2 * Math.pow(0.75, i);
      osc(pluck(bus, tt, 0.035, amp, 0.002), 'triangle', tt, 0.05, R(520, 880));
      noise(filt(pluck(bus, tt, 0.02, amp, 0.002), 'bandpass', 900, 2), tt, 0.03);
      dt += gap;
      gap *= 0.78;
    }
  };

  // Satisfying "fwip" when an item slips through the hole, with a tiny ding.
  sfx.pass = (opts) => {
    const [t, bus] = begin(opts);
    const f = filt(swell(bus, t, 0.11, 0.35, 0.05, 0.03), 'bandpass', 800, 2.5);
    glide(f.frequency, t, [[0, 800], [0.11, 5200]]);
    noise(f, t, 0.11);
    const o = osc(swell(bus, t, 0.1, 0.22, 0.03, 0.03), 'sine', t, 0.1, 600);
    glide(o.frequency, t, [[0, 600], [0.1, 2500]]);
    const td = t + 0.1;
    osc(pluck(bus, td, 0.2, 0.22, 0.003), 'sine', td, 0.24, 1760);
    osc(pluck(bus, td, 0.14, 0.12, 0.003), 'sine', td, 0.18, 2637);
  };

  // Short two-tone warning. dir: 'left' | 'right' | 'front' | 'behind' | 'above' | 'below'.
  //   left/right  panned hard, falling pair
  //   front       two equal high beeps, centred
  //   behind      two equal low muffled beeps, centred
  //   above       rising pair          below  falling low pair
  sfx.wallWarn = (dir, opts) => {
    if (dir && typeof dir === 'object') { opts = dir; dir = 'front'; }
    const table = {
      left: { pan: -0.85, a: 660, b: 520, cut: 2600 },
      right: { pan: 0.85, a: 660, b: 520, cut: 2600 },
      front: { pan: 0, a: 880, b: 880, cut: 3200 },
      behind: { pan: 0, a: 330, b: 330, cut: 650 },
      above: { pan: 0, a: 620, b: 930, cut: 3000 },
      below: { pan: 0, a: 520, b: 347, cut: 1800 },
    };
    const d = table[dir] || table.front;
    const [t, bus] = begin(opts, d.pan);
    const lp = filt(bus, 'lowpass', d.cut, 0.8);
    [d.a, d.b].forEach((f, i) => {
      const tt = t + i * 0.13;
      const env = swell(lp, tt, 0.11, 0.3, 0.008, 0.03);
      osc(env, 'square', tt, 0.11, f);
      osc(gainNode(env, 0.5), 'triangle', tt, 0.11, f * 2);
    });
  };

  // ───────────────────────── jingles ─────────────────────────

  // Jaunty 4-note "new location" jingle.
  sfx.newBin = (opts) => {
    const [t, bus] = begin(opts);
    const notes = [[0, 523.25, 0.11], [0.12, 659.25, 0.11], [0.24, 783.99, 0.15], [0.43, 1046.5, 0.42]];
    notes.forEach(([dt, f, d], i) => {
      const tt = t + dt;
      const last = i === notes.length - 1;
      const env = pluck(bus, tt, d + 0.08, 0.3, 0.006);
      const o = osc(env, 'triangle', tt, d + 0.12, f);
      osc(gainNode(filt(env, 'lowpass', 3000, 0.7), 0.25), 'square', tt, d + 0.12, f);
      const up = osc(gainNode(env, 0.25), 'sine', tt, d + 0.12, f * 2);
      if (last) {
        lfo(o.frequency, tt, d + 0.12, 7, 9);
        lfo(up.frequency, tt, d + 0.12, 7, 18);
      } else {
        // little grace-note scoop up into each note
        glide(o.frequency, tt, [[0, f * 0.94], [0.03, f]]);
      }
    });
  };

  // Comic "sad trombone" 4-note fall (wah wah wah waaaah).
  sfx.gameOver = (opts) => {
    const [t, bus] = begin(opts);
    const notes = [[0, 233.08, 0.3], [0.34, 220, 0.3], [0.68, 207.65, 0.3], [1.02, 196, 0.95]];
    notes.forEach(([dt, f, d], i) => {
      const tt = t + dt;
      const last = i === notes.length - 1;
      const env = swell(bus, tt, d, 0.5, 0.04, last ? 0.35 : 0.08);
      const wah = filt(env, 'lowpass', 500, 3);
      glide(wah.frequency, tt, [[0, 380], [Math.min(0.12, d * 0.4), 1400], [d, last ? 320 : 600]]);
      const o = osc(wah, 'sawtooth', tt, d, f);
      const o2 = osc(gainNode(wah, 0.5), 'sawtooth', tt, d, f * 1.006);
      // scoop into each note; the last one droops and wobbles
      const pts = last
        ? [[0, f * 1.04], [0.06, f], [d * 0.45, f * 0.97], [d, f * 0.72]]
        : [[0, f * 1.04], [0.06, f], [d, f * 0.975]];
      glide(o.frequency, tt, pts);
      glide(o2.frequency, tt, pts.map(([a, v]) => [a, v * 1.006]));
      if (last) {
        lfo(o.frequency, tt, d, 5.5, 5);
        lfo(o2.frequency, tt, d, 5.5, 5);
      }
    });
  };

  sfx.all = [
    'clatter', 'snoreStart', 'snoreStop', 'windowOn', 'doorCreak', 'angryMumble', 'dogBark',
    'chomp', 'stomachRumble', 'lidOpen', 'squelch', 'whoosh', 'clonk', 'pass', 'wallWarn',
    'sniff', 'newBin', 'gameOver',
  ];

  return sfx;
}
