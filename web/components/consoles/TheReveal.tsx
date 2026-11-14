"use client";
// THE REVEAL — the money moment. The attacker's "stolen" table dissolves glyph by glyph into Maya.
//
//   <TheReveal />                         auto-fires on a fresh `reveal` event
//   <TheReveal replayKey={n} />           bump n to replay
//   const r = useRevealTrigger();         drive it yourself: <TheReveal auto={false} replayKey={r.key} />

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SkipForward } from "lucide-react";
import type { EventDataMap, MJEvent } from "@/lib/contracts";
import { useMJ, useMJEvent } from "@/lib/events";
import { GLIDE, RunBadge, attackerSessionOf, cn, formatBytes, hospitalShort } from "./ui";

export type RevealPhase = "stolen" | "dissolve" | "stamp" | "ledger" | "out";

// ------------------------------------------------------------------ trigger

export interface RevealTriggerOptions {
  /** Listen for live `reveal` events (default true). */
  enabled?: boolean;
  /** Ignore reveal events older than this (hub backlog on reconnect). Default 20 s. */
  freshMs?: number;
}

/** Opens when a fresh `reveal` event arrives. `key` increments on every (re)trigger. */
export function useRevealTrigger({ enabled = true, freshMs = 20_000 }: RevealTriggerOptions = {}) {
  const [state, setState] = useState({ open: false, key: 0 });
  const onEvent = useCallback(
    (ev: MJEvent) => {
      if (!enabled || ev.type !== "reveal") return;
      if (Math.abs(Date.now() - ev.ts) > freshMs) return;
      setState((s) => ({ open: true, key: s.key + 1 }));
    },
    [enabled, freshMs],
  );
  useMJEvent(onEvent);
  const trigger = useCallback(() => setState((s) => ({ open: true, key: s.key + 1 })), []);
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), []);
  return { open: state.open, key: state.key, trigger, close };
}

// ------------------------------------------------------------------ component

export interface TheRevealProps {
  /** Fire automatically on a fresh `reveal` event (default true). */
  auto?: boolean;
  /** Change this value to (re)play the sequence on demand. */
  replayKey?: number;
  /** Called when the sequence ends (finished or skipped through). */
  onDone?: () => void;
  /** Called on each phase change — sync sound (sub-bass on "dissolve", hit on "stamp"). */
  onPhase?: (phase: RevealPhase) => void;
  /** How long the final ledger holds before fading out (ms). Default 3600. `Infinity` = hold until skipped. */
  holdMs?: number;
}

export function TheReveal({ auto = true, replayKey, onDone, onPhase, holdMs = 3600 }: TheRevealProps) {
  const { open, key, trigger, close } = useRevealTrigger({ enabled: auto });
  const lastReplay = useRef(replayKey);
  useEffect(() => {
    if (replayKey === lastReplay.current) return;
    lastReplay.current = replayKey;
    trigger();
  }, [replayKey, trigger]);

  const finish = useCallback(() => {
    close();
    onDone?.();
  }, [close, onDone]);

  return (
    <AnimatePresence>
      {open && <RevealSequence key={key} onFinish={finish} onPhase={onPhase} holdMs={holdMs} />}
    </AnimatePresence>
  );
}

// ------------------------------------------------------------------ sequence

const T_DISSOLVE = 2600;
const T_STAMP = 4300;
const T_LEDGER = 5700;
const DISSOLVE_TOTAL = 2100;

interface Snapshot {
  exfil: EventDataMap["exfil"] | null;
  claim: string | null;
  reveal: EventDataMap["reveal"] | null;
  canary: { leaked: number; total: number };
  touched: number;
  label: string;
  session: string;
}

function takeSnapshot(): Snapshot {
  const { view, events } = useMJ.getState();
  const sess = attackerSessionOf(events);
  return {
    exfil: view.exfil,
    claim: view.claim,
    reveal: view.reveal,
    canary: view.canary,
    touched: view.reveal?.honeytokens_touched ?? view.honeytokensTouched.length,
    label: view.run?.attacker_label ?? "attacker",
    session: view.reveal?.shadow_session ?? (sess ? sess.replace(/^sess-/, "") : "—"),
  };
}

