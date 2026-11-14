"use client";
// The Jaal: threads of light weave a net dome over still water; its reflection (the Maya) shimmers
// violet beneath. Canvas 2D, additive blending, no dependencies.
//
// Imperative handle:  pulse("real" | "shadow")  sends a packet up a thread (teal on the net, violet in
//                     the reflection);  skip()  jumps to the fully woven state.

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

export interface JaalHandle {
  pulse: (kind: "real" | "shadow") => void;
  skip: () => void;
}

export interface JaalCanvasProps {
  ref?: Ref<JaalHandle>;
  className?: string;
  /** Skip the weave (reduced motion / revisits). */
  instant?: boolean;
  /** Called once the net is fully woven. */
  onWoven?: () => void;
}

type RGB = [number, number, number];
const TEAL: RGB = [45, 226, 208];
const CYAN: RGB = [124, 243, 255];
const VIOLET: RGB = [139, 92, 246];
const MAGENTA: RGB = [217, 70, 239];

const N = 18;          // threads per spiral direction
const S = 44;          // samples per thread
const TWIST = 1.35;    // radians of azimuth per radian of elevation
const THETA_MAX = Math.PI / 2 - 0.035;
const WEAVE_START = 350;
const WEAVE_SPREAD = 1100;
const WEAVE_DUR = 1700;

interface Thread {
  phi0: number;
  dir: 1 | -1;
  delay: number;
  dur: number;
  color: RGB;
  rcolor: RGB;
}
interface Pulse { thread: number; reflect: boolean; t0: number; dur: number }
interface Mote { x: number; y: number; z: number; v: number; a: number }

const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));

