"use client";
// 2D "insert" panels the film shows over its 3D stage: the First Sight gauge, the file-copy dialog, the
// zoomed-in tracker document, the fingerprint card and the key split. Each is position-agnostic (the film
// places it), has a fixed width, and plays its own short choreography on mount (settled by ~3 s).
// Colour code: blue = real data, amber = attacker / suspicious, purple = decoy + trackers, green = safe.
// Reduced motion: every transition is instant, so each panel renders straight to its end state.
// Numbers come from the props (the recorded run); null props render the shapes without numbers.

import { useEffect, useState, type ReactNode } from "react";
import {
  AnimatePresence, animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform,
  type Transition,
} from "framer-motion";
import { cn } from "@/components/ui";
import type { RunFacts } from "../story/useRunFacts";

// ------------------------------------------------------------------ shared bits

const EASE = [0.16, 1, 0.3, 1] as const;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** Transition factory: instant under reduced motion. */
function useTr() {
  const reduce = useReducedMotion();
  return (delay = 0, duration = 0.45, extra?: Transition): Transition =>
    reduce ? { duration: 0 } : { duration, delay, ease: EASE, ...extra };
}

/** True `delay` seconds after mount (next tick under reduced motion). Drives colour switches. */
function useAt(delay: number, enabled = true): boolean {
  const reduce = useReducedMotion();
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const id = window.setTimeout(() => setOn(true), reduce ? 0 : delay * 1000);
    return () => window.clearTimeout(id);
  }, [delay, enabled, reduce]);
  return enabled && on;
}

/** The card every insert sits on: solid background, hairline border, a soft drop shadow for lift. */
function Panel({ width, label, className, children }: { width: number; label: string; className?: string; children: ReactNode }) {
  const tr = useTr();
  return (
    <motion.div role="group" aria-label={label}
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={tr(0, 0.4)}
      style={{ width }}
      className={cn("relative shrink-0 rounded-2xl border border-border-strong/80 bg-background text-left text-fg",
        "shadow-[0_30px_80px_-36px_rgba(0,0,0,0.65)]", className)}>
      {children}
    </motion.div>
  );
}

/** One expanding ring, played once when its parent becomes active. Mount it only once active. */
function Ring({ className, grow = [1.35, 1.35] }: { className?: string; grow?: readonly [number, number] }) {
  const reduce = useReducedMotion();
  return (
    <motion.span aria-hidden className={cn("pointer-events-none absolute -inset-px border-2", className)}
      initial={{ opacity: 0, scaleX: 1, scaleY: 1 }}
      animate={{ opacity: [0, 0.9, 0], scaleX: [1, 1, grow[0]], scaleY: [1, 1, grow[1]] }}
      transition={reduce ? { duration: 0 } : { duration: 0.85, times: [0, 0.1, 1], ease: "easeOut" }} />
  );
}

function Check({ className, delay = 0, strokeWidth = 2.6 }: { className?: string; delay?: number; strokeWidth?: number }) {
  const tr = useTr();
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className={cn("size-5 shrink-0", className)}>
      <motion.path d="M4.5 10.6l3.7 3.6 7.3-7.7" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={tr(delay, 0.35)} />
    </svg>
  );
}

const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");

// ------------------------------------------------------------------ 1. First Sight gauge

export interface FirstSightGaugeProps { score: number | null; threshold: number | null; signals: string[] }

// Semicircle gauge geometry (SVG drawn 1:1 in px).
const G = { w: 420, h: 250, cx: 210, cy: 226, r: 160, sw: 22 };
const G_ARC = `M ${G.cx - G.r} ${G.cy} A ${G.r} ${G.r} 0 0 1 ${G.cx + G.r} ${G.cy}`;
const G_LEN = Math.PI * G.r;
const G_SWEEP = { delay: 0.55, duration: 1.3 };
const G_SIGNALS = G_SWEEP.delay + G_SWEEP.duration + 0.1;

function onArc(f: number, r = G.r) {
  const a = Math.PI * (1 - Math.max(0, Math.min(1, f)));
  return { x: G.cx + r * Math.cos(a), y: G.cy - r * Math.sin(a) };
}

