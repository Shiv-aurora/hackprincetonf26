"use client";
// 2D "insert" panels the film shows over its 3D stage: First Sight's nine signals and score, the file-copy
// dialog, the zoomed-in tracker document, the fingerprint card and the recovery copy (encrypt, cut and spread,
// split the key). Each is position-agnostic (the film places it), has a fixed width, and plays its own short
// choreography on mount (settled by ~3–6 s).
// Colour code: blue = real data, amber = attacker / suspicious, purple = decoy + trackers, green = safe.
// Reduced motion: every transition is instant, so each panel renders straight to its end state.
// Numbers come from the props (the recorded run); null props render the shapes without numbers.

import { useEffect, useState, type ReactNode } from "react";
import {
  AnimatePresence, animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform,
  type MotionValue, type Transition,
} from "framer-motion";
import { Database, DatabaseBackup } from "lucide-react";
import { cn } from "@/components/ui";
import { WORLD } from "@/lib/contracts";
import type { RunFacts } from "../story/useRunFacts";
import { Sharingan } from "./Sharingan";

// ------------------------------------------------------------------ shared bits

const EASE = [0.16, 1, 0.3, 1] as const;

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

// ------------------------------------------------------------------ 1. First Sight: nine signals, one score

export interface FirstSightGaugeProps { score: number | null; threshold: number | null; signals: string[] }

interface FsSignal { id: string; login: boolean; label: string; short: string; w: number; each?: boolean; match: RegExp }

// First Sight is a CUSUM test (Page, 1954) over nine weak signals: every signal seen adds its weight to a running
// score, every ordinary request takes DRIFT off, and the alarm goes at the limit. Signals, wording and weights
// from backend/mayajaal/real/firstsight.py (W, WHY; the weights are hand-set log-likelihood-ratio guesses).
// `match` finds a signal in the run's reason text, which is what the `signals` prop carries.
const FS_SIGNALS: FsSignal[] = [
  { id: "scripted_client", login: true, label: "Script, not the EHR app", short: "Script", w: 2.2, match: /script/i },
  { id: "no_client", login: true, label: "No client identity", short: "No ID", w: 1.0, match: /no client/i },
  { id: "new_address", login: true, label: "First login from this address", short: "Address", w: 0.8, match: /new address|from this address/i },
  { id: "failed_logins", login: true, label: "Wrong passwords just before", short: "Passwords", w: 0.6, each: true, match: /password/i },
  { id: "unmanaged_device", login: true, label: "Not a hospital device", short: "Device", w: 1.2, match: /device/i },
  { id: "machine_pace", login: false, label: "Machine-regular pace", short: "Pace", w: 0.9, match: /pace/i },
  { id: "burst", login: false, label: "Faster than a person can click", short: "Burst", w: 0.4, match: /faster|click/i },
  { id: "probing", login: false, label: "Asks for things that don't exist", short: "Probing", w: 0.7, match: /exist|probing/i },
  { id: "fan_out", login: false, label: "More charts than a nurse opens", short: "Charts", w: 0.5, each: true, match: /charts/i },
];
const FS_DRIFT = 0.3;
// The scan reaches a row every `step` s; a weight seen grows into the bar over `grow` s. Settled by ~3.5 s.
const T_FS = { scan: 1.3, step: 0.3, grow: 0.5 };
const FS_BAR_W = 412; // bar width in px (panel 560 − padding − the score column): decides which segment labels fit

export function FirstSightGauge(props: FirstSightGaugeProps) {
  // The scan (and its clock) starts once the run's score is known; until then the rows wait unchecked.
  return (
    <Panel width={560} label="First Sight">
      <FsBody key={props.score != null ? "run" : "wait"} {...props} />
    </Panel>
  );
}