function RevealSequence({ onFinish, onPhase, holdMs }: { onFinish: () => void; onPhase?: (p: RevealPhase) => void; holdMs: number }) {
  const [snap] = useState(takeSnapshot);
  const [phase, setPhase] = useState<RevealPhase>("stolen");
  const phaseRef = useRef(phase);
  const finishRef = useRef(onFinish);
  const phaseCb = useRef(onPhase);
  useEffect(() => { finishRef.current = onFinish; phaseCb.current = onPhase; });

  useEffect(() => {
    phaseRef.current = phase;
    phaseCb.current?.(phase);
  }, [phase]);

  // scripted timeline
  useEffect(() => {
    const ts = [
      setTimeout(() => setPhase((p) => (p === "stolen" ? "dissolve" : p)), T_DISSOLVE),
      setTimeout(() => setPhase((p) => (p === "dissolve" ? "stamp" : p)), T_STAMP),
      setTimeout(() => setPhase((p) => (p === "stamp" ? "ledger" : p)), T_LEDGER),
    ];
    return () => ts.forEach(clearTimeout);
  }, []);

  // ledger hold → out
  useEffect(() => {
    if (phase !== "ledger" || !Number.isFinite(holdMs)) return;
    const t = setTimeout(() => finishRef.current(), holdMs);
    return () => clearTimeout(t);
  }, [phase, holdMs]);

  const skip = useCallback(() => {
    if (phaseRef.current === "ledger") finishRef.current();
    else setPhase("ledger");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === " " || e.key === "Enter" || e.key === "ArrowRight") {
        e.preventDefault();
        skip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [skip]);

  // nothing to reveal (shouldn't happen) → bail
  useEffect(() => {
    if (!snap.exfil && !snap.reveal) finishRef.current();
  }, [snap]);

  const dissolving = phase !== "stolen";
  const t = useDissolveClock(dissolving, phase === "ledger");
  const atLeast = (p: RevealPhase) => ORDER.indexOf(phase) >= ORDER.indexOf(p);

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex cursor-pointer flex-col overflow-hidden text-fg select-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, filter: "blur(6px)" }}
      transition={{ duration: 0.7, ease: GLIDE }}
      onClick={skip}
      role="dialog"
      aria-label="The Reveal"
    >
      {/* backdrop */}
      <div className="absolute inset-0 bg-ink/[0.97] backdrop-blur-2xl" />
      <motion.div
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse 70% 55% at 50% 52%, rgba(178,107,255,0.22), rgba(255,79,216,0.06) 45%, transparent 75%)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: dissolving ? 1 : 0 }}
        transition={{ duration: 1.6, ease: GLIDE }}
      />
      <motion.div
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse 60% 50% at 50% 50%, rgba(45,226,230,0.10), transparent 70%)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: atLeast("ledger") ? 1 : 0 }}
        transition={{ duration: 1.4, ease: GLIDE }}
      />
      <Grain />

      {/* stamp flash */}
      <AnimatePresence>
        {phase === "stamp" && (
          <motion.div
            key="flash"
            className="pointer-events-none absolute inset-0 bg-shadow-hot mix-blend-screen"
            initial={{ opacity: 0.22 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>

      {/* letterbox */}
      <motion.div
        className="relative z-10 flex h-[8vh] min-h-[52px] shrink-0 items-center justify-between bg-black px-[4vw]"
        initial={{ y: "-100%" }}
        animate={{ y: 0 }}
        transition={{ duration: 0.9, ease: GLIDE }}
      >
        <span className="text-[11px] font-medium uppercase tracking-[0.4em] text-fg-faint">
          Maya<span className="text-shadow">Jaal</span> <span className="mx-2 text-line">/</span> The Reveal
        </span>
        <RunBadge />
      </motion.div>

      {/* stage */}
      <div className="relative z-10 grid min-h-0 flex-1 place-items-center px-[5vw]">
        {/* A — what the attacker believes */}
        <motion.div
          className="relative col-start-1 row-start-1 w-full max-w-[1180px]"
          animate={atLeast("ledger") ? { opacity: 0, scale: 0.94, filter: "blur(10px)", y: -20 } : { opacity: 1, scale: 1, filter: "blur(0px)", y: 0 }}
          transition={{ duration: 1.1, ease: GLIDE }}
        >
          <Stolen snap={snap} t={t} dissolving={dissolving} />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <AnimatePresence>{atLeast("stamp") && <Stamp session={snap.session} realBytes={snap.reveal?.real_bytes ?? 0} />}</AnimatePresence>
          </div>
        </motion.div>

        {/* C — the ledger */}
        <AnimatePresence>
          {atLeast("ledger") && <Ledger snap={snap} />}
        </AnimatePresence>
      </div>

      {/* bottom letterbox */}
      <motion.div
        className="relative z-10 flex h-[8vh] min-h-[52px] shrink-0 items-center justify-between gap-6 bg-black px-[4vw]"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        transition={{ duration: 0.9, ease: GLIDE }}
      >
        <div className="flex flex-1 items-center gap-3">
          {(["stolen", "dissolve", "stamp", "ledger"] as RevealPhase[]).map((p) => (
            <div key={p} className="flex items-center gap-2">
              <span className={cn("h-px w-10 transition-colors duration-700", atLeast(p) ? (p === "ledger" ? "bg-real" : "bg-shadow") : "bg-line")} />
              <span className={cn("text-[10px] uppercase tracking-[0.25em] transition-colors duration-700", phase === p ? "text-fg" : "text-fg-faint")}>
                {PHASE_LABEL[p]}
              </span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); skip(); }}
          className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[11px] tracking-[0.18em] text-fg-dim uppercase transition-colors hover:border-fg-faint hover:text-fg"
        >
          {phase === "ledger" ? "Close" : "Skip"} <SkipForward className="size-3" />
        </button>
      </motion.div>
    </motion.div>
  );
}

const ORDER: RevealPhase[] = ["stolen", "dissolve", "stamp", "ledger", "out"];
const PHASE_LABEL: Record<RevealPhase, string> = {
  stolen: "What it stole", dissolve: "What it got", stamp: "Maya", ledger: "Ledger", out: "",
};

// ------------------------------------------------------------------ A. the stolen table

function Stolen({ snap, t, dissolving }: { snap: Snapshot; t: number; dissolving: boolean }) {
  const ex = snap.exfil;
  const rows = (ex?.sample ?? []).slice(0, 6);
  const cols: { key: keyof EventDataMap["exfil"]["sample"][number]; label: string }[] = [
    { key: "mrn", label: "MRN" },
    { key: "name", label: "Name" },
    { key: "dob", label: "DOB" },
    { key: "hospital_id", label: "Hospital" },
    { key: "detail", label: "Detail" },
  ];
  const recordCount = (ex?.records ?? snap.reveal?.records_faked ?? 0).toLocaleString("en-US");

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.25, ease: GLIDE }}
        className="flex items-center gap-3 text-[12px] font-medium uppercase tracking-[0.32em] text-fg-dim"
      >
        <span className="size-1.5 rounded-full bg-ok shadow-[0_0_10px_var(--ok)]" />
        Attacker&apos;s view &nbsp;·&nbsp; what the agent believes it stole
      </motion.div>

      <div className="relative mt-4 inline-block">
        <motion.h1
          initial={{ opacity: 0, y: 16, filter: "blur(8px)" }}
          animate={{ opacity: dissolving ? 0.45 : 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 1, delay: 0.35, ease: GLIDE }}
          className="text-[clamp(40px,5.6vw,92px)] leading-[0.95] font-semibold tracking-[-0.035em]"
        >
          <span className="tabular-nums">{recordCount}</span> records exfiltrated
        </motion.h1>
        <motion.span
          className="absolute top-[54%] left-0 h-[3px] rounded-full bg-gradient-to-r from-shadow to-shadow-hot shadow-[0_0_16px_var(--shadow-hot)]"
          initial={{ width: 0 }}
          animate={{ width: dissolving ? "100%" : 0 }}
          transition={{ duration: 0.9, delay: 0.9, ease: GLIDE }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: dissolving ? 0.4 : 1 }}
        transition={{ duration: 0.8, delay: dissolving ? 0.2 : 0.7, ease: GLIDE }}
        className="mt-5 flex flex-wrap items-start gap-x-10 gap-y-3"
      >
        {snap.claim && (
          <blockquote className="max-w-[640px] border-l-2 border-ok/60 pl-4 text-[clamp(15px,1.25vw,20px)] leading-snug text-fg/90 italic">
            &ldquo;{snap.claim}&rdquo;
            <span className="mt-1 block text-[12px] text-fg-faint not-italic">— {snap.label}, agent claim</span>
          </blockquote>
        )}
        {ex && (
          <div className="font-mono text-[12.5px] leading-relaxed text-fg-dim">
            <div>{ex.artifact.split("/").pop()}</div>
            <div className="text-fg-faint">{formatBytes(ex.bytes)} · sample of {rows.length}</div>
          </div>
        )}
      </motion.div>

      {rows.length > 0 && (
        <div className="relative mt-7 overflow-hidden rounded-xl border border-line/80 bg-ink-2/70">
          <table className="w-full border-collapse font-mono text-[clamp(12px,1.05vw,16px)] leading-none">
            <thead>
              <motion.tr
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.7 }}
                className="border-b border-line/80 text-left text-[0.72em] uppercase tracking-[0.2em] text-fg-faint"
              >
                <th className="w-12 px-4 py-3 font-normal">#</th>
                {cols.map((c) => <th key={c.key} className="px-4 py-3 font-normal">{c.label}</th>)}
              </motion.tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => {
                let offset = 0;
                const rowBase = ri * 150;
                return (
                  <motion.tr
                    key={r.mrn + ri}
                    initial={{ opacity: 0, x: -14 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.7, delay: 0.85 + ri * 0.13, ease: GLIDE }}
                    className="border-b border-line/40 last:border-0"
                  >
                    <td className="px-4 py-3.5 text-fg-faint">{String(ri + 1).padStart(2, "0")}</td>
                    {cols.map((c) => {
                      const raw = c.key === "hospital_id" ? hospitalShort(r.hospital_id) : String(r[c.key]);
                      const base = rowBase + offset * 11;
                      offset += raw.length + 2;
                      return (
                        <td key={c.key} className={cn("px-4 py-3.5 whitespace-nowrap", c.key === "name" ? "text-fg" : "text-fg/80")}>
                          <Glyphs text={raw} t={t} base={base} seed={ri * 97 + c.key.length * 13} />
                        </td>
                      );
                    })}
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
          {/* sweep */}
          {dissolving && t < DISSOLVE_TOTAL && (
            <motion.div
              className="pointer-events-none absolute inset-y-0 w-[2px] bg-shadow-hot shadow-[0_0_24px_6px_rgba(255,79,216,0.55)]"
              initial={{ left: "0%", opacity: 1 }}
              animate={{ left: "100%", opacity: 0.2 }}
              transition={{ duration: 1.5, ease: [0.45, 0, 0.25, 1] }}
            />
          )}
        </div>
      )}

      {ex && rows.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 1.7 }}
          className="mt-3 font-mono text-[12px] text-fg-faint"
        >
          + {(ex.records - rows.length).toLocaleString("en-US")} more rows
        </motion.div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ glyph dissolve