export function FirstSightGauge({ score, threshold, signals }: FirstSightGaugeProps) {
  const reduce = useReducedMotion();
  const tr = useTr();
  // Scale: the limit sits at the top of the arc (max = 2 × limit) unless the score needs more room.
  const max = threshold != null
    ? Math.max(threshold * 2, score != null ? Math.ceil(score * 2.2) / 2 : 0)
    : Math.max(1, Math.ceil((score ?? 1) * 1.25));
  const v = useMotionValue(0);
  const [crossed, setCrossed] = useState(false);
  const [landed, setLanded] = useState(false);
  useMotionValueEvent(v, "change", (x) => { if (threshold != null && x >= threshold) setCrossed(true); });
  useEffect(() => {
    if (score == null) return;
    const c = animate(v, score, reduce
      ? { duration: 0, onComplete: () => setLanded(true) }
      : { ...G_SWEEP, ease: easeOutCubic, onComplete: () => setLanded(true) });
    return () => c.stop();
  }, [score, reduce, v]);

  // Arc segments as explicit dash lengths along the semicircle (grey up to the limit, amber beyond it).
  const thF = threshold != null ? threshold / max : null;
  const lowDash = useTransform(v, (x) => `${(Math.min(x, threshold ?? x) / max) * G_LEN} ${G_LEN * 2}`);
  const lowOpacity = useTransform(v, (x) => (x > 0.001 ? 1 : 0));
  const highDash = useTransform(v, (x) => `${(threshold != null ? Math.max(0, x - threshold) / max : 0) * G_LEN} ${G_LEN * 2}`);
  const highOpacity = useTransform(v, (x) => (threshold != null && x > threshold + 0.001 ? 1 : 0));
  const knobX = useTransform(v, (x) => onArc(x / max).x);
  const knobY = useTransform(v, (x) => onArc(x / max).y);
  const num = useTransform(v, (x) => x.toFixed(1));
  const hot = crossed && score != null;
  const land = score != null ? onArc(score / max) : null;

  return (
    <Panel width={480} label="First Sight">
      <div className="px-7 pt-6 pb-7">
        <div className="flex items-center gap-4">
          <span className={cn("relative grid size-14 shrink-0 place-items-center rounded-xl border transition-colors duration-300 motion-reduce:transition-none",
            hot ? "border-alert/50 bg-alert-bg text-alert" : "border-border bg-surface text-fg-muted")}>
            <motion.span className="grid place-items-center" initial={{ scaleY: 0.08 }} animate={{ scaleY: 1 }} transition={tr(0.2, 0.4)}>
              <EyeGlyph />
            </motion.span>
            {hot && <Ring className="rounded-xl border-alert" />}
          </span>
          <div className="min-w-0">
            <p className="text-[25px] leading-none font-semibold tracking-[-0.03em]">First Sight</p>
            <p className="mt-2 text-[17px] leading-none text-fg-muted">Caught at login</p>
          </div>
        </div>

        <div className="relative mx-auto mt-4" style={{ width: G.w, height: G.h }}>
          <svg width={G.w} height={G.h} viewBox={`0 0 ${G.w} ${G.h}`} aria-hidden className="block overflow-visible">
            <path d={G_ARC} fill="none" strokeWidth={G.sw} strokeLinecap="round" className="stroke-surface-2" />
            <path d={G_ARC} fill="none" strokeWidth={G.sw} strokeLinecap="round" className="stroke-border" strokeOpacity={0.6} />
            <motion.path d={G_ARC} fill="none" strokeWidth={G.sw} strokeLinecap="round" className="stroke-fg-subtle"
              style={{ strokeDasharray: lowDash, opacity: lowOpacity }} />
            {thF != null && (
              <motion.path d={G_ARC} fill="none" strokeWidth={G.sw} strokeLinecap="round" className="stroke-alert"
                style={{ strokeDasharray: highDash, strokeDashoffset: -thF * G_LEN, opacity: highOpacity }} />
            )}
            {thF != null && threshold != null && (
              <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(0.3, 0.3)}>
                <ThresholdTick f={thF} label={`Limit ${threshold.toFixed(1)}`} />
              </motion.g>
            )}
            {score != null && (
              <motion.circle cx={knobX} cy={knobY} r={12} strokeWidth={5}
                className={cn("fill-background transition-[stroke] duration-300 motion-reduce:transition-none", hot ? "stroke-alert" : "stroke-fg-muted")} />
            )}
            {landed && land && hot && (
              <motion.circle cx={land.x} cy={land.y} fill="none" strokeWidth={3} className="stroke-alert"
                initial={{ r: 12, opacity: 0.9 }} animate={{ r: 44, opacity: 0 }} transition={tr(0, 0.9, { ease: "easeOut" })} />
            )}
          </svg>
          {score != null && (
            <div className="absolute inset-x-0 flex flex-col items-center" style={{ bottom: G.h - G.cy - 4 }}>
              <motion.span className={cn("text-[60px] leading-none font-semibold tracking-[-0.045em] tabular-nums transition-colors duration-300 motion-reduce:transition-none",
                hot ? "text-alert" : "text-fg")}>
                {num}
              </motion.span>
              <span className="mt-2 text-[17px] leading-none text-fg-muted">Risk score</span>
            </div>
          )}
        </div>

        {signals.length > 0 && (
          <div className="mt-5 flex flex-col items-start gap-2.5">
            {signals.map((s, i) => (
              <motion.span key={s} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={tr(G_SIGNALS + i * 0.3, 0.4)}
                className="inline-flex items-center gap-2.5 rounded-full border border-alert/40 bg-alert-bg py-2 pr-4.5 pl-3 text-[18px] leading-none font-medium text-alert">
                <Check delay={G_SIGNALS + i * 0.3 + 0.15} />
                {s}
              </motion.span>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function ThresholdTick({ f, label }: { f: number; label: string }) {
  const a = onArc(f, G.r - 18);
  const b = onArc(f, G.r + 18);
  const t = onArc(f, G.r + 34);
  const anchor = f < 0.42 ? "end" : f > 0.58 ? "start" : "middle";
  return (
    <>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={3.5} strokeLinecap="round" className="stroke-fg" />
      <text x={t.x} y={t.y + 4} textAnchor={anchor} className="fill-fg-muted text-[17px]">{label}</text>
    </>
  );
}

function EyeGlyph() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className="size-8">
      <path d="M2.5 16c3.6-6.4 8.1-9.6 13.5-9.6s9.9 3.2 13.5 9.6c-3.6 6.4-8.1 9.6-13.5 9.6S6.1 22.4 2.5 16Z"
        stroke="currentColor" strokeWidth={2.3} strokeLinejoin="round" />
      <circle cx="16" cy="16" r="5.4" fill="currentColor" />
      <circle cx="17.9" cy="14.1" r="1.7" className="fill-background" />
    </svg>
  );
}

// ------------------------------------------------------------------ 2. File-copy dialog

export interface CopyDialogProps { total: number | null; decoy: boolean }

const COPY = { delay: 0.35, duration: 2.6 };
// Flight of one paper from the folder's mouth to the laptop screen: a parabola sampled into keyframes.
const FLY = { x0: 60, y0: 40, dx: 358, dy: -4, lift: 64, steps: 13, dur: 1.15, gap: 0.23, papers: 5 };
const FLY_X = Array.from({ length: FLY.steps }, (_, k) => (FLY.dx * k) / (FLY.steps - 1));
const FLY_Y = Array.from({ length: FLY.steps }, (_, k) => { const t = k / (FLY.steps - 1); return -4 * FLY.lift * t * (1 - t) + FLY.dy * t; });
const FLY_R = Array.from({ length: FLY.steps }, (_, k) => -18 + (26 * k) / (FLY.steps - 1));
const FLY_S = Array.from({ length: FLY.steps }, (_, k) => { const t = k / (FLY.steps - 1); return 0.82 + 0.3 * Math.sin(Math.PI * t) - 0.12 * t; });
const FLY_O = FLY_X.map((_, k) => (k === 0 || k === FLY.steps - 1 ? 0 : 1));

export function CopyDialog({ total, decoy }: CopyDialogProps) {
  const reduce = useReducedMotion();
  const tr = useTr();
  // Mounted already showing the decoy: let the real label read for a beat, then flip. Prop flips later: flip now.
  const [decoyAtMount] = useState(decoy);
  const flipDelay = decoyAtMount ? 1.0 : 0;
  const purple = useAt(flipDelay + 0.32, decoy);

  const p = useMotionValue(0);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const c = animate(p, 1, reduce
      ? { duration: 0, onComplete: () => setDone(true) }
      : { delay: COPY.delay, duration: COPY.duration, ease: [0.4, 0.05, 0.6, 0.95], onComplete: () => setDone(true) });
    return () => c.stop();
  }, [p, reduce]);
  const count = useTransform(p, (x) => (total == null ? "" : fmtInt(x * total)));
  const pct = useTransform(p, (x) => `${Math.round(x * 100)}%`);
  const width = useTransform(p, (x) => `${x * 100}%`);
  const eta = useTransform(p, (x) => {
    const s = Math.ceil((1 - x) * COPY.duration);
    return s <= 0 ? "Finishing…" : `About ${s} second${s === 1 ? "" : "s"} remaining`;
  });

  return (
    <Panel width={560} label="File copy" className="overflow-hidden">
      {/* Title bar: it always looks like it's going fine. */}
      <div className="flex h-[58px] items-center gap-3 border-b border-border bg-surface px-5">
        <CopyGlyph />
        <AnimatePresence mode="wait">
          <motion.p key={done ? "done" : "copying"} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={tr(0, 0.22)} className="flex items-center gap-2 text-[19px] font-semibold tracking-[-0.02em]">
            {done && <Check className="text-fg" />}
            {done ? "Copy complete" : "Copying patient records…"}
          </motion.p>
        </AnimatePresence>
        <WindowControls />
      </div>

      <div className="px-7 pt-4 pb-7">
        <div className="relative h-[150px]" aria-hidden>
          <svg className="absolute inset-0" width="504" height="150" viewBox="0 0 504 150" fill="none">
            <motion.path d={`M ${FLY.x0 + 14} ${FLY.y0 + 18} Q ${FLY.x0 + 14 + FLY.dx / 2} ${FLY.y0 + 18 - 2 * FLY.lift + FLY.dy} ${FLY.x0 + 14 + FLY.dx} ${FLY.y0 + 18 + FLY.dy}`}
              strokeWidth={1.5} strokeDasharray="3 7" strokeLinecap="round" className="stroke-border-strong"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(0.3, 0.4)} />
          </svg>
          <div className="absolute top-[22px] left-[14px] flex w-[108px] flex-col items-center gap-1.5">
            <span className={cn("transition-colors duration-500 motion-reduce:transition-none", purple ? "text-shadow" : "text-focus")}>
              <FolderGlyph />
            </span>
            <motion.span key={purple ? "decoy" : "real"} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={tr(0, 0.3)}
              className={cn("text-[16px] leading-none font-medium", purple ? "text-shadow" : "text-focus")}>
              {purple ? "Decoy" : "Eastbank"}
            </motion.span>
          </div>
          <div className="absolute top-[14px] right-[6px] flex w-[132px] flex-col items-center gap-1.5 text-alert">
            <LaptopGlyph />
            <span className="text-[16px] leading-none font-medium">Attacker</span>
          </div>
          <AnimatePresence>
            {!done && Array.from({ length: FLY.papers }, (_, i) => (
              <motion.span key={i} className="absolute block" style={{ left: FLY.x0, top: FLY.y0 }}
                initial={{ x: 0, y: 0, opacity: 0, rotate: FLY_R[0], scale: FLY_S[0] }}
                animate={{ x: FLY_X, y: FLY_Y, rotate: FLY_R, scale: FLY_S, opacity: FLY_O }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
                transition={reduce ? { duration: 0 } : { duration: FLY.dur, ease: "linear", repeat: Infinity, delay: COPY.delay + i * FLY.gap }}>
                <Paper purple={purple} />
              </motion.span>
            ))}
          </AnimatePresence>
        </div>

        <div className="mt-4 flex items-baseline gap-2.5">
          {total != null && (
            <>
              <motion.span className="text-[42px] leading-none font-semibold tracking-[-0.04em] tabular-nums">{count}</motion.span>
              <span className="text-[18px] text-fg-muted tabular-nums">of {fmtInt(total)} records</span>
            </>
          )}
          <span className="ml-auto flex items-baseline gap-3">
            {decoy && done && purple && (
              <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={tr(0.1, 0.3)}
                className="self-center rounded-full border border-shadow/45 bg-shadow-bg px-3 py-1 text-[16px] leading-none font-medium text-shadow">
                All fake
              </motion.span>
            )}
            {total != null && <motion.span className="text-[18px] text-fg-muted tabular-nums">{pct}</motion.span>}
          </span>
        </div>
        <div className="relative mt-3 h-3.5 overflow-hidden rounded-full bg-surface-2">
          <motion.div className={cn("absolute inset-y-0 left-0 rounded-full transition-colors duration-500 motion-reduce:transition-none",
            purple ? "bg-shadow" : "bg-focus")} style={{ width }} />
        </div>
        <p className="mt-3 h-6 text-[17px] text-fg-muted tabular-nums">
          {done ? (total != null ? `All ${fmtInt(total)} copied` : "Done") : <motion.span>{eta}</motion.span>}
        </p>

        <div className="mt-4 border-t border-border pt-5">
          <SourceFlip decoy={decoy} delay={flipDelay} />
        </div>
      </div>
    </Panel>
  );
}

/** "From:" label that flips over (a short 3D turn) to reveal the decoy behind it. */
function SourceFlip({ decoy, delay }: { decoy: boolean; delay: number }) {
  const tr = useTr();
  const face = "col-start-1 row-start-1 inline-flex w-fit items-center gap-3 rounded-xl border px-4 py-2.5 text-[19px] leading-none [backface-visibility:hidden]";
  return (
    <div style={{ perspective: 900 }}>
      <motion.div className="grid justify-items-start" style={{ transformStyle: "preserve-3d" }}
        initial={{ rotateX: 0 }} animate={{ rotateX: decoy ? 180 : 0 }} transition={tr(delay, 0.7, { ease: [0.65, 0, 0.35, 1] })}>
        <span className={cn(face, "border-focus/40 bg-focus/10 text-fg")}>
          <span className="size-2.5 shrink-0 rounded-full bg-focus" />
          <span><span className="text-fg-muted">From:</span> <span className="font-semibold">Eastbank</span> · patient records</span>
        </span>
        <span className={cn(face, "border-shadow/50 bg-shadow-bg text-shadow")} style={{ transform: "rotateX(180deg)" }}>
          <span className="size-2.5 shrink-0 rounded-full bg-shadow" />
          <span>From: <span className="font-semibold">decoy</span> · built for this attacker</span>
        </span>
      </motion.div>
    </div>
  );
}

function Paper({ purple }: { purple: boolean }) {
  const line = cn("absolute left-[6px] h-[2.5px] rounded-full transition-colors duration-500 motion-reduce:transition-none", purple ? "bg-shadow" : "bg-focus");
  return (
    <span className={cn("relative block h-[36px] w-[28px] rounded-[5px] border bg-background transition-colors duration-500 motion-reduce:transition-none",
      purple ? "border-shadow/60" : "border-border-strong")}>
      <span className={cn(line, "top-[8px] w-[15px]")} />
      <span className={cn(line, "top-[14px] w-[11px] opacity-70")} />
      <span className={cn(line, "top-[20px] w-[15px] opacity-70")} />
      <span className={cn(line, "top-[26px] w-[9px] opacity-70")} />
    </span>
  );
}

function FolderGlyph() {
  return (
    <svg width="108" height="88" viewBox="0 0 108 88" fill="none" aria-hidden>
      <path d="M6 16a7 7 0 0 1 7-7h24.5l9 9H95a7 7 0 0 1 7 7v50a7 7 0 0 1-7 7H13a7 7 0 0 1-7-7Z"
        fill="currentColor" fillOpacity={0.2} stroke="currentColor" strokeWidth={2.2} strokeLinejoin="round" />
      <rect x="19" y="22" width="62" height="40" rx="3.5" className="fill-background" stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.6} />
      <rect x="27" y="16" width="62" height="40" rx="3.5" className="fill-background" stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.6} />
      <path d="M35 26h30M35 33h22M35 40h28" stroke="currentColor" strokeOpacity={0.6} strokeWidth={2.2} strokeLinecap="round" />
      <path d="M4 40a7 7 0 0 1 7-7h86a7 7 0 0 1 7 7v35a7 7 0 0 1-7 7H11a7 7 0 0 1-7-7Z" className="fill-background" />
      <path d="M4 40a7 7 0 0 1 7-7h86a7 7 0 0 1 7 7v35a7 7 0 0 1-7 7H11a7 7 0 0 1-7-7Z"
        fill="currentColor" fillOpacity={0.36} stroke="currentColor" strokeWidth={2.2} strokeLinejoin="round" />
    </svg>
  );
}