function FsBody({ score, threshold, signals }: FirstSightGaugeProps) {
  const reduce = useReducedMotion();
  const tr = useTr();
  const ready = score != null;
  const isFired = (s: FsSignal) => signals.some((t) => s.match.test(t));
  // Caught at login unless a request signal is among the reasons. At login no request has been sent, so the
  // request rows are not checked: they are watched from the first request on (and in this run the script's
  // later pace would have tripped one, so "checked, not seen" would be false for them).
  const atLogin = !FS_SIGNALS.some((s) => !s.login && isFired(s)) && !signals.some((t) => /by request \d/i.test(t));
  const scanned = FS_SIGNALS.filter((s) => s.login || !atLogin);
  const at = (s: FsSignal) => T_FS.scan + scanned.indexOf(s) * T_FS.step;
  const decideAt = T_FS.scan + scanned.length * T_FS.step + 0.1;

  // The bar: the weights seen, stacked in list order. If they don't add up to the run's score, one plain bar.
  let segs = scanned.filter(isFired).map((s) => ({ id: s.id, short: s.short, w: s.w, at: at(s) }));
  if (score != null && Math.abs(segs.reduce((a, g) => a + g.w, 0) - score) > 0.05) {
    segs = score > 0 ? [{ id: "score", short: "Score", w: score, at: T_FS.scan }] : [];
  }
  const starts = segs.map((_, j) => segs.slice(0, j).reduce((a, g) => a + g.w, 0));
  const max = threshold != null
    ? Math.max(threshold * 2, score != null ? Math.ceil(score * 2.2) / 2 : 0)
    : Math.max(1, Math.ceil((score ?? 1) * 1.25));
  const plan = segs.map((g) => `${g.w}@${g.at}`).join(" ");

  // The score counts up as each weight lands: one keyframed animation, holds between the weights.
  const v = useMotionValue(0);
  const [crossedLive, setCrossed] = useState(false);
  useMotionValueEvent(v, "change", (x) => { if (threshold != null && x >= threshold) setCrossed(true); });
  useEffect(() => {
    if (score == null) return;
    if (reduce || !plan) { v.set(score); return; }
    const kf = [0], times = [0];
    let acc = 0;
    for (const part of plan.split(" ")) {
      const [w, t] = part.split("@").map(Number);
      kf.push(acc, acc + w);
      times.push(t, t + T_FS.grow);
      acc += w;
    }
    kf[kf.length - 1] = score;
    const total = times[times.length - 1];
    const c = animate(v, kf, { duration: total, times: times.map((t) => t / total), ease: "easeOut" });
    return () => c.stop();
  }, [score, plan, reduce, v]);
  const num = useTransform(v, (x) => x.toFixed(1));
  const over = score != null && threshold != null && score >= threshold;
  const crossed = over && (reduce ? true : crossedLive);
  const flagged = useAt(decideAt, over);
  const thPct = threshold != null ? `${(threshold / max) * 100}%` : null;

  return (
    <div className="px-7 pt-6 pb-6">
      <div className="flex items-center gap-4">
        <span className={cn("relative grid size-14 shrink-0 place-items-center rounded-xl border transition-colors duration-300 motion-reduce:transition-none",
          crossed ? "border-alert/50 bg-alert-bg text-alert" : "border-border bg-surface text-fg-muted")}>
          <motion.span className="grid place-items-center" initial={{ scaleY: 0.08, rotate: -360 }} animate={{ scaleY: 1, rotate: 0 }}
            transition={{ scaleY: tr(0.2, 0.4), rotate: tr(0.2, 1.1) }}>
            <Sharingan className="size-10" />
          </motion.span>
          {crossed && <Ring className="rounded-xl border-alert" />}
        </span>
        <div className="min-w-0">
          <p className="text-[25px] leading-none font-semibold tracking-[-0.03em]">First Sight</p>
          <p className="mt-2 text-[17px] leading-none text-fg-muted">Nine weak signals, added up</p>
        </div>
        {flagged && (
          <motion.span initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={tr(0, 0.3)}
            className="relative ml-auto inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-alert/45 bg-alert-bg px-3.5 py-2 text-[16px] leading-none font-semibold text-alert">
            <span className="size-2 rounded-full bg-alert" />
            {atLogin ? "Flagged at login" : "Flagged"}
            <Ring className="rounded-full border-alert" grow={[1.15, 1.6]} />
          </motion.span>
        )}
      </div>

      <div className="mt-5 flex flex-col">
        <FsGroupHead title="At login" />
        {FS_SIGNALS.filter((s) => s.login).map((s) => (
          <FsRow key={s.id} s={s} at={at(s)} check={ready && scanned.includes(s)} fired={isFired(s)} />
        ))}
        <FsGroupHead title="On each request" note={ready && atLogin ? "none sent yet" : undefined} className="mt-1.5" />
        {FS_SIGNALS.filter((s) => !s.login).map((s) => (
          <FsRow key={s.id} s={s} at={at(s)} check={ready && scanned.includes(s)} fired={isFired(s)} />
        ))}
      </div>

      <div className="mt-4 flex items-start gap-4 border-t border-border pt-5">
        <div className="min-w-0 flex-1">
          <div className="relative h-[30px]">
            <div className="absolute inset-0 rounded-md bg-surface-2" />
            {segs.map((g, j) => (
              <FsSeg key={g.id} v={v} start={starts[j]} w={g.w} max={max} first={j === 0}
                label={(g.w / max) * FS_BAR_W >= 118 ? `${g.short} +${g.w.toFixed(1)}` : (g.w / max) * FS_BAR_W >= 48 ? `+${g.w.toFixed(1)}` : ""} />
            ))}
            {thPct && <span aria-hidden className="absolute -top-[7px] -bottom-[7px] w-[3px] -translate-x-1/2 rounded-full bg-fg" style={{ left: thPct }} />}
          </div>
          <div className="relative mt-3 h-4">
            {thPct && threshold != null && (
              <span className="absolute -translate-x-1/2 text-[16px] leading-none whitespace-nowrap text-fg-muted tabular-nums" style={{ left: thPct }}>
                Limit {threshold.toFixed(1)}
              </span>
            )}
          </div>
        </div>
        <div className="-mt-[7px] flex w-[76px] shrink-0 flex-col items-end gap-1.5">
          <motion.span className={cn("text-[44px] leading-none font-semibold tracking-[-0.04em] tabular-nums transition-colors duration-300 motion-reduce:transition-none",
            crossed ? "text-alert" : ready ? "text-fg" : "text-fg-subtle")}>
            {ready ? num : "–"}
          </motion.span>
          <span className="text-[16px] leading-none text-fg-muted">score</span>
        </div>
      </div>

      <p className="mt-4 text-[16px] leading-snug text-fg-muted">
        A CUSUM test (Page, 1954). Each ordinary request takes {FS_DRIFT.toFixed(1)} off.
      </p>
    </div>
  );
}