export function JaalCanvas({ ref, className, instant = false, onWoven }: JaalCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const api = useRef({ start: 0, pulses: [] as Pulse[], lastPulse: 0, woven: false });
  const onWovenRef = useRef(onWoven);
  useEffect(() => {
    onWovenRef.current = onWoven;
  }, [onWoven]);

  useImperativeHandle(ref, () => ({
    pulse(kind) {
      const a = api.current;
      if (a.pulses.length > 40) return;
      a.pulses.push({
        thread: Math.floor(Math.random() * N * 2),
        reflect: kind === "shadow",
        t0: performance.now(),
        dur: 1500 + Math.random() * 700,
      });
      a.lastPulse = performance.now();
    },
    skip() {
      api.current.start = performance.now() - 10_000;
    },
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Deterministic-ish thread set.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const threads: Thread[] = [];
    for (let i = 0; i < N * 2; i++) {
      const dir = i < N ? 1 : -1;
      const k = i % N;
      threads.push({
        phi0: (k / N) * Math.PI * 2 + (dir < 0 ? Math.PI / N : 0),
        dir,
        delay: WEAVE_START + rnd() * WEAVE_SPREAD,
        dur: WEAVE_DUR * (0.85 + rnd() * 0.3),
        color: rnd() < 0.22 ? CYAN : TEAL,
        rcolor: rnd() < 0.35 ? MAGENTA : VIOLET,
      });
    }
    const motes: Mote[] = Array.from({ length: 70 }, () => ({
      x: rnd(), y: rnd(), z: 0.3 + rnd() * 0.7, v: 0.004 + rnd() * 0.01, a: rnd() * Math.PI * 2,
    }));

    let w = 0, h = 0, dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const a = api.current;
    a.start = performance.now() - (instant ? 10_000 : 0);
    a.woven = false;

    // Scratch buffers for projected points.
    const px = new Float32Array(S + 1), py = new Float32Array(S + 1), pd = new Float32Array(S + 1);
    const rx = new Float32Array(S + 1), ry = new Float32Array(S + 1);

    let raf = 0;
    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(canvas);

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible) return;
      const t = now - a.start;
      const ts = now / 1000;
      const W = w * dpr, H = h * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, W, H);

      // Camera / dome layout (in device pixels).
      const narrow = w < 700;
      const horizon = H * (narrow ? 0.74 : 0.64);
      const halfW = narrow ? Math.min(W * 0.44, H * 0.3) : Math.min(W * 0.34, H * 0.62);
      const cx = W / 2;
      const R = 1, D = 3.4, camH = 0.1;
      const f = (halfW * D) / R;
      const rot = ts * 0.035 + (1 - ease(clamp(t / 4200))) * 0.6;
      const breathe = 1 + Math.sin(ts * 0.5) * 0.006;

      // project a point on the dome (theta: elevation, phi: azimuth). Writes into out arrays.
      const project = (theta: number, phi: number, i: number) => {
        const ct = Math.cos(theta);
        const x = R * ct * Math.cos(phi) * breathe;
        const y = R * Math.sin(theta) * breathe;
        const z = R * ct * Math.sin(phi);
        const zz = z + D;
        px[i] = cx + (f * x) / zz;
        py[i] = horizon - (f * (y - camH)) / zz;
        // reflection with a slow ripple that grows with depth below the surface
        const ryy = horizon + (f * (y + camH)) / zz;
        const depth = (ryy - horizon) / (H - horizon + 1);
        rx[i] = px[i] + Math.sin(ryy * 0.035 / dpr - ts * 1.7 + x * 3) * depth * 7 * dpr;
        ry[i] = ryy;
        pd[i] = clamp(0.5 - z / (2 * R)); // 1 = front, 0 = back
      };

      // ---- water + horizon
      const hz = ease(clamp(t / 1100));
      if (hz > 0) {
        const g = ctx.createLinearGradient(0, horizon, 0, H);
        g.addColorStop(0, "rgba(139,92,246,0.11)");
        g.addColorStop(0.35, "rgba(40,20,80,0.05)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.globalAlpha = hz;
        ctx.fillRect(0, horizon, W, H - horizon);
        ctx.globalAlpha = 1;
        const span = (W / 2) * hz;
        const lg = ctx.createLinearGradient(cx - span, 0, cx + span, 0);
        lg.addColorStop(0, "rgba(45,226,208,0)");
        lg.addColorStop(0.5, "rgba(124,243,255,0.55)");
        lg.addColorStop(1, "rgba(45,226,208,0)");
        ctx.fillStyle = lg;
        ctx.fillRect(cx - span, horizon - 0.5 * dpr, span * 2, 1 * dpr);
        // faint ripple lines on the water
        ctx.globalCompositeOperation = "lighter";
        for (let i = 1; i < 9; i++) {
          const yy = horizon + Math.pow(i / 9, 1.7) * (H - horizon);
          const len = W * (0.12 + 0.5 * (i / 9)) * hz;
          const off = Math.sin(ts * 0.4 + i * 1.7) * W * 0.04;
          const rg = ctx.createLinearGradient(cx - len + off, 0, cx + len + off, 0);
          rg.addColorStop(0, "rgba(139,92,246,0)");
          rg.addColorStop(0.5, `rgba(139,92,246,${0.06 * (1 - i / 10)})`);
          rg.addColorStop(1, "rgba(139,92,246,0)");
          ctx.fillStyle = rg;
          ctx.fillRect(cx - len + off, yy, len * 2, dpr);
        }
      }
      ctx.globalCompositeOperation = "lighter";

      // ---- motes (dust in the light)
      for (const m of motes) {
        m.y -= m.v * 0.016;
        if (m.y < -0.02) { m.y = 1.02; m.x = Math.random(); }
        const mx = (m.x + Math.sin(ts * 0.2 + m.a) * 0.01) * W;
        const my = m.y * horizon;
        const al = 0.25 * m.z * (0.5 + 0.5 * Math.sin(ts * 0.8 + m.a)) * hz;
        ctx.fillStyle = rgba(CYAN, al);
        ctx.fillRect(mx, my, 1.4 * dpr * m.z, 1.4 * dpr * m.z);
      }

      // ---- threads
      let allDone = true;
      const CH = 4; // samples per chunk (alpha bucketing)
      for (let ti = 0; ti < threads.length; ti++) {
        const th = threads[ti];
        const p = ease(clamp((t - th.delay) / th.dur));
        if (p < 1) allDone = false;
        if (p <= 0) continue;
        const sMax = Math.max(1, Math.round(p * S));
        for (let s = 0; s <= sMax; s++) {
          const theta = (s / S) * THETA_MAX;
          project(theta, th.phi0 + th.dir * TWIST * theta + rot, s);
        }
        // net (above) then reflection (below)
        for (let pass = 0; pass < 2; pass++) {
          const reflect = pass === 1;
          const X = reflect ? rx : px, Y = reflect ? ry : py;
          const col = reflect ? th.rcolor : th.color;
          const baseA = reflect ? 0.5 : 0.62;
          for (let c = 0; c < sMax; c += CH) {
            const e = Math.min(sMax, c + CH);
            const dm = pd[Math.min(e, (c + e) >> 1)];
            let al = baseA * (0.16 + 0.84 * dm * dm);
            if (reflect) al *= 1 - clamp((Y[e] - horizon) / (H - horizon)) * 0.65;
            ctx.beginPath();
            ctx.moveTo(X[c], Y[c]);
            for (let s = c + 1; s <= e; s++) ctx.lineTo(X[s], Y[s]);
            ctx.strokeStyle = rgba(col, al * 0.22);
            ctx.lineWidth = 3.2 * dpr;
            ctx.stroke();
            ctx.strokeStyle = rgba(col, al);
            ctx.lineWidth = 0.9 * dpr;
            ctx.stroke();
          }
          // comet head while weaving
          if (p < 1) {
            const hx = X[sMax], hy = Y[sMax];
            const r = 14 * dpr;
            const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, r);
            hg.addColorStop(0, rgba([255, 255, 255], reflect ? 0.35 : 0.9));
            hg.addColorStop(0.25, rgba(col, reflect ? 0.3 : 0.6));
            hg.addColorStop(1, rgba(col, 0));
            ctx.fillStyle = hg;
            ctx.fillRect(hx - r, hy - r, r * 2, r * 2);
          }
        }
      }

      // ---- base ring where the dome meets the water
      const ringP = ease(clamp((t - 200) / 1600));
      if (ringP > 0) {
        for (let pass = 0; pass < 2; pass++) {
          const reflect = pass === 1;
          ctx.beginPath();
          const M = 96;
          for (let i = 0; i <= M; i++) {
            const phi = (i / M) * Math.PI * 2 * ringP - Math.PI / 2;
            project(0, phi, 0);
            const X = reflect ? rx[0] : px[0], Y = reflect ? ry[0] : py[0];
            if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
          }
          ctx.strokeStyle = reflect ? rgba(MAGENTA, 0.22) : rgba(TEAL, 0.4);
          ctx.lineWidth = 1.2 * dpr;
          ctx.stroke();
        }
      }

      // ---- the knot at the apex
      const knotP = clamp((t - (WEAVE_START + WEAVE_SPREAD + WEAVE_DUR * 0.9)) / 900);
      if (knotP > 0) {
        project(Math.PI / 2, 0, 0);
        const kx = px[0], ky = py[0];
        const pulse = 0.75 + 0.25 * Math.sin(ts * 1.6);
        const r = (26 + 10 * pulse) * dpr * ease(knotP);
        const kg = ctx.createRadialGradient(kx, ky, 0, kx, ky, r);
        kg.addColorStop(0, `rgba(255,255,255,${0.85 * knotP})`);
        kg.addColorStop(0.18, rgba(CYAN, 0.55 * knotP));
        kg.addColorStop(1, rgba(TEAL, 0));
        ctx.fillStyle = kg;
        ctx.fillRect(kx - r, ky - r, r * 2, r * 2);
        // and its reflection
        const rky = ry[0];
        const rr = r * 0.8;
        const rkg = ctx.createRadialGradient(kx, rky, 0, kx, rky, rr);
        rkg.addColorStop(0, rgba(MAGENTA, 0.35 * knotP));
        rkg.addColorStop(1, rgba(VIOLET, 0));
        ctx.fillStyle = rkg;
        ctx.fillRect(kx - rr, rky - rr, rr * 2, rr * 2);
      }

      // ---- packets (live traffic)
      if (allDone) {
        if (!a.woven) {
          a.woven = true;
          onWovenRef.current?.();
        }
        // keep it alive with a little ambient traffic when the stream is quiet
        if (now - a.lastPulse > 2600 && Math.random() < 0.012) {
          a.pulses.push({ thread: Math.floor(Math.random() * N * 2), reflect: Math.random() < 0.3, t0: now, dur: 2200 });
          a.lastPulse = now - 1200;
        }
      }
      a.pulses = a.pulses.filter((pl) => now - pl.t0 < pl.dur);
      for (const pl of a.pulses) {
        const th = threads[pl.thread % threads.length];
        const q = ease(clamp((now - pl.t0) / pl.dur));
        const tail = 0.16;
        const steps = 10;
        const col = pl.reflect ? MAGENTA : CYAN;
        let hx = 0, hy = 0;
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
          const u = clamp(q - tail + (tail * i) / steps);
          const theta = u * THETA_MAX;
          project(theta, th.phi0 + th.dir * TWIST * theta + rot, 0);
          const X = pl.reflect ? rx[0] : px[0], Y = pl.reflect ? ry[0] : py[0];
          if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
          hx = X; hy = Y;
        }
        const fade = Math.sin(q * Math.PI);
        ctx.strokeStyle = rgba(col, 0.75 * fade);
        ctx.lineWidth = 1.8 * dpr;
        ctx.stroke();
        const r = 9 * dpr;
        const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, r);
        g.addColorStop(0, `rgba(255,255,255,${0.9 * fade})`);
        g.addColorStop(0.3, rgba(col, 0.6 * fade));
        g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.fillRect(hx - r, hy - r, r * 2, r * 2);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [instant]);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