function LaptopGlyph() {
  return (
    <svg width="132" height="96" viewBox="0 0 132 96" fill="none" aria-hidden>
      <rect x="19" y="5" width="94" height="64" rx="7" className="fill-alert-bg" stroke="currentColor" strokeWidth={2.2} />
      <rect x="27" y="13" width="78" height="48" rx="3" stroke="currentColor" strokeOpacity={0.4} strokeWidth={1.5} />
      <path d="M66 22v19m-8-8 8 8 8-8M54 49h24" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 75h122l-7.5 12.2a4 4 0 0 1-3.4 1.8H15.9a4 4 0 0 1-3.4-1.8Z"
        fill="currentColor" fillOpacity={0.3} stroke="currentColor" strokeWidth={2.2} strokeLinejoin="round" />
      <path d="M56 75h20" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
    </svg>
  );
}

function CopyGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden className="shrink-0 text-fg-muted">
      <rect x="7.5" y="2.5" width="11.5" height="14" rx="2" stroke="currentColor" strokeWidth={1.7} />
      <path d="M14.5 19.5H5a2 2 0 0 1-2-2V7.5" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" />
    </svg>
  );
}

function WindowControls() {
  return (
    <span aria-hidden className="ml-auto flex items-center gap-5 text-fg-subtle">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7h10" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" /></svg>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2.5" y="2.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth={1.6} /></svg>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" /></svg>
    </span>
  );
}