function FsGroupHead({ title, note, className }: { title: string; note?: string; className?: string }) {
  return (
    <div className={cn("flex h-[26px] items-center justify-between px-3 text-[16px] leading-none", className)}>
      <span className="font-medium text-fg-muted">{title}</span>
      {note && <span className="text-fg-subtle">{note}</span>}
    </div>
  );
}

/** One signal: waits, is checked when the scan reaches it, and lights amber (with its weight) if it was seen. */
function FsRow({ s, at, check, fired }: { s: FsSignal; at: number; check: boolean; fired: boolean }) {
  const tr = useTr();
  const hit = useAt(at, check);
  const seen = hit && fired;
  return (
    <div className="relative grid h-[33px] grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-3 px-3">
      <motion.span aria-hidden className="absolute inset-0 rounded-lg border border-alert/45 bg-alert-bg"
        initial={{ opacity: 0 }} animate={{ opacity: seen ? 1 : 0 }} transition={tr(0, 0.25)} />
      {seen && <Ring className="rounded-lg border-alert" grow={[1.02, 1.55]} />}
      <FsMark state={seen ? "seen" : hit ? "clear" : "wait"} />
      <span className={cn("relative truncate text-[18px] leading-none transition-colors duration-200 motion-reduce:transition-none",
        seen ? "font-medium text-fg" : "text-fg-muted")}>
        {s.label}
      </span>
      <span className={cn("relative text-[17px] leading-none whitespace-nowrap tabular-nums transition-colors duration-200 motion-reduce:transition-none",
        seen ? "font-semibold text-alert" : "text-fg-subtle")}>
        +{s.w.toFixed(1)}{s.each && <span className="text-[16px]"> each</span>}
      </span>
    </div>
  );
}

