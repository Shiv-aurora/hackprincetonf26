// MayaJaal sound engine. Everything is synthesized with Tone.js (no audio files).
//
// Design goals (DESIGN.md §3): subtle, cinematic, never annoying through a projector.
//  - Nothing makes a sound until the user has interacted (browser autoplay rules).
//  - No method ever throws. If Tone or Web Audio is unavailable, every cue is a silent no-op.
//  - Bursts are rate-limited, and the whole mix goes through a compressor + limiter.
//
// Tone is imported lazily on the first unlock, so it is never evaluated during SSR and never creates
// an AudioContext before a user gesture.

type ToneLib = typeof import("tone");
type AnyNode = { dispose: () => unknown };

export type TickTier = "real" | "shadow";
export type TickActor = "attacker" | "clinician";

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

// Real ticks: a high, clean pentatonic sparkle. Shadow ticks: same set, an octave down, detuned and
// sunk underwater through a low-pass + vibrato + long reverb.
const REAL_NOTES = ["E6", "F#6", "A6", "B6", "C#7"] as const;
const SHADOW_NOTES = ["E5", "F#5", "A5", "B5", "C#6"] as const;
const CHIMES: [string, string][] = [["E5", "B5"], ["F#5", "C#6"], ["A5", "E6"], ["B5", "F#6"]];

interface Graph {
  master: import("tone").Gain;
  meter: import("tone").Meter;
  hallIn: import("tone").Gain;
  droneGain: import("tone").Gain;
  swellGain: import("tone").Gain;
  swellFilter: import("tone").Filter;
  tensionGain: import("tone").Gain;
  tickReal: import("tone").Synth;
  tickRealPan: import("tone").Panner;
  tickShadow: import("tone").Synth;
  tickShadowPan: import("tone").Panner;
  glass: import("tone").PolySynth<import("tone").FMSynth>;
  alarm: import("tone").MonoSynth;
  alarmSub: import("tone").Synth;
  sub: import("tone").MembraneSynth;
  impact: import("tone").NoiseSynth;
  chime: import("tone").PolySynth<import("tone").FMSynth>;
  shimmer: import("tone").Player | null;
  shimmerFallback: import("tone").PolySynth<import("tone").AMSynth>;
  nodes: AnyNode[];
}

class SoundEngine {
  private T: ToneLib | null = null;
  private g: Graph | null = null;
  private unlocking: Promise<boolean> | null = null;
  private enabled = false;
  private volume = 0.8;
  private failed = false;
  private lastAt: Record<string, number> = {}; // wall-clock rate limiting (ms)
  private lastTime = new Map<object, number>(); // per-instrument monotonic audio time (s)
  private tickBudget = { windowStart: 0, count: 0 };
  private intentP = 0;
  private chimeIdx = 0;

  /** True once the audio graph exists and the context is running. */
  get ready() {
    return this.g !== null;
  }

  get isEnabled() {
    return this.enabled;
  }