// ------------------------------------------------------------------ 3. Tracker document

export interface TrackerDocProps { trackers: RunFacts["trackers"] }

type Tracker = RunFacts["trackers"][number];

const CALLOUT: Record<string, readonly [string, string]> = {
  mrn: ["Fake patient ID", "only theirs"],
  url: ["Link", "calls home when opened"],
  file: ["File", "unique to this session"],
  credential: ["Fake password", "alerts on use"],
};
const CALLOUT_OTHER = ["Fake key", "alerts on use"] as const;

// Decoy rows from the recorded run's exfil sample (web/public/runs/mayajaal.jsonl): generated by the decoy
// for this session, no real person behind any of them.
const DECOY_ROWS = [
  ["MRN-963524", "Cody Jefferson", "1946-10-30"],
  ["MRN-960708", "Paula Martinez", "1943-11-13"],
  ["MRN-540247", "Michele Evans", "2005-08-01"],
  ["MRN-174720", "Rebecca Morris", "1954-03-18"],
] as const;
// The planted patient. Its ID digits are taken from the tracker id; the name and birth date are illustrative.
const PLANTED = { name: "Alma Whitaker", born: "1971-04-09" };
// The decoy README's link format (backend shadow world: research-portal…/requests/q4-cohort?access=<token>).
const LINK = "research-portal.lum.meridian.local/…";