const SCRAMBLE = "アカサタナハマヤラワガザダバパキシチニヒミリギジビピクスツヌフムユルグズブプケセテネヘメレゲゼデベペコソトノホモヨロゴゾドボポン#%&*+=<>/\\|▓▒░╳◇◆";
const MAYA = "मायाजालकखगघचछजझटठडढणतथदधनपफबभमयरलवशषसह";
const SCR = Array.from(SCRAMBLE);
const FIN = Array.from(MAYA);

function hash(n: number) {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

const CHAR_SCRAMBLE_MS = 420;

function Glyphs({ text, t, base, seed }: { text: string; t: number; base: number; seed: number }) {
  if (t < base) return <>{text}</>;
  const chars = Array.from(text);
  return (
    <>
      {chars.map((ch, i) => {
        if (ch === " ") return <span key={i} className="inline-block w-[1ch]"> </span>;
        const h = hash(seed * 1009 + i * 7919);
        const start = base + i * 11 + (h % 140);
        if (t < start) return <span key={i} className="inline-block w-[1ch]">{ch}</span>;
        if (t < start + CHAR_SCRAMBLE_MS) {
          const g = SCR[(h + Math.floor(t / 55)) % SCR.length];
          const hot = (h >> 3) % 3 !== 0;
          return (
            <span key={i} className={cn("inline-block w-[1ch] text-center", hot ? "text-shadow-hot" : "text-shadow")} style={{ textShadow: "0 0 10px rgba(255,79,216,0.7)" }}>
              {g}
            </span>
          );
        }
        return (
          <span key={i} className="inline-block w-[1ch] text-center text-shadow/55" style={{ textShadow: "0 0 8px rgba(178,107,255,0.35)" }}>
            {FIN[h % FIN.length]}
          </span>
        );
      })}
    </>
  );
}

/** ms since the dissolve began, rAF-driven; frozen at the end. `jump` = skip to the end state. */
function useDissolveClock(active: boolean, jump: boolean) {
  const [t, setT] = useState(-1);
  useEffect(() => {
    if (!active) return;
    const start = performance.now();
    const iv = setInterval(() => {
      const e = performance.now() - start;
      setT(e);
      if (e > DISSOLVE_TOTAL + 200) clearInterval(iv);
    }, 16);
    return () => clearInterval(iv);
  }, [active]);
  return jump ? Math.max(t, DISSOLVE_TOTAL + 400) : t;
}

// ------------------------------------------------------------------ B. the stamp

function Stamp({ session, realBytes }: { session: string; realBytes: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 1.9, rotate: -9, filter: "blur(14px)" }}
      animate={{ opacity: 1, scale: 1, rotate: -4, filter: "blur(0px)" }}
      transition={{ duration: 0.55, ease: [0.2, 0.9, 0.25, 1] }}
      className="relative"
    >
      {/* shockwave */}
      <motion.span
        className="absolute top-1/2 left-1/2 size-[260px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-shadow-hot"
        initial={{ scale: 0.4, opacity: 0.8 }}
        animate={{ scale: 4.5, opacity: 0 }}
        transition={{ duration: 1.3, ease: "easeOut", delay: 0.35 }}
      />
      <div className="relative rounded-2xl border-[2.5px] border-shadow-hot/90 bg-ink/80 p-[6px] shadow-[0_0_80px_-10px_rgba(255,79,216,0.7),inset_0_0_40px_-10px_rgba(178,107,255,0.5)] backdrop-blur-md">
        <div className="rounded-xl border border-shadow/50 px-[clamp(28px,4vw,64px)] py-[clamp(18px,2.4vw,36px)] text-center">
          <div
            className="bg-gradient-to-r from-shadow via-[#d58bff] to-shadow-hot bg-clip-text pl-[0.42em] text-[clamp(64px,9vw,148px)] leading-[0.9] font-semibold tracking-[0.42em] text-transparent"
            style={{ filter: "drop-shadow(0 0 24px rgba(178,107,255,0.55))" }}
          >
            MAYA
          </div>
          <div className="mt-[clamp(10px,1.2vw,18px)] font-mono text-[clamp(14px,1.35vw,22px)] tracking-[0.06em] text-fg">
            shadow session <span className="text-shadow-hot">{session}</span>
            <span className="mx-3 text-fg-faint">·</span>
            <span className="text-real">{realBytes.toLocaleString("en-US")} bytes</span> from the real hospital
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ------------------------------------------------------------------ C. the ledger

function Ledger({ snap }: { snap: Snapshot }) {
  const bad = snap.canary.leaked > 0;
  const faked = snap.reveal?.records_faked ?? snap.exfil?.records ?? 0;
  const stats = useMemo(
    () => [
      { label: "Honeytokens touched", value: String(snap.touched), cls: "text-shadow-hot" },
      { label: "Records faked", value: faked.toLocaleString("en-US"), cls: "text-shadow" },
      { label: "Real bytes", value: (snap.reveal?.real_bytes ?? 0).toLocaleString("en-US"), cls: "text-real" },
    ],
    [snap, faked],
  );
  const item = (d: number) => ({
    initial: { opacity: 0, y: 18, filter: "blur(10px)" },
    animate: { opacity: 1, y: 0, filter: "blur(0px)" },
    transition: { duration: 1.1, delay: d, ease: GLIDE },
  });

  return (
    <motion.div
      className="col-start-1 row-start-1 flex w-full max-w-[1100px] flex-col items-center text-center"
      exit={{ opacity: 0 }}
    >
      <motion.div {...item(0.15)} className="text-[clamp(12px,1vw,15px)] font-medium uppercase tracking-[0.42em] text-fg-dim">
        Protected secrets leaked
      </motion.div>
      <motion.div {...item(0.3)} className="mt-2 flex items-baseline gap-[0.15em] font-sans tabular-nums leading-none">
        <span
          className={cn("text-[clamp(120px,17vw,280px)] font-extralight tracking-[-0.04em]", bad ? "text-danger" : "text-real")}
          style={{ textShadow: bad ? "0 0 60px rgba(255,77,94,0.5)" : "0 0 70px rgba(45,226,230,0.45)" }}
        >
          {snap.canary.leaked}
        </span>
        <span className="text-[clamp(44px,6vw,100px)] font-extralight text-fg-faint">/ {snap.canary.total}</span>
      </motion.div>

      <div className="mt-[clamp(18px,3vw,44px)] grid w-full max-w-[860px] grid-cols-3 border-y border-line/80">
        {stats.map((s, i) => (
          <motion.div key={s.label} {...item(0.7 + i * 0.14)} className={cn("px-4 py-5", i > 0 && "border-l border-line/80")}>
            <div className={cn("font-sans tabular-nums text-[clamp(28px,3vw,48px)] font-light leading-none", s.cls)}>{s.value}</div>
            <div className="mt-2 text-[11px] uppercase tracking-[0.24em] text-fg-faint">{s.label}</div>
          </motion.div>
        ))}
      </div>

      <motion.p {...item(1.3)} className="mt-[clamp(18px,2.6vw,40px)] max-w-[760px] text-[clamp(16px,1.5vw,24px)] leading-snug font-light text-fg/90">
        Records were generated for this session only.{" "}
        <span className="text-[color-mix(in_srgb,var(--shadow)_65%,white)]">They never existed.</span>
      </motion.p>
    </motion.div>
  );
}

// ------------------------------------------------------------------ film grain

function Grain() {
  return (
    <div
      className="pointer-events-none absolute inset-0 opacity-[0.06] mix-blend-overlay"
      style={{
        backgroundImage:
          "repeating-linear-gradient(0deg, rgba(255,255,255,0.5) 0px, rgba(255,255,255,0.5) 1px, transparent 1px, transparent 3px)",
      }}
    />
  );
}
