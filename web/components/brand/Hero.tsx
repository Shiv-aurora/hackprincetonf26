"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowDown, ArrowRight } from "lucide-react";
import { connectHub, useMJEvent } from "@/lib/events";
import type { MJEvent } from "@/lib/contracts";
import { SoundToggle } from "@/lib/sound";
import { JaalCanvas, type JaalHandle } from "./JaalCanvas";
import { Wordmark } from "./Wordmark";
import { Mark } from "./Mark";
import { LiveChip } from "./LiveChip";

export interface HeroProps {
  /**
   * BACKGROUND SLOT. Pass a full-bleed component (e.g. the 3D city) to render behind the title.
   * It fills the hero (absolute inset-0). When set, the woven-net canvas is not rendered unless
   * `keepNet` is true (then the net is layered on top of it, additively).
   */
  background?: ReactNode;
  keepNet?: boolean;
}

// Title sequence (ms from load).
const T_WORDMARK = 1700;
const T_TAGLINE = 3500;
const T_CTAS = 4300;

const GLIDE = [0.16, 1, 0.3, 1] as const;

export function Hero({ background, keepNet = false }: HeroProps) {
  const reduce = useReducedMotion();
  const net = useRef<JaalHandle>(null);
  const [phase, setPhase] = useState(0); // 0 weaving · 1 wordmark · 2 tagline · 3 CTAs
  const [skipped, setSkipped] = useState(false);

  useEffect(() => connectHub(), []);

  useEffect(() => {
    if (reduce) return;
    const ids = [
      setTimeout(() => setPhase((p) => Math.max(p, 1)), T_WORDMARK),
      setTimeout(() => setPhase((p) => Math.max(p, 2)), T_TAGLINE),
      setTimeout(() => setPhase((p) => Math.max(p, 3)), T_CTAS),
    ];
    return () => ids.forEach(clearTimeout);
  }, [reduce]);
  const shown = reduce ? 3 : phase;

  // Click / key during the intro jumps to the end.
  const skip = useCallback(() => {
    if (phase >= 3) return;
    net.current?.skip();
    setSkipped(true);
    setPhase(3);
  }, [phase]);
  useEffect(() => {
    if (phase >= 3) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, skip]);

  // Live traffic travels the net: real → teal on the dome, shadow → violet in the reflection.
  const onEvent = useCallback((ev: MJEvent) => {
    if (ev.type === "request" && (ev.tier === "real" || ev.tier === "shadow")) net.current?.pulse(ev.tier);
    else if (ev.type === "session.diverted" || ev.type === "honeytoken.touched") net.current?.pulse("shadow");
  }, []);
  useMJEvent(onEvent);

  return (
    <section
      className="relative isolate flex h-[100svh] min-h-[640px] w-full flex-col overflow-hidden bg-[#05070c]"
      onPointerDown={phase < 3 ? skip : undefined}
    >
      {/* ---------- background layer (SLOT) ---------- */}
      <div className="absolute inset-0 -z-10">
        {background ? <div className="absolute inset-0">{background}</div> : null}
        {(!background || keepNet) && (
          <JaalCanvas ref={net} instant={!!reduce} className="absolute inset-0 h-full w-full mix-blend-screen" />
        )}
        {/* vignette + a soft pool of darkness behind the title for legibility */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_42%,rgba(5,7,12,0.55)_0%,rgba(5,7,12,0.15)_38%,transparent_60%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_50%,transparent_55%,rgba(0,0,0,0.75)_100%)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-[#05070c]" />
      </div>

      {/* ---------- top bar ---------- */}
      <motion.header
        className="relative z-10 flex items-center justify-between px-5 pt-5 sm:px-8 sm:pt-6"
        initial={{ opacity: 0, y: -8 }}
        animate={shown >= 3 ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 1.2, ease: GLIDE, delay: skipped ? 0 : 0.3 }}
      >
        <Link href="/" className="flex items-center gap-2.5 text-white/85" aria-label="MayaJaal home">
          <Mark className="h-7 w-7" />
          <span className="hidden font-mono text-[11px] tracking-[0.28em] text-white/45 uppercase sm:inline">
            Hospital cyber-resilience
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <LiveChip />
          <SoundToggle />
        </div>
      </motion.header>

      {/* ---------- title ---------- */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-5 pb-[14vh] text-center sm:pb-[18vh]">
        <h1 className="sr-only">MayaJaal — The breach is real. The data isn&apos;t.</h1>
        <div className="w-[min(86vw,720px)] text-[#eef6ff] [filter:drop-shadow(0_0_22px_rgba(124,243,255,0.22))_drop-shadow(0_0_2px_rgba(255,255,255,0.4))]">
          {shown >= 1 && <Wordmark animate={!skipped && !reduce} className="h-auto w-full" />}
          {shown < 1 && <div className="aspect-[572/176] w-full" />}
        </div>

        <div className="mt-6 min-h-[2.5em] sm:mt-8">
          <AnimatePresence>
            {shown >= 2 && <Tagline instant={skipped || !!reduce} />}
          </AnimatePresence>
        </div>

        <motion.div
          className="mt-8 flex flex-col items-center gap-3 sm:mt-10 sm:flex-row sm:gap-4"
          initial={{ opacity: 0, y: 14 }}
          animate={shown >= 3 ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 1.1, ease: GLIDE, delay: skipped ? 0.1 : 0 }}
          style={{ pointerEvents: shown >= 3 ? "auto" : "none" }}
        >
          <PrimaryCTA href="/war-room">Watch a live attack</PrimaryCTA>
          <SecondaryCTA href="/arena">Try to break it</SecondaryCTA>
        </motion.div>
      </div>

      {/* ---------- scroll cue ---------- */}
      <motion.a
        href="#story"
        className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2 font-mono text-[10px] tracking-[0.3em] text-white/35 uppercase transition-colors hover:text-white/70"
        initial={{ opacity: 0 }}
        animate={shown >= 3 ? { opacity: 1 } : {}}
        transition={{ duration: 1.4, delay: skipped ? 0.4 : 1.2 }}
      >
        The story
        <motion.span animate={{ y: [0, 5, 0] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}>
          <ArrowDown size={14} strokeWidth={1.5} />
        </motion.span>
      </motion.a>

      {/* skip hint during the intro */}
      <AnimatePresence>
        {shown < 3 && (
          <motion.div
            className="absolute right-6 bottom-6 z-10 font-mono text-[10px] tracking-[0.25em] text-white/25 uppercase"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { delay: 1.2, duration: 1 } }}
            exit={{ opacity: 0, transition: { duration: 0.4 } }}
          >
            Click to skip
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function Tagline({ instant }: { instant: boolean }) {
  const words: { w: string; cls?: string }[] = [
    { w: "The" }, { w: "breach" }, { w: "is" },
    { w: "real.", cls: "text-[#5eead4]" },
    { w: "The" }, { w: "data" },
    { w: "isn’t.", cls: "bg-gradient-to-r from-[#a78bfa] to-[#e879f9] bg-clip-text text-transparent" },
  ];
  return (
    <p className="text-[clamp(1.15rem,2.4vw,1.75rem)] font-light tracking-[-0.01em] text-white/80">
      {words.map(({ w, cls }, i) => (
        <motion.span
          key={i}
          className={`inline-block ${cls ?? ""} ${i === 3 ? "mr-[0.6em]" : "mr-[0.28em]"}`}
          initial={instant ? false : { opacity: 0, y: 8, filter: "blur(10px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 1.1, ease: GLIDE, delay: instant ? 0 : i * 0.09 + (i > 3 ? 0.35 : 0) }}
        >
          {w}
        </motion.span>
      ))}
    </p>
  );
}

export function PrimaryCTA({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="group relative inline-flex h-12 items-center gap-3 rounded-full border border-[#2de2d0]/45 bg-[#2de2d0]/[0.08] pr-5 pl-4 text-[15px] font-medium text-[#d5fffa] shadow-[0_0_0_0_rgba(45,226,208,0)] backdrop-blur-md transition-all duration-500 ease-out hover:border-[#2de2d0]/80 hover:bg-[#2de2d0]/[0.16] hover:shadow-[0_0_40px_-4px_rgba(45,226,208,0.55)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2de2d0]"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2de2d0] opacity-60 [animation-duration:2s]" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[#2de2d0]" />
      </span>
      {children}
      <ArrowRight size={16} strokeWidth={1.75} className="transition-transform duration-500 ease-out group-hover:translate-x-1" />
    </Link>
  );
}

export function SecondaryCTA({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex h-12 items-center gap-3 rounded-full border border-[#a78bfa]/35 bg-[#8b5cf6]/[0.06] px-5 text-[15px] font-medium text-[#ece6ff] backdrop-blur-md transition-all duration-500 ease-out hover:border-[#c084fc]/75 hover:bg-[#8b5cf6]/[0.14] hover:shadow-[0_0_40px_-4px_rgba(192,132,252,0.5)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#c084fc]"
    >
      {children}
      <ArrowRight size={16} strokeWidth={1.75} className="transition-transform duration-500 ease-out group-hover:translate-x-1" />
    </Link>
  );
}