type DocLineData =
  | { t: "file"; dir: string; name: string; tracker?: Tracker }
  | { t: "thead" }
  | { t: "row"; cells: readonly string[]; tracker?: Tracker }
  | { t: "text"; text: string }
  | { t: "link"; label: string; value: string; tracker: Tracker }
  | { t: "secret"; label: string; tracker: Tracker };

const T_DOC = { group: 0.2, line0: 0.32, lineStep: 0.045, hl0: 1.05, hlStep: 0.5 };

function mrnFrom(id: string): string {
  const n = parseInt(id.split("-").pop() ?? "", 16);
  return `MRN-${String(Number.isFinite(n) ? n % 1_000_000 : 0).padStart(6, "0")}`;
}

function splitPath(where: string) {
  const parts = where.split("/").filter(Boolean);
  const name = parts.pop() ?? where;
  const dir = parts.length ? `${parts.length > 1 ? "…/" : "/"}${parts[parts.length - 1]}/` : "";
  return { dir, name };
}

function buildDoc(trackers: Tracker[]): { where: string; lines: DocLineData[] }[] {
  const groups = new Map<string, Tracker[]>();
  for (const t of trackers) groups.set(t.where, [...(groups.get(t.where) ?? []), t]);
  const weight = (ts: Tracker[]) => (ts.some((t) => t.kind === "mrn") ? 2 : 0) + (ts.some((t) => t.kind === "file") ? 1 : 0);
  return [...groups.entries()].sort(([, a], [, b]) => weight(b) - weight(a)).slice(0, 3).map(([where, ts]) => {
    const { dir, name } = splitPath(where);
    const of = (k: string) => ts.find((t) => t.kind === k);
    const lines: DocLineData[] = [{ t: "file", dir, name, tracker: of("file") }];
    const mrn = of("mrn");
    if (mrn || /\.(sql|csv)(\.gz)?$/i.test(name)) {
      lines.push({ t: "thead" });
      DECOY_ROWS.forEach((cells, i) => {
        if (i === 2 && mrn) lines.push({ t: "row", cells: [mrnFrom(mrn.id), PLANTED.name, PLANTED.born], tracker: mrn });
        lines.push({ t: "row", cells });
      });
    }
    const url = of("url");
    if (url) {
      lines.push({ t: "text", text: /research_cohort/i.test(where) ? "# Q4 research cohort · data access" : "# Read me" });
      lines.push({ t: "link", label: "Request access:", value: LINK, tracker: url });
    }
    for (const t of ts) {
      if (t.kind === "file" || t.kind === "mrn" || t.kind === "url") continue;
      lines.push({ t: "secret", label: t.kind === "credential" ? "password" : t.kind.replace(/_/g, " "), tracker: t });
    }
    return { where, lines };
  });
}

export function TrackerDoc({ trackers }: TrackerDocProps) {
  const tr = useTr();
  const groups = buildDoc(trackers);
  // Global line index (for the stagger) and highlight order (top to bottom, one by one).
  let line = 0;
  let hl = 0;
  const laid = groups.map((g) => ({
    ...g,
    lines: g.lines.map((l) => ({ l, appear: T_DOC.line0 + line++ * T_DOC.lineStep, order: "tracker" in l && l.tracker ? hl++ : -1 })),
  }));
  const n = trackers.length;

  return (
    <Panel width={780} label="Stolen file, zoomed in">
      <div className="flex items-center justify-between gap-4 px-7 pt-6">
        <span className="inline-flex items-center gap-2.5 rounded-full border border-shadow/45 bg-shadow-bg px-3.5 py-2 text-[17px] leading-none font-medium text-shadow">
          <span className="size-2 rounded-full bg-shadow" />
          Fake · generated for this session
        </span>
        {n > 0 && (
          <span className="text-[18px] text-fg-muted">
            <span className="font-semibold text-shadow tabular-nums">{n}</span> {n === 1 ? "tracker" : "trackers"} inside
          </span>
        )}
      </div>
      <div className="flex flex-col gap-4 px-7 pt-5 pb-7">
        {laid.length === 0 && (
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
            {[70, 92, 84, 88, 60].map((w, i) => <span key={i} className="h-4 rounded bg-surface-2" style={{ width: `${w}%` }} />)}
          </div>
        )}
        {laid.map((g, gi) => (
          <motion.section key={g.where} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={tr(T_DOC.group + gi * 0.12, 0.4)}
            className="rounded-xl border border-border bg-surface px-2 py-2">
            {g.lines.map(({ l, appear, order }, li) => (
              <DocLine key={li} line={l} appear={appear} at={order >= 0 ? T_DOC.hl0 + order * T_DOC.hlStep : null} divider={l.t === "file"} />
            ))}
          </motion.section>
        ))}
      </div>
    </Panel>
  );
}