/** Row marker: an empty ring (not checked), a grey tick (checked, not seen) or a filled amber "!" (seen). */
function FsMark({ state }: { state: "wait" | "clear" | "seen" }) {
  const tr = useTr();
  return (
    <span className={cn("relative grid size-[22px] place-items-center rounded-full border-[1.5px] transition-colors duration-200 motion-reduce:transition-none",
      state === "seen" ? "border-alert bg-alert text-background" : state === "clear" ? "border-fg-subtle text-fg-muted" : "border-border-strong")}>
      {state === "clear" && <Check className="size-[15px]" strokeWidth={2.8} />}
      {state === "seen" && (
        <motion.svg viewBox="0 0 20 20" fill="none" aria-hidden className="size-[15px]"
          initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={tr(0, 0.25)}>
          <path d="M10 3.6v8" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" />
          <circle cx="10" cy="16" r="2" fill="currentColor" />
        </motion.svg>
      )}
    </span>
  );
}

/** One weight in the score bar; grows with the score, so the stack always ends where the number is. */
function FsSeg({ v, start, w, max, first, label }: { v: MotionValue<number>; start: number; w: number; max: number; first: boolean; label: string }) {
  const width = useTransform(v, (x) => `${(Math.min(Math.max(x - start, 0), w) / max) * 100}%`);
  const opacity = useTransform(v, (x) => (x > start + 0.01 ? 1 : 0));
  const text = useTransform(v, (x) => (x >= start + w * 0.85 ? 1 : 0));
  return (
    <motion.div className={cn("absolute inset-y-0 overflow-hidden rounded-md bg-alert", !first && "border-l-2 border-background")}
      style={{ left: `${(start / max) * 100}%`, width, opacity }}>
      {label && (
        <motion.span className="absolute inset-0 grid place-items-center text-[16px] leading-none font-semibold whitespace-nowrap text-background tabular-nums"
          style={{ opacity: text }}>
          {label}
        </motion.span>
      )}
    </motion.div>
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

// ------------------------------------------------------------------ 5. Recovery copy: encrypt, cut and spread, split the key

export interface KeySplitProps {
  holders: string[];
  threshold: number | null;
  verified: boolean;
  /** The run's `vault.scattered` facts (`facts.scatter`): pieces, copies of each, size. Optional: without it the
   *  panel draws the backend's fixed layout (3 pieces, hospital i holds piece i mod 3) and shows no size. */
  scatter?: RunFacts["scatter"];
}

const HOSPITAL: Record<string, string> = {
  aur: "St. Aurelia", riv: "Riverside", nor: "Northgate", eas: "Eastbank", wes: "Westfield", lum: "Lumen Labs",
};
// Opaque tints, so a chip in flight never shows what is under it.
const OK_TINT = "bg-[color-mix(in_srgb,var(--ok)_16%,var(--background))]";
const OK_TINT_SOFT = "bg-[color-mix(in_srgb,var(--ok)_8%,var(--background))]";
// Stage geometry, px 1:1. Top row: the records, the encrypted copy (later cut into pieces) and its one-time key.
// Below, one card per hospital, three to a row. Card i holds piece i mod 3 (backend/mayajaal/real/scatter.py),
// so each column is one piece and the second row holds the second copy of every piece.
const KS = {
  w: 504, row: 64, gridY: 114, cols: 3, cardW: 160, cardH: 84, gapX: 12, gapY: 12,
  rec: { x: 0, w: 138 }, arrow: { x0: 146, x1: 198 }, block: { x: 206, w: 184, gap: 8 }, key: { x: 424, w: 80 },
  piece: { dx: 12, dy: 42, w: 62, h: 30 }, share: { dx: 84, dy: 42, w: 44, h: 30 },
};
// Choreography, s after mount (the film fades the panel in from ~0.9 s). Three beats; settled by ~6 s.
const T_KS = {
  enc: 1.1, made: 1.5,                                         // 1: arrow, then the locked copy and its key
  cut: 2.4, fly: 2.75, flyCol: 0.14, flyRow: 0.06, flyDur: 0.7, // 2: the copy is cut, each piece flies to 2 hospitals
  split: 4.0, shareStep: 0.07, shareDur: 0.65,                 // 3: the key splits, one share per hospital
  test: 5.15, testStep: 0.16, done: 5.65,                      // the rebuild the run did, from the second copies
};

export function KeySplit({ holders, threshold, verified, scatter }: KeySplitProps) {
  const live = holders.length > 0;
  return (
    <Panel width={560} label="Recovery copy">
      {/* Until the run is loaded the cards wait empty; the beats (and their clock) start once holders are known. */}
      <KsBody key={live ? "run" : "wait"} live={live} holders={live ? holders : WORLD.key_shares.holders}
        threshold={threshold} verified={verified} scatter={scatter ?? null} />
    </Panel>
  );
}

function KsBody({ live, holders, threshold, verified, scatter }: {
  live: boolean; holders: string[]; threshold: number | null; verified: boolean; scatter: RunFacts["scatter"];
}) {
  const tr = useTr();
  const n = holders.length;
  const pieces = Math.max(1, scatter?.pieces ?? 3);
  const copies = scatter?.replicas ?? Math.floor(n / pieces);
  const k = threshold != null && threshold > 0 && threshold <= n ? threshold : null;
  const rows = Math.max(1, Math.ceil(n / KS.cols));
  const stageH = KS.gridY + rows * KS.cardH + (rows - 1) * KS.gapY;
  const segW = (KS.block.w - (pieces - 1) * KS.block.gap) / pieces;
  const segX = (p: number) => KS.block.x + p * (segW + KS.block.gap);
  const card = (i: number) => ({ x: (i % KS.cols) * (KS.cardW + KS.gapX), y: KS.gridY + Math.floor(i / KS.cols) * (KS.cardH + KS.gapY) });
  // The run proved the copy by rebuilding it from the second copy of every piece (scatter.py: holders[3:6]).
  const tested = live && verified && n >= 2 * pieces ? Array.from({ length: pieces }, (_, j) => pieces + j) : [];
  const mb = scatter?.bytes ? `${(scatter.bytes / 1e6).toFixed(1)} MB` : null;
  const keyC = { x: KS.key.x + KS.key.w / 2, y: KS.row / 2 };

  const b1 = useAt(T_KS.enc, live);
  const made = useAt(T_KS.made, live);
  const b2 = useAt(T_KS.cut, live);
  const left = useAt(T_KS.fly + 0.3, live);      // the pieces have left the top row
  const b3 = useAt(T_KS.split, live);
  const split = useAt(T_KS.split + 0.3, live);   // nobody holds the key whole any more
  const done = useAt(T_KS.done, tested.length > 0);
  const foot = useAt(T_KS.done + 0.25, live);
  const arrowLen = KS.arrow.x1 - KS.arrow.x0;

  return (
    <div className="px-7 pt-6 pb-6">
      <div className="flex items-center gap-4">
        <span className="grid size-14 shrink-0 place-items-center rounded-xl border border-border bg-surface text-fg">
          <DatabaseBackup className="size-7" strokeWidth={1.9} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[25px] leading-none font-semibold tracking-[-0.03em]">Recovery copy</p>
          <p className="mt-2 text-[17px] leading-none text-fg-muted">Made the moment First Sight fired</p>
        </div>
      </div>

      <div className="relative mt-5" style={{ width: KS.w, height: stageH }}>
        {/* 1. The records, an arrow, the copy (whole and locked, then cut into numbered pieces), the key. */}
        <div className="absolute flex items-center gap-3 rounded-xl border border-focus/45 bg-focus/10 px-3.5"
          style={{ left: KS.rec.x, top: 0, width: KS.rec.w, height: KS.row }}>
          <Database className="size-7 shrink-0 text-focus" strokeWidth={1.9} aria-hidden />
          <span className="flex flex-col gap-1.5">
            <span className="text-[17px] leading-none font-semibold text-fg">Records</span>
            {mb && <span className="text-[16px] leading-none text-fg-muted tabular-nums">{mb}</span>}
          </span>
        </div>
        <svg className="absolute overflow-visible text-fg-subtle" style={{ left: KS.arrow.x0, top: KS.row / 2 - 8 }}
          width={arrowLen} height={16} viewBox={`0 0 ${arrowLen} 16`} fill="none" aria-hidden>
          <motion.path d={`M2 8H${arrowLen - 3}M${arrowLen - 9} 2.5L${arrowLen - 3} 8L${arrowLen - 9} 13.5`}
            stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"
            initial={{ pathLength: 0, opacity: 0 }} animate={b1 ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }} transition={tr(0, 0.35)} />
        </svg>
        {made && (
          <motion.div className={cn("absolute grid place-items-center rounded-xl border-2 border-ok/70 text-ok", OK_TINT)}
            style={{ left: KS.block.x, top: 0, width: KS.block.w, height: KS.row }}
            initial={{ opacity: 0, scale: 0.9 }} animate={b2 ? { opacity: 0, scale: 1 } : { opacity: 1, scale: 1 }} transition={tr(0, b2 ? 0.15 : 0.4)}>
            <span className="flex items-center gap-2.5">
              <LockGlyph className="size-6" closeAt={0.3} />
              <span className="text-[16px] leading-none font-semibold">AES-256-GCM</span>
            </span>
          </motion.div>
        )}
        {Array.from({ length: pieces }, (_, p) => {
          const shut = ((pieces - 1) / 2 - p) * KS.block.gap;   // the offset that closes the gaps: one block again
          return (
            <div key={p} className="absolute" style={{ left: segX(p), top: 0, width: segW, height: KS.row }}>
              <motion.span className="absolute inset-0 grid place-items-center rounded-lg border-2 border-dashed border-ok/40 text-[18px] leading-none font-semibold text-ok/50 tabular-nums"
                initial={{ opacity: 0 }} animate={{ opacity: left ? 1 : 0 }} transition={tr(0, 0.3)}>
                {p + 1}
              </motion.span>
              <motion.span className={cn("absolute inset-0 grid place-items-center rounded-lg border-2 border-ok/70 text-[20px] leading-none font-semibold text-ok tabular-nums", OK_TINT)}
                initial={{ opacity: 0, x: shut }} animate={b2 && !left ? { opacity: 1, x: 0 } : { opacity: 0, x: b2 ? 0 : shut }} transition={tr(0, 0.3)}>
                {p + 1}
              </motion.span>
            </div>
          );
        })}
        <div className="absolute" style={{ left: KS.key.x, top: 0, width: KS.key.w, height: KS.row }}>
          <motion.span className="absolute inset-0 grid place-items-center rounded-xl border-2 border-dashed border-border-strong text-fg-subtle"
            initial={{ opacity: 0 }} animate={{ opacity: split ? 1 : 0 }} transition={tr(0, 0.3)}>
            <KeyGlyph className="size-8 opacity-60" />
          </motion.span>
          <motion.span className="absolute inset-0 grid place-items-center rounded-xl border border-border-strong bg-surface text-fg"
            initial={{ opacity: 0, scale: 0.85 }} animate={made && !split ? { opacity: 1, scale: 1 } : { opacity: 0, scale: made ? 1 : 0.85 }}
            transition={tr(made && !split ? 0.15 : 0, 0.35)}>
            <KeyGlyph className="size-9" />
          </motion.span>
        </div>
        {made && (
          <>
            <motion.span className="absolute text-center text-[16px] leading-none text-fg-muted" style={{ left: KS.block.x, width: KS.block.w, top: KS.row + 12 }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(0.1, 0.3)}>
              Encrypted copy
            </motion.span>
            <motion.span key={split ? "shares" : "key"} className="absolute text-center text-[16px] leading-none whitespace-nowrap text-fg-muted tabular-nums"
              style={{ left: KS.key.x - 12, width: KS.key.w + 24, top: KS.row + 12 }}
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={tr(split ? 0 : 0.2, 0.3)}>
              {split ? `${n} shares` : "Key"}
            </motion.span>
          </>
        )}

        {/* 2 and 3. The hospitals; the pieces, then the key shares, fly into their slots. */}
        {holders.map((id, i) => {
          const c = card(i);
          const t = tested.indexOf(i);
          return <KsCard key={id} name={HOSPITAL[id] ?? id} x={c.x} y={c.y} lit={t >= 0} litAt={T_KS.test + Math.max(0, t) * T_KS.testStep} />;
        })}
        {live && holders.map((id, i) => {
          const c = card(i), p = i % pieces;
          const to = { x: c.x + KS.piece.dx + KS.piece.w / 2, y: c.y + KS.piece.dy + KS.piece.h / 2 };
          const delay = T_KS.fly + (i % KS.cols) * T_KS.flyCol + Math.floor(i / KS.cols) * T_KS.flyRow;
          return (
            <motion.span key={`piece-${id}`} aria-hidden className={cn("absolute flex items-center justify-center gap-1.5 rounded-md border border-ok/60 text-ok", OK_TINT)}
              style={{ left: c.x + KS.piece.dx, top: c.y + KS.piece.dy, width: KS.piece.w, height: KS.piece.h }}
              initial={{ x: segX(p) + segW / 2 - to.x, y: KS.row / 2 - to.y, opacity: 0, scale: 0.8 }}
              animate={{ x: 0, y: 0, opacity: 1, scale: 1 }}
              transition={{ ...tr(delay, T_KS.flyDur), opacity: tr(delay, 0.15) }}>
              <LockGlyph className="size-4" />
              <span className="text-[16px] leading-none font-semibold tabular-nums">{p + 1}</span>
            </motion.span>
          );
        })}
        {live && holders.map((id, i) => {
          const c = card(i);
          const to = { x: c.x + KS.share.dx + KS.share.w / 2, y: c.y + KS.share.dy + KS.share.h / 2 };
          const delay = T_KS.split + i * T_KS.shareStep;
          return (
            <motion.span key={`share-${id}`} aria-hidden className="absolute grid place-items-center rounded-md border border-border-strong bg-background text-fg"
              style={{ left: c.x + KS.share.dx, top: c.y + KS.share.dy, width: KS.share.w, height: KS.share.h }}
              initial={{ x: keyC.x - to.x, y: keyC.y - to.y, opacity: 0, scale: 0.8 }}
              animate={{ x: 0, y: 0, opacity: 1, scale: 1 }}
              transition={{ ...tr(delay, T_KS.shareDur), opacity: tr(delay, 0.15) }}>
              <KeyGlyph className="size-5" />
            </motion.span>
          );
        })}
      </div>

      <ol className="mt-5 flex flex-col gap-2 border-t border-border pt-4">
        <Beat n={1} on={b1} title="Encrypt" detail="AES-256-GCM, one-time key" />
        <Beat n={2} on={b2} title="Cut and spread" detail={copies > 0 ? `${pieces} pieces, each at ${copies} hospitals` : undefined} />
        <Beat n={3} on={b3} title="Split the key" detail={k != null ? `any ${k} of ${n} rebuild it` : undefined}
          right={done ? (
            <motion.span initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={tr(0, 0.35)}
              className="inline-flex items-center gap-1.5 rounded-full border border-ok/40 bg-ok/10 py-1.5 pr-3.5 pl-2.5 text-[16px] leading-none font-medium text-ok">
              <Check className="size-4" strokeWidth={3} delay={0.1} />
              Tested
            </motion.span>
          ) : undefined} />
      </ol>

      <motion.p initial={{ opacity: 0, y: 6 }} animate={foot ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }} transition={tr(0, 0.4)}
        className="mt-4 flex items-center gap-3 rounded-xl bg-surface px-4 py-3 text-[17px] leading-snug text-fg-muted">
        <LockGlyph className="size-5 text-fg" />
        <span><span className="font-semibold text-fg">One hospital breached?</span> It holds nothing readable.</span>
      </motion.p>
    </div>
  );
}