  /**
   * Create + resume the AudioContext and build the graph. Call from a user gesture (click / key).
   * Resolves true when audio is running. Never throws.
   */
  unlock(): Promise<boolean> {
    if (this.g) {
      try {
        const ctx = this.T?.getContext().rawContext as AudioContext | undefined;
        if (ctx && ctx.state !== "running") void ctx.resume().catch(() => {});
      } catch {}
      return Promise.resolve(true);
    }
    if (this.failed || typeof window === "undefined") return Promise.resolve(false);
    if (this.unlocking) return this.unlocking;

    // Create and resume a native context synchronously, inside the gesture (Safari needs this).
    let native: AudioContext | null = null;
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        native = new Ctor({ latencyHint: "interactive" });
        void native.resume().catch(() => {});
      }
    } catch {
      native = null;
    }
    if (!native) {
      this.failed = true;
      return Promise.resolve(false);
    }

    this.unlocking = (async () => {
      try {
        (window as unknown as { TONE_SILENCE_LOGGING?: boolean }).TONE_SILENCE_LOGGING = true;
        const T = await import("tone");
        T.setContext(new T.Context({ context: native, lookAhead: 0.03 }), true);
        await T.start();
        this.T = T;
        this.build(T);
        this.applyVolume(1.2);
        return true;
      } catch (err) {
        console.warn("[sound] audio unavailable:", err);
        this.failed = true;
        this.g = null;
        return false;
      } finally {
        this.unlocking = null;
      }
    })();
    return this.unlocking;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.applyVolume(on ? 1.2 : 0.35);
  }

  /** Master volume 0..1. */
  setVolume(v: number) {
    this.volume = clamp(v);
    this.applyVolume(0.15);
  }

  /** Output level in dBFS (for debugging the mix). */
  level(): number {
    try {
      const v = this.g?.meter.getValue();
      return typeof v === "number" ? v : Array.isArray(v) ? Math.max(...v) : -Infinity;
    } catch {
      return -Infinity;
    }
  }

  // ------------------------------------------------------------------ cues

  /** One request hitting a tier. Clinician traffic is quieter than attacker traffic. */
  tick(tier: TickTier, actor: TickActor = "attacker") {
    this.play(`tick`, actor === "clinician" ? 110 : 55, (T, g) => {
      // At most ~9 ticks a second so bursts never smear into noise or clip.
      const nowMs = performance.now();
      if (nowMs - this.tickBudget.windowStart > 1000) this.tickBudget = { windowStart: nowMs, count: 0 };
      if (++this.tickBudget.count > 9) return;
      const vel = (actor === "clinician" ? 0.16 : 0.5) * (0.85 + Math.random() * 0.3);
      if (tier === "shadow") {
        g.tickShadowPan.pan.value = (Math.random() - 0.5) * 0.7;
        g.tickShadow.triggerAttackRelease(pick(SHADOW_NOTES), 0.08, this.at(T, g.tickShadow), vel);
      } else {
        g.tickRealPan.pan.value = (Math.random() - 0.5) * 0.7;
        g.tickReal.triggerAttackRelease(pick(REAL_NOTES), 0.03, this.at(T, g.tickReal), vel);
      }
    });
  }

  /** Tension swell following the top non-benign goal probability (0..1). */
  intent(p: number) {
    this.intentP = clamp(p);
    const g = this.g;
    if (!g) return;
    try {
      const lvl = smooth(0.3, 0.92, this.intentP);
      g.swellGain.gain.rampTo(lvl * 0.3, 3);
      g.swellFilter.frequency.rampTo(260 + lvl * 1500, 3.5);
      g.tensionGain.gain.rampTo(smooth(0.68, 0.95, this.intentP) * 0.05, 4);
    } catch {}
  }

  /** Honeytoken touched: a glass ping. */
  glass() {
    this.play("glass", 400, (T, g) => {
      const t = this.at(T, g.glass);
      g.glass.triggerAttackRelease("A6", 1.2, t, 0.42);
      g.glass.triggerAttackRelease("E7", 1.0, t + 0.09, 0.22);
    });
  }

  /** Node compromised / down: a low two-beat pulse. */
  alarm() {
    this.play("alarm", 2200, (T, g) => {
      const t = Math.max(this.at(T, g.alarm, 0.4), this.at(T, g.alarmSub, 0.4));
      g.alarm.triggerAttackRelease("A2", 0.22, t, 0.75);
      g.alarm.triggerAttackRelease("A2", 0.22, t + 0.36, 0.55);
      g.alarmSub.triggerAttackRelease("A1", 0.22, t, 0.6);
      g.alarmSub.triggerAttackRelease("A1", 0.22, t + 0.36, 0.45);
    });
  }

  /** The Reveal: a sub-bass hit and a reversed shimmer rising as the glyphs dissolve. */
  reveal() {
    this.play("reveal", 3000, (T, g) => {
      const t = this.at(T, g.sub);
      g.sub.triggerAttackRelease("F1", 1.4, t, 0.95);
      g.impact.triggerAttackRelease(0.6, t, 0.5);
      if (g.shimmer && g.shimmer.loaded) {
        g.shimmer.start(t + 0.05);
      } else {
        g.shimmerFallback.triggerAttackRelease(["A5", "C#6", "E6", "A6"], 2.6, t + 0.05, 0.35);
      }
    });
  }

  /** Lab order rerouted → completed, or continuity recovering: a rising two-note chime. */
  chime() {
    this.play("chime", 2600, (T, g) => {
      const [a, b] = CHIMES[this.chimeIdx++ % CHIMES.length];
      const t = this.at(T, g.chime);
      g.chime.triggerAttackRelease(a, 0.6, t, 0.38);
      g.chime.triggerAttackRelease(b, 0.9, t + 0.17, 0.32);
    });
  }

  /** New run: let the tension fall away. */
  reset() {
    this.intent(0);
  }

  // ------------------------------------------------------------------ internals

  private play(key: string, minGapMs: number, fn: (T: ToneLib, g: Graph) => void) {
    const T = this.T;
    const g = this.g;
    if (!T || !g || !this.enabled || this.volume <= 0.001) return;
    const now = performance.now();
    if (now - (this.lastAt[key] ?? -1e9) < minGapMs) return;
    this.lastAt[key] = now;
    try {
      fn(T, g);
    } catch (err) {
      // Never let a sound crash the page.
      console.warn(`[sound] ${key} skipped:`, err);
    }
  }

  /** Tone throws if a monophonic instrument is triggered at a time <= its previous trigger. */
  private at(T: ToneLib, inst: object, reserve = 0) {
    const t = Math.max(T.now(), (this.lastTime.get(inst) ?? 0) + 0.012);
    this.lastTime.set(inst, t + reserve); // reserve room for follow-up notes the cue schedules
    return t;
  }

  private applyVolume(rampS: number) {
    const g = this.g;
    if (!g) return;
    try {
      // Perceptual curve: square the slider.
      const target = this.enabled ? this.volume * this.volume : 0;
      g.master.gain.rampTo(target, rampS);
    } catch {}
  }

  private build(T: ToneLib) {
    const nodes: AnyNode[] = [];
    const keep = <N extends AnyNode>(n: N) => {
      nodes.push(n);
      return n;
    };

    // Master bus: gain → gentle compressor → limiter → speakers.
    const master = keep(new T.Gain(0));
    const comp = keep(new T.Compressor({ threshold: -20, ratio: 3, attack: 0.008, release: 0.3 }));
    const limiter = keep(new T.Limiter(-2));
    const meter = keep(new T.Meter({ smoothing: 0.85 }));
    master.chain(comp, limiter, T.getDestination());
    limiter.connect(meter);

    // Shared hall reverb (send).
    const hall = keep(new T.Reverb({ decay: 3.4, preDelay: 0.03, wet: 1 }));
    const hallIn = keep(new T.Gain(1));
    hallIn.connect(hall);
    hall.connect(master);
    const send = (src: { connect: (n: import("tone").InputNode) => unknown }, amt: number) => {
      const s = keep(new T.Gain(amt));
      src.connect(s);
      s.connect(hallIn);
    };

    // Ambient drone: low, warm, very quiet. A1 + E2 + A2 under a slowly breathing low-pass.
    const droneGain = keep(new T.Gain(0));
    droneGain.connect(master);
    send(droneGain, 0.25);
    const droneFilter = keep(new T.Filter({ type: "lowpass", frequency: 300, Q: 0.7, rolloff: -24 }));
    const d1 = keep(new T.FatOscillator({ frequency: "A1", type: "sawtooth", count: 3, spread: 16 }));
    d1.volume.value = -14;
    const d2 = keep(new T.Oscillator({ frequency: "E2", type: "triangle" }));
    d2.volume.value = -12;
    const d3 = keep(new T.Oscillator({ frequency: "A2", type: "sine" }));
    d3.volume.value = -10;
    [d1, d2, d3].forEach((o) => o.connect(droneFilter));
    const droneLfo = keep(new T.LFO({ frequency: 0.045, min: 200, max: 520 }));
    droneLfo.connect(droneFilter.frequency);
    const droneAmp = keep(new T.LFO({ frequency: 0.031, min: 0.75, max: 1 }));
    const droneAmpGain = keep(new T.Gain(1));
    droneFilter.chain(droneAmpGain, droneGain);
    droneAmp.connect(droneAmpGain.gain);
    [d1, d2, d3].forEach((o) => o.start());
    droneLfo.start();
    droneAmp.start();
    droneGain.gain.rampTo(0.04, 6);

    // Tension swell: an open fifth (D3 + A3) that opens up as intent rises; an Eb4 creeps in near the top.
    const swellGain = keep(new T.Gain(0));
    swellGain.connect(master);
    send(swellGain, 0.5);
    const swellFilter = keep(new T.Filter({ type: "lowpass", frequency: 260, Q: 1.4 }));
    swellFilter.connect(swellGain);
    const s1 = keep(new T.FatOscillator({ frequency: "D3", type: "sawtooth", count: 3, spread: 28 }));
    const s2 = keep(new T.FatOscillator({ frequency: "A3", type: "sawtooth", count: 3, spread: 22 }));
    s1.volume.value = -16;
    s2.volume.value = -19;
    s1.connect(swellFilter);
    s2.connect(swellFilter);
    const tensionGain = keep(new T.Gain(0));
    tensionGain.connect(swellFilter);
    const s3 = keep(new T.Oscillator({ frequency: "D#4", type: "triangle" }));
    s3.connect(tensionGain);
    const swellVib = keep(new T.LFO({ frequency: 0.12, min: -40, max: 40 }));
    swellVib.connect(swellFilter.detune);
    [s1, s2, s3].forEach((o) => o.start());
    swellVib.start();

    // Real tick: soft, clean, high.
    const tickReal = keep(
      new T.Synth({
        oscillator: { type: "sine" },
        envelope: { attack: 0.002, decay: 0.07, sustain: 0, release: 0.05 },
      }),
    );
    const tickRealPan = keep(new T.Panner(0));
    const tickRealVol = keep(new T.Gain(0.32));
    tickReal.chain(tickRealPan, tickRealVol, master);
    send(tickRealVol, 0.1);

    // Shadow tick: same idea, detuned and underwater.
    const tickShadow = keep(
      new T.Synth({
        oscillator: { type: "triangle" },
        detune: -38,
        envelope: { attack: 0.004, decay: 0.22, sustain: 0, release: 0.25 },
      }),
    );
    const vib = keep(new T.Vibrato({ frequency: 4.5, depth: 0.25 }));
    const murk = keep(new T.Filter({ type: "lowpass", frequency: 1300, Q: 2 }));
    const tickShadowPan = keep(new T.Panner(0));
    const deep = keep(new T.Reverb({ decay: 5, preDelay: 0.04, wet: 0.7 }));
    const tickShadowVol = keep(new T.Gain(0.5));
    tickShadow.chain(vib, murk, tickShadowPan, deep, tickShadowVol, master);

    // Glass ping for honeytokens.
    const glass = keep(
      new T.PolySynth(T.FMSynth, {
        harmonicity: 3.01,
        modulationIndex: 7,
        oscillator: { type: "sine" },
        modulation: { type: "sine" },
        envelope: { attack: 0.001, decay: 1.6, sustain: 0, release: 1.4 },
        modulationEnvelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.2 },
      }),
    );
    const glassVol = keep(new T.Gain(0.4));
    glass.connect(glassVol);
    glassVol.connect(master);
    send(glassVol, 0.6);

    // Alarm: low, round two-beat pulse (never shrill).
    const alarm = keep(
      new T.MonoSynth({
        oscillator: { type: "sawtooth" },
        filter: { type: "lowpass", Q: 3, rolloff: -24 },
        filterEnvelope: { attack: 0.006, decay: 0.22, sustain: 0.15, release: 0.3, baseFrequency: 140, octaves: 2.3 },
        envelope: { attack: 0.012, decay: 0.32, sustain: 0, release: 0.25 },
      }),
    );
    const alarmSub = keep(
      new T.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.01, decay: 0.35, sustain: 0, release: 0.2 } }),
    );
    const alarmVol = keep(new T.Gain(0.42));
    alarm.connect(alarmVol);
    alarmSub.connect(alarmVol);
    alarmVol.connect(master);
    send(alarmVol, 0.18);

    // Reveal: sub-bass hit + dark noise bloom + reversed shimmer.
    const sub = keep(
      new T.MembraneSynth({
        pitchDecay: 0.09,
        octaves: 4.5,
        oscillator: { type: "sine" },
        envelope: { attack: 0.001, decay: 1.8, sustain: 0, release: 1.2 },
      }),
    );
    const subVol = keep(new T.Gain(0.85));
    sub.connect(subVol);
    subVol.connect(master);
    const impact = keep(
      new T.NoiseSynth({ noise: { type: "brown" }, envelope: { attack: 0.004, decay: 0.9, sustain: 0 } }),
    );
    const impactLp = keep(new T.Filter({ type: "lowpass", frequency: 500, Q: 0.5 }));
    const impactVol = keep(new T.Gain(0.35));
    impact.chain(impactLp, impactVol, master);
    send(impactVol, 0.8);
    const shimmerVol = keep(new T.Gain(0.5));
    shimmerVol.connect(master);
    send(shimmerVol, 0.25);
    const shimmerFallback = keep(
      new T.PolySynth(T.AMSynth, {
        harmonicity: 2,
        envelope: { attack: 2.4, decay: 0.1, sustain: 1, release: 0.06 },
      }),
    );
    shimmerFallback.volume.value = -14;
    shimmerFallback.connect(shimmerVol);

    // Rising two-note chime for recovered care.
    const chime = keep(
      new T.PolySynth(T.FMSynth, {
        harmonicity: 2,
        modulationIndex: 1.4,
        oscillator: { type: "sine" },
        modulation: { type: "sine" },
        envelope: { attack: 0.006, decay: 1.1, sustain: 0, release: 1.2 },
        modulationEnvelope: { attack: 0.002, decay: 0.3, sustain: 0, release: 0.3 },
      }),
    );
    const chimeVol = keep(new T.Gain(0.17));
    chime.connect(chimeVol);
    chimeVol.connect(master);
    send(chimeVol, 0.45);

    this.g = {
      master, meter, hallIn, droneGain, swellGain, swellFilter, tensionGain,
      tickReal, tickRealPan, tickShadow, tickShadowPan, glass, alarm, alarmSub,
      sub, impact, chime, shimmer: null, shimmerFallback, nodes,
    };
    this.intent(this.intentP);

    // Render the reversed shimmer offline (a bell cluster's reverb tail, played backwards).
    void this.renderShimmer(T, shimmerVol);
  }

  private async renderShimmer(T: ToneLib, out: import("tone").Gain) {
    try {
      const buf = await T.Offline(() => {
        const verb = new T.Freeverb({ roomSize: 0.9, dampening: 5200, wet: 0.9 }).toDestination();
        const bells = new T.PolySynth(T.FMSynth, {
          harmonicity: 3.5,
          modulationIndex: 4,
          envelope: { attack: 0.002, decay: 1.2, sustain: 0, release: 1.2 },
          modulationEnvelope: { attack: 0.002, decay: 0.3, sustain: 0, release: 0.3 },
        }).connect(verb);
        bells.volume.value = -10;
        ["A5", "C#6", "E6", "A6", "C#7"].forEach((n, i) => bells.triggerAttackRelease(n, 0.25, 0.02 + i * 0.025, 0.5));
      }, 3.2, 2);
      if (!this.g) return;
      const player = new T.Player(buf);
      player.reverse = true;
      player.fadeOut = 0.02;
      player.connect(out);
      this.g.shimmer = player;
      this.g.nodes.push(player);
    } catch (err) {
      console.warn("[sound] shimmer render failed, using fallback:", err);
    }
  }
}

/** Global singleton: one audio graph per page, shared by every component. */
export const soundEngine = new SoundEngine();

// Dev-only handle for poking the mix from the console: __mjSound.reveal(), __mjSound.level().
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __mjSound?: SoundEngine }).__mjSound = soundEngine;
}