function DocLine({ line, appear, at, divider }: { line: DocLineData; appear: number; at: number | null; divider: boolean }) {
  const tr = useTr();
  const tracker = "tracker" in line ? line.tracker : undefined;
  const lit = useAt(at ?? 0, at != null && tracker != null);
  return (
    <>
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={tr(appear, 0.35)}
        className={cn("relative grid grid-cols-[1fr_250px] items-center gap-5 rounded-lg px-3", tracker ? "min-h-[56px] py-2" : "min-h-[38px] py-1")}>
        {tracker && (
          <motion.span aria-hidden className="absolute inset-0 rounded-lg border border-shadow/45 bg-shadow-bg"
            initial={{ opacity: 0 }} animate={{ opacity: lit ? 1 : 0 }} transition={tr(0, 0.3)} />
        )}
        {tracker && lit && <Ring className="rounded-lg border-shadow" grow={[1.025, 1.45]} />}
        <div className="relative min-w-0">{renderLine(line, lit)}</div>
        <div className="relative">{tracker && <Callout tracker={tracker} lit={lit} />}</div>
      </motion.div>
      {divider && <div className="mx-3 my-1.5 h-px bg-border" />}
    </>
  );
}

const ROW_COLS = "grid grid-cols-[136px_1fr_112px] items-center gap-3";

function renderLine(line: DocLineData, lit: boolean): ReactNode {
  const hot = cn("transition-colors duration-300 motion-reduce:transition-none", lit ? "text-shadow" : "text-fg");
  switch (line.t) {
    case "file":
      return (
        <div className="flex items-center gap-3">
          <FileGlyph className={line.tracker ? hot : "text-fg-muted"} />
          <span className="truncate font-mono">
            <span className="text-[16px] text-fg-subtle">{line.dir}</span>
            <span className={cn("text-[18px] font-semibold", line.tracker ? hot : "text-fg")}>{line.name}</span>
          </span>
        </div>
      );
    case "thead":
      return (
        <div className={cn(ROW_COLS, "text-[16px] text-fg-subtle")}>
          <span>MRN</span><span>Name</span><span>Born</span>
        </div>
      );
    case "row":
      return (
        <div className={cn(ROW_COLS, "text-[17px]", line.tracker ? hot : "text-fg-muted")}>
          <span className={cn("font-mono", line.tracker && "font-semibold")}>{line.cells[0]}</span>
          <span className="truncate">{line.cells[1]}</span>
          <span className="font-mono">{line.cells[2]}</span>
        </div>
      );
    case "text":
      return <p className="truncate font-mono text-[16px] text-fg-subtle">{line.text}</p>;
    case "link":
      return (
        <p className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[16px] text-fg-muted">{line.label}</span>
          <span className={cn("truncate font-mono text-[17px] font-medium underline decoration-1 underline-offset-4", hot)}>{line.value}</span>
        </p>
      );
    case "secret":
      return (
        <p className={cn("truncate font-mono text-[17px]", hot)}>
          <span className="text-fg-muted">{line.label} = </span>
          <span className="font-semibold tracking-[0.12em]">••••••••••</span>
        </p>
      );
  }
}

function Callout({ tracker, lit }: { tracker: Tracker; lit: boolean }) {
  const tr = useTr();
  const [title, sub] = CALLOUT[tracker.kind] ?? CALLOUT_OTHER;
  return (
    <motion.div initial={{ opacity: 0, x: 14 }} animate={lit ? { opacity: 1, x: 0 } : { opacity: 0, x: 14 }} transition={tr(lit ? 0.1 : 0, 0.4)}
      className="flex items-start gap-2.5">
      <span className="mt-[7px] size-2 shrink-0 rounded-full bg-shadow" />
      <span className="flex flex-col gap-1">
        <span className="text-[18px] leading-tight font-semibold text-shadow">{title}</span>
        <span className="text-[16px] leading-tight text-fg-muted">{sub}</span>
      </span>
    </motion.div>
  );
}

function FileGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={cn("size-6 shrink-0", className)}>
      <path d="M6 2.75h8.5l4.75 4.75V20A1.25 1.25 0 0 1 18 21.25H6A1.25 1.25 0 0 1 4.75 20V4A1.25 1.25 0 0 1 6 2.75Z"
        stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round" />
      <path d="M14.25 3v4.5H19M8.5 12.5h7M8.5 16h5" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ------------------------------------------------------------------ 4. Fingerprint card

export interface FingerprintCardProps { facts: RunFacts | null }

const T_FP = { row0: 0.45, step: 0.3, tick: 0.42, footer: 2.45 };