/** A hospital: its name and two empty slots (a piece, a key share). Turns green when the rebuild test uses it. */
function KsCard({ name, x, y, lit, litAt }: { name: string; x: number; y: number; lit: boolean; litAt: number }) {
  const tr = useTr();
  const on = useAt(litAt, lit);
  return (
    <div className={cn("absolute rounded-xl border transition-colors duration-300 motion-reduce:transition-none", on ? cn("border-ok/70", OK_TINT_SOFT) : "border-border bg-surface")}
      style={{ left: x, top: y, width: KS.cardW, height: KS.cardH }}>
      <span className="absolute top-3.5 left-3.5 text-[17px] leading-none font-medium whitespace-nowrap text-fg">{name}</span>
      <span className="absolute rounded-md border border-dashed border-border-strong" style={{ left: KS.piece.dx, top: KS.piece.dy, width: KS.piece.w, height: KS.piece.h }} />
      <span className="absolute rounded-md border border-dashed border-border-strong" style={{ left: KS.share.dx, top: KS.share.dy, width: KS.share.w, height: KS.share.h }} />
      {on && (
        <motion.span initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} transition={tr(0, 0.3)}
          className="absolute top-2.5 right-2.5 grid size-6 place-items-center rounded-full bg-ok text-background">
          <Check className="size-3.5" strokeWidth={3.4} delay={0.05} />
        </motion.span>
      )}
      {on && <Ring className="rounded-xl border-ok" grow={[1.08, 1.16]} />}
    </div>
  );
}

