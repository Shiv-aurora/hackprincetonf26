// MayaJaal sound engine — minimal and quiet. Plain Web Audio, no samples, no libraries.
//
// Three cues only:
//   tick()      soft click for a shadow-tier request (rate-limited)
//   diverted()  one low tone when the session is moved into the shadow
//   reveal()    a short, soft chord
//
// Nothing plays until unlock() is called from a user gesture. No method ever throws: if Web Audio is
// missing or fails, every cue is a silent no-op.

export type TickTier = "real" | "shadow";
export type TickActor = "attacker" | "clinician";

type Ctx = AudioContext;

const TICK_MIN_GAP_MS = 140;
const TICK_BURST = { windowMs: 1000, max: 5 };

class SoundEngine {
  private ctx: Ctx | null = null;
  private out: GainNode | null = null;
  private enabled = false;
  private volume = 0.8;
  private lastTickAt = 0;
  private burst = { start: 0, count: 0 };
  private lastDivertedAt = 0;
  private lastRevealAt = 0;

  get ready() {
    return this.ctx !== null;
  }

  get isEnabled() {
    return this.enabled;
  }

  /** Create / resume the AudioContext. Call from a user gesture. Resolves true when audio runs. */
  async unlock(): Promise<boolean> {
    try {
      if (typeof window === "undefined") return false;
      if (!this.ctx) {
        const AC: typeof AudioContext | undefined =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return false;
        const ctx = new AC();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.ratio.value = 4;
        const out = ctx.createGain();
        out.gain.value = this.volume;
        out.connect(comp).connect(ctx.destination);
        this.ctx = ctx;
        this.out = out;
      }
      if (this.ctx.state !== "running") await this.ctx.resume();
      return this.ctx.state === "running";
    } catch {
      return false;
    }
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    try {
      if (!on && this.ctx && this.out) this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      if (on && this.ctx && this.out) this.out.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    } catch {}
  }

  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    try {
      if (this.enabled && this.ctx && this.out) this.out.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    } catch {}
  }

  /** One enveloped oscillator. */
  private tone(freq: number, { at = 0, attack = 0.005, decay = 0.2, gain = 0.1, type = "sine" as OscillatorType } = {}) {
    const ctx = this.ctx;
    const out = this.out;
    if (!ctx || !out) return;
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(gain, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    osc.connect(env).connect(out);
    osc.start(t0);
    osc.stop(t0 + attack + decay + 0.05);
    osc.onended = () => {
      try { osc.disconnect(); env.disconnect(); } catch {}
    };
  }

  private live() {
    return this.enabled && this.ctx !== null && this.ctx.state === "running";
  }

  /** Soft tick. Only shadow-tier requests make a sound; bursts are capped. */
  tick(tier: TickTier = "shadow", _actor: TickActor = "attacker") {
    void _actor;
    try {
      if (tier !== "shadow" || !this.live()) return;
      const now = performance.now();
      if (now - this.lastTickAt < TICK_MIN_GAP_MS) return;
      if (now - this.burst.start > TICK_BURST.windowMs) this.burst = { start: now, count: 0 };
      if (this.burst.count >= TICK_BURST.max) return;
      this.burst.count++;
      this.lastTickAt = now;
      this.tone(1320, { attack: 0.002, decay: 0.05, gain: 0.035, type: "triangle" });
    } catch {}
  }

  /** A single low tone: the session has been moved into the shadow. */
  diverted() {
    try {
      if (!this.live()) return;
      const now = performance.now();
      if (now - this.lastDivertedAt < 2000) return;
      this.lastDivertedAt = now;
      this.tone(110, { attack: 0.04, decay: 1.4, gain: 0.16 });
      this.tone(220, { attack: 0.04, decay: 0.9, gain: 0.03 });
    } catch {}
  }

  /** A short soft chord for the Reveal. */
  reveal() {
    try {
      if (!this.live()) return;
      const now = performance.now();
      if (now - this.lastRevealAt < 2000) return;
      this.lastRevealAt = now;
      [261.63, 392.0, 493.88, 659.25].forEach((f, i) =>
        this.tone(f, { at: i * 0.045, attack: 0.06, decay: 1.6, gain: 0.045 }));
    } catch {}
  }

  /** Clear rate-limit state between runs. */
  reset() {
    this.lastTickAt = 0;
    this.burst = { start: 0, count: 0 };
    this.lastDivertedAt = 0;
    this.lastRevealAt = 0;
  }
}

export const soundEngine = new SoundEngine();