export function FingerprintCard({ facts }: FingerprintCardProps) {
  const tr = useTr();
  const f = facts;
  // Sub-techniques whose parent is listed add nothing on a slide: keep the parents, at most three.
  const techniques = f
    ? f.techniques.filter((t) => !t.id.includes(".") || !f.techniques.some((p) => p.id === t.id.split(".")[0])).slice(0, 3)
    : [];
  const d = (i: number) => T_FP.row0 + i * T_FP.step;

  const rows: { label: string; value: ((delay: number) => ReactNode) | null }[] = [
    {
      label: "Address",
      value: f?.client.address
        ? (delay) => (f.client.address === "127.0.0.1"
          ? <Reveal delay={delay}>This laptop · demo <span className="ml-1 font-mono text-[16px] text-fg-subtle">127.0.0.1</span></Reveal>
          : <Typed text={f.client.address} delay={delay} className="font-mono" />)
        : null,
    },
    { label: "Tool", value: f?.client.software ? (delay) => <Typed text={f.client.software} delay={delay} className="font-mono" /> : null },
    {
      label: "Rhythm",
      value: f?.client.meanGapS != null
        ? (delay) => <Reveal delay={delay}>Every <span className="tabular-nums">{f.client.meanGapS!.toFixed(1)}</span> s · machine</Reveal>
        : null,
    },
    {
      label: "Stolen login",
      value: f?.login.user
        ? (delay) => <Reveal delay={delay}><span className="font-mono">{f.login.user}</span>{f.login.role && <span className="text-fg-muted"> · {f.login.role}</span>}</Reveal>
        : null,
    },
    {
      label: "Techniques",
      value: techniques.length
        ? (delay) => (
          <span className="flex flex-wrap gap-2">
            {techniques.map((t, j) => (
              <motion.span key={t.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={tr(delay + j * 0.09, 0.35)}
                className="rounded-md border border-border-strong bg-surface px-2.5 py-1 text-[16px] leading-snug text-fg">
                {t.name}
              </motion.span>
            ))}
          </span>
        )
        : null,
    },
    {
      label: "Trackers taken",
      value: f
        ? (delay) => (
          <Reveal delay={delay} className="flex items-baseline gap-2.5">
            <span className="text-[30px] leading-none font-semibold tracking-[-0.03em] text-shadow tabular-nums">{f.trackers.length}</span>
            <span className="text-[17px] text-fg-muted">in the stolen files</span>
          </Reveal>
        )
        : null,
    },
  ];

  return (
    <Panel width={560} label="Who is this?">
      <div className="px-7 pt-6 pb-7">
        <div className="flex items-center gap-4">
          <motion.span initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={tr(0.1, 0.4)}
            className="grid size-14 shrink-0 place-items-center rounded-xl border border-shadow/40 bg-shadow-bg text-shadow">
            <FingerprintGlyph />
          </motion.span>
          <div className="min-w-0">
            <p className="text-[27px] leading-none font-semibold tracking-[-0.035em]">Who is this?</p>
            <p className="mt-2 text-[17px] leading-none text-fg-muted">What it gave away</p>
          </div>
        </div>

        <div className="mt-5 flex flex-col">
          {rows.map((r, i) => (
            <motion.div key={r.label} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(d(i), 0.3)}
              className="grid min-h-[56px] grid-cols-[148px_1fr_28px] items-center gap-3 border-b border-border py-2.5 last:border-b-0">
              <span className="text-[17px] text-fg-muted">{r.label}</span>
              <span className="min-w-0 text-[20px] leading-snug text-fg">
                {r.value ? r.value(d(i) + 0.08) : <span className="block h-5 w-40 rounded bg-surface-2" />}
              </span>
              {r.value ? (
                <motion.span initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} transition={tr(d(i) + T_FP.tick, 0.3)}
                  className="grid size-7 place-items-center rounded-full bg-shadow-bg text-shadow">
                  <Check className="size-4" delay={d(i) + T_FP.tick + 0.05} strokeWidth={3} />
                </motion.span>
              ) : <span />}
            </motion.div>
          ))}
        </div>

        <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={tr(T_FP.footer, 0.45)}
          className="mt-5 rounded-xl bg-surface px-5 py-4 text-[19px] leading-snug text-fg-muted">
          <span className="font-semibold text-fg">We don&apos;t block it.</span> Blocked, it tries another door.
        </motion.p>
      </div>
    </Panel>
  );
}

function Reveal({ delay, className, children }: { delay: number; className?: string; children: ReactNode }) {
  const tr = useTr();
  return (
    <motion.span initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={tr(delay, 0.35)} className={cn("inline-block", className)}>
      {children}
    </motion.span>
  );
}

/** Types `text` in, a character at a time (instant under reduced motion). */
function Typed({ text, delay, className }: { text: string; delay: number; className?: string }) {
  const reduce = useReducedMotion();
  const n = useMotionValue(0);
  const shown = useTransform(n, (x) => text.slice(0, Math.round(x)));
  useEffect(() => {
    const c = animate(n, text.length, reduce ? { duration: 0 } : { delay, duration: Math.min(0.55, 0.028 * text.length), ease: "linear" });
    return () => c.stop();
  }, [n, text, delay, reduce]);
  return <motion.span className={className}>{shown}</motion.span>;
}

function FingerprintGlyph() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className="size-8" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M7.2 9.6A11 11 0 0 1 26.4 11" />
      <path d="M5.4 15.2c.1-.9.3-1.7.6-2.5" />
      <path d="M9.5 26.6c1.4-2.6 2.1-5.5 2.1-8.6a4.4 4.4 0 0 1 8.8 0c0 1.6-.1 3.2-.4 4.7" />
      <path d="M8.3 21.9c.6-1.3.8-2.6.8-4a6.9 6.9 0 0 1 11.6-5.1" />
      <path d="M16 18c0 3.9-.9 7.4-2.6 10.2" />
      <path d="M19.4 26.9c.4-.9.8-1.9 1.1-2.9" />
      <path d="M23.4 15.5c.3.8.4 1.6.4 2.5 0 2.6-.3 5-1 7.3" />
      <path d="M26.7 17.5v.5c0 1.7-.1 3.3-.4 4.8" />
    </svg>
  );
}

// ------------------------------------------------------------------ 5. Key split

export interface KeySplitProps { holders: string[]; threshold: number | null; verified: boolean }

const HOSPITAL: Record<string, string> = {
  aur: "St. Aurelia", riv: "Riverside", nor: "Northgate", eas: "Eastbank", wes: "Westfield", lum: "Lumen",
};
const KS = { w: 504, h: 330, cx: 252, cy: 165, rx: 186, ry: 128, inward: 0.1 };
// Opaque tints, so the joining lines never show through a chip.
const OK_TINT = "bg-[color-mix(in_srgb,var(--ok)_16%,var(--background))]";
const T_KS = { key: 0.1, split: 0.75, fly: 0.6, flyStep: 0.07, lit: 1.65, litStep: 0.2, rebuilt: 2.3, tested: 2.65 };

/** `k` holder indices spread evenly round the ring (6 and 3 → 0, 2, 4). */
function spread(n: number, k: number): number[] {
  return Array.from({ length: k }, (_, j) => Math.round((j * n) / k));
}