/** One numbered beat of the explainer; fades in when its beat starts. */
function Beat({ n, on, title, detail, right }: { n: number; on: boolean; title: string; detail?: string; right?: ReactNode }) {
  const tr = useTr();
  return (
    <motion.li initial={{ opacity: 0, x: -8 }} animate={on ? { opacity: 1, x: 0 } : { opacity: 0, x: -8 }} transition={tr(0, 0.35)}
      className="flex min-h-8 items-center gap-3">
      <span className="grid size-[26px] shrink-0 place-items-center rounded-full border border-border-strong text-[16px] leading-none font-semibold text-fg tabular-nums">{n}</span>
      <span className="min-w-0 text-[18px] leading-tight">
        <span className="font-semibold text-fg">{title}</span>
        {detail && <span className="text-fg-muted"> · {detail}</span>}
      </span>
      {right && <span className="ml-auto shrink-0">{right}</span>}
    </motion.li>
  );
}

/** Padlock; with `closeAt` the shackle drops shut that many seconds after mount. */
function LockGlyph({ className, closeAt }: { className?: string; closeAt?: number }) {
  const tr = useTr();
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={cn("shrink-0", className)}>
      <motion.path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"
        initial={{ y: closeAt != null ? -3.5 : 0 }} animate={{ y: 0 }} transition={tr(closeAt ?? 0, 0.25)} />
      <rect x="5" y="11" width="14" height="10" rx="2.2" stroke="currentColor" strokeWidth={2.2} />
    </svg>
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