export function KeySplit({ holders, threshold, verified }: KeySplitProps) {
  const tr = useTr();
  const n = holders.length;
  const k = threshold != null && threshold > 0 && threshold <= n ? threshold : null;
  const chosen = k != null ? spread(n, k) : [];
  const split = useAt(T_KS.split, n > 0);
  const rebuilt = useAt(T_KS.rebuilt, k != null);
  const tested = useAt(T_KS.tested, k != null && verified);
  const pos = holders.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, n);
    return { x: KS.cx + KS.rx * Math.cos(a), y: KS.cy + KS.ry * Math.sin(a) };
  });

  return (
    <Panel width={560} label="Key split">
      <div className="px-7 pt-6 pb-7">
        <div className="flex items-center gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-xl border border-border bg-surface text-fg">
            <KeyGlyph className="size-8" />
          </span>
          <div className="min-w-0">
            <p className="text-[25px] leading-none font-semibold tracking-[-0.03em]">Recovery key, split</p>
            <p className="mt-2 text-[17px] leading-none text-fg-muted">Nobody holds it whole</p>
          </div>
        </div>

        <div className="relative mx-auto mt-3" style={{ width: KS.w, height: KS.h }}>
          {/* Faint ring the pieces sit on, and the lines that join the chosen ones back to the key. */}
          <svg className="absolute inset-0" width={KS.w} height={KS.h} viewBox={`0 0 ${KS.w} ${KS.h}`} fill="none" aria-hidden>
            <motion.ellipse cx={KS.cx} cy={KS.cy} rx={KS.rx} ry={KS.ry} strokeWidth={1.5} strokeDasharray="2 8" strokeLinecap="round"
              className="stroke-border-strong" initial={{ opacity: 0 }} animate={{ opacity: split ? 1 : 0 }} transition={tr(0.2, 0.5)} />
            {chosen.map((i, j) => {
              const p = pos[i];
              const q = { x: p.x + (KS.cx - p.x) * KS.inward, y: p.y + (KS.cy - p.y) * KS.inward };
              return (
                <motion.line key={i} x1={q.x} y1={q.y} x2={KS.cx} y2={KS.cy} strokeWidth={2.5} strokeLinecap="round" className="stroke-ok"
                  initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 0.75 }}
                  transition={tr(T_KS.lit + j * T_KS.litStep + 0.12, 0.45)} />
              );
            })}
          </svg>

          {holders.map((id, i) => (
            <ShareChip key={id} id={id} i={i} x={pos[i].x} y={pos[i].y} chosen={chosen.indexOf(i)} dim={rebuilt && !chosen.includes(i)} />
          ))}

          <div className="absolute" style={{ left: KS.cx, top: KS.cy, transform: "translate(-50%, -50%)" }}>
            <motion.div initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={tr(T_KS.key, 0.45)}
              className={cn("relative grid size-[88px] place-items-center rounded-2xl border-2 transition-colors duration-300 motion-reduce:transition-none",
                rebuilt ? cn("border-ok text-ok", OK_TINT)
                  : split ? "border-dashed border-border-strong bg-background text-fg-subtle"
                    : "border-border-strong bg-surface-2 text-fg")}>
              <KeyGlyph className="size-12" />
              {rebuilt && <Ring className="rounded-2xl border-ok" />}
              {rebuilt && (
                <motion.span initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} transition={tr(0.05, 0.3)}
                  className="absolute -right-2.5 -bottom-2.5 grid size-8 place-items-center rounded-full border-2 border-background bg-ok text-background">
                  <Check className="size-4" strokeWidth={3.2} />
                </motion.span>
              )}
            </motion.div>
          </div>
        </div>

        <div className="mt-3 flex min-h-[44px] items-center justify-between gap-4 border-t border-border pt-5">
          {k != null ? (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(T_KS.rebuilt, 0.4)} className="text-[20px] text-fg-muted">
              Any <span className="font-semibold text-fg tabular-nums">{k}</span> of <span className="font-semibold text-fg tabular-nums">{n}</span> rebuild it
            </motion.p>
          ) : <span />}
          {k != null && verified && (
            <motion.span initial={{ opacity: 0, y: 6 }} animate={tested ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }} transition={tr(0, 0.35)}
              className="inline-flex items-center gap-2 rounded-full border border-ok/40 bg-ok/10 py-1.5 pr-4 pl-3 text-[17px] leading-none font-medium text-ok">
              <Check className="size-[18px]" strokeWidth={3} delay={0.1} />
              Rebuild tested
            </motion.span>
          )}
        </div>
      </div>
    </Panel>
  );
}

function ShareChip({ id, i, x, y, chosen, dim }: { id: string; i: number; x: number; y: number; chosen: number; dim: boolean }) {
  const tr = useTr();
  const lit = useAt(T_KS.lit + Math.max(0, chosen) * T_KS.litStep, chosen >= 0);
  const home = lit ? { x: (KS.cx - x) * KS.inward, y: (KS.cy - y) * KS.inward } : { x: 0, y: 0 };
  return (
    <div className="absolute" style={{ left: x, top: y, transform: "translate(-50%, -50%)" }}>
      <motion.div initial={{ x: KS.cx - x, y: KS.cy - y, opacity: 0, scale: 0.4 }}
        animate={{ ...home, opacity: dim ? 0.4 : 1, scale: 1 }}
        transition={lit || dim ? tr(0, 0.5) : tr(T_KS.split + i * T_KS.flyStep, T_KS.fly)}
        className={cn("relative flex items-center gap-2 rounded-xl border px-3.5 py-2 text-[17px] leading-none font-medium whitespace-nowrap transition-colors duration-300 motion-reduce:transition-none",
          lit ? cn("border-ok/60 text-ok", OK_TINT) : "border-border-strong bg-surface text-fg")}>
        <KeyGlyph className={cn("size-[18px]", lit ? "text-ok" : "text-fg-subtle")} />
        {HOSPITAL[id] ?? id}
        {lit && <Ring className="rounded-xl border-ok" grow={[1.2, 1.5]} />}
      </motion.div>
    </div>
  );
}

function KeyGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={cn("shrink-0", className)}>
      <circle cx="10.5" cy="16" r="6.25" stroke="currentColor" strokeWidth={2.5} />
      <circle cx="10.5" cy="16" r="1.6" fill="currentColor" />
      <path d="M16.75 16H29M24.5 16v5M28.5 16v3.6" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
