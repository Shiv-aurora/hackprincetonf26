"use client";
// "A hospital's most valuable asset: your data". A "You" card collects the data a hospital holds on
// one person, chip by chip; the ones that can never be changed get an amber "forever" mark. Then the
// card slides aside and a grid of the US population fills in: one attack exposed more than half of it,
// and one amber square ("you, more likely than not") lands last.
// Choreography finishes by ~4.6 s, then holds.

import { useEffect } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { cn } from "@/components/ui";
import { EASE, SlideFrame } from "./Frame";

// ------------------------------------------------------------------ numbers + sources (checked Nov 14 2026)

// 192.7 million people: Change Healthcare ransomware attack, Feb 2024 (largest healthcare breach on record).
//   CyberInsider, Aug 15 2025 — https://cyberinsider.com/change-healthcare-revises-breach-impact-to-192-7-million-individuals/
//   HIPAA Journal (HHS OCR data), updated Nov 13 2026 — https://www.hipaajournal.com/healthcare-data-breach-statistics/
const BREACH_MILLIONS = 192.7;
// 341.8 million: US resident population, July 1 2025. US Census Bureau Vintage 2025 estimates, released Jan 27 2026
//   https://www.census.gov/newsroom/press-releases/2026/2025-popest-metro-micro-counties.html
const US_POP_MILLIONS = 341.8;
// $250–1,000 per complete medical record vs as little as $5 per credit card (vendor market estimates).
//   Flare, Jun 15 2026 — https://flare.io/learn/resources/blog/stolen-medical-records-fuel-black-market-fraud-identity-theft-patient-harm
const PRICE_RECORD = "$250–1,000";
const PRICE_CARD = "~$5";

const SOURCES =
  "Illustrative profile, not a real person. Sources: HIPAA Journal / CyberInsider (Change Healthcare, 2025) · US Census Bureau (Vintage 2025) · Flare (Jun 2026, market estimates)";

// Grid of the US population: COLS × ROWS squares, filled column by column.
const COLS = 25;
const ROWS = 16;
const CELLS = COLS * ROWS; // 400
const FILLED = Math.round((BREACH_MILLIONS / US_POP_MILLIONS) * CELLS); // 226
const PER_CELL = Math.round((US_POP_MILLIONS * 1e6) / CELLS / 1000) * 1000; // ≈ 854,000
const SHARE = Math.round((BREACH_MILLIONS / US_POP_MILLIONS) * 100); // 56
// The amber "you" square: one filled square (column 6, row 8). With 56% exposed, "more likely than not".
const YOU_ORDER = 5 * ROWS + 7;

// ------------------------------------------------------------------ the profile

type Kind = "forever" | "reset" | null;
const CHIPS: { k: string; kind: Kind }[] = [
  { k: "Name", kind: null },
  { k: "Date of birth", kind: "forever" },
  { k: "Home address", kind: null },
  { k: "Phone", kind: null },
  { k: "Social Security no.", kind: "forever" },
  { k: "Insurance ID", kind: null },
  { k: "Diagnoses", kind: "forever" },
  { k: "Medications", kind: "forever" },
  { k: "Lab results", kind: "forever" },
  { k: "Mental health notes", kind: "forever" },
  { k: "Family history", kind: "forever" },
  { k: "Emergency contact", kind: null },
  { k: "Card on file", kind: "reset" },
  { k: "Password", kind: "reset" },
];

// Timeline (seconds).
const T = { card: 0.3, chip0: 0.55, chipStep: 0.11, tags: 2.15, shift: 2.6, grid: 2.85, fillDur: 1.2 };

export function DataSlide({ title }: { title: string }) {
  const reduce = useReducedMotion();
  const tr = (delay: number, duration = 0.45) => (reduce ? { duration: 0 } : { duration, delay, ease: EASE });

  return (
    <SlideFrame kicker="What attackers want" title={title}
      note={<>A card gets cancelled. A password gets reset. <span className="text-fg">Your diagnosis is forever.</span></>}
      source={SOURCES}>
      <div className="grid grid-cols-[1fr_470px] items-start gap-14">
        {/* The person: starts centred, then slides left as the grid arrives. 263 = (56 gap + 470 grid col) / 2,
            which centres the card in the row whatever the frame width. */}
        <motion.div initial={{ x: 263 }} animate={{ x: 0 }} transition={tr(T.shift, 0.6)}>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={tr(T.card)}
            className="rounded-xl border border-border bg-surface p-6">
            <div className="flex items-center gap-4">
              <Silhouette />
              <div className="flex flex-col">
                <span className="text-[26px] leading-none font-semibold tracking-[-0.03em] text-fg">You</span>
                <span className="mt-1.5 text-[15px] text-fg-muted">Patient record</span>
              </div>
              <span className="ml-auto self-start rounded-full border border-border px-2.5 py-0.5 text-[13px] text-fg-subtle">
                Illustrative
              </span>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {CHIPS.map((c, i) => {
                // Deterministic fly-in direction (golden angle), so server and client agree.
                const a = (i * 137.5 * Math.PI) / 180;
                return (
                  <motion.span key={c.k}
                    initial={{ opacity: 0, x: Math.round(Math.cos(a) * 70), y: Math.round(Math.sin(a) * 44), scale: 0.9 }}
                    animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                    transition={tr(T.chip0 + i * T.chipStep, 0.4)}
                    className={cn("inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-[17px] text-fg",
                      c.kind === "forever" ? "border-alert/45" : "border-border")}>
                    {c.k}
                    {c.kind && (
                      <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                        transition={tr(T.tags + (c.kind === "forever" ? 0 : 0.15), 0.25)}
                        className={cn("text-[13px]", c.kind === "forever" ? "font-medium text-alert" : "text-fg-subtle")}>
                        {c.kind === "forever" ? "forever" : "can be reset"}
                      </motion.span>
                    )}
                  </motion.span>
                );
              })}
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(T.shift + 1.6)}
            className="mt-5 flex items-baseline gap-3 text-[18px] text-fg-muted">
            <span>On criminal markets</span>
            <span className="text-fg">Medical record <span className="font-semibold tabular-nums">{PRICE_RECORD}</span></span>
            <span className="text-fg-subtle">vs</span>
            <span>credit card <span className="font-semibold text-fg tabular-nums">{PRICE_CARD}</span></span>
          </motion.div>
        </motion.div>

        {/* Everyone: the US population, and the share one attack exposed. */}
        <motion.div initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={tr(T.grid - 0.15)}>
          <p className="text-[17px] text-fg-muted">One attack · Change Healthcare, Feb 2024</p>
          <p className="mt-1 text-[56px] leading-none font-semibold tracking-[-0.045em] text-fg tabular-nums">
            <Counter to={BREACH_MILLIONS} delay={T.grid} duration={T.fillDur} /> million
          </p>
          <p className="mt-2 text-[18px] text-fg-muted">
            people&apos;s records. About {SHARE}% of everyone in the US.
          </p>
          <PopulationGrid tr={tr} />
          <div className="mt-3 flex items-center gap-3.5 text-[14px] text-fg-subtle tabular-nums">
            <span className="inline-flex items-center gap-1.5"><span className="size-[10px] rounded-[2px] bg-fg" /> ≈ {PER_CELL.toLocaleString("en-US")} people</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-[10px] rounded-[2px] border border-border-strong" /> not in this breach</span>
            <span className="inline-flex items-center gap-1.5 text-alert"><span className="size-[10px] rounded-[2px] bg-alert" /> you, more likely than not</span>
          </div>
        </motion.div>
      </div>
    </SlideFrame>
  );
}

function PopulationGrid({ tr }: { tr: (delay: number, duration?: number) => object }) {
  // Column-major order: filled squares sweep left to right, so "more than half" reads at a glance.
  // Every square keeps its hairline outline; the fill pops in on top.
  const cells = Array.from({ length: CELLS }, (_, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const order = col * ROWS + row;
    return { i, filled: order < FILLED, order, you: order === YOU_ORDER };
  });
  return (
    <div className="mt-5 grid gap-[4px]" style={{ gridTemplateColumns: `repeat(${COLS}, 14px)` }} aria-hidden>
      {cells.map((c) => (
        <span key={c.i} className="relative size-[14px] rounded-[2px] border border-border-strong">
          {c.filled && (
            <motion.span className={cn("absolute -inset-px rounded-[2px]", c.you ? "bg-alert" : "bg-fg")}
              initial={c.you ? { opacity: 0, scale: 2.2 } : { opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }}
              transition={c.you ? tr(T.grid + T.fillDur + 0.15, 0.4) : tr(T.grid + (c.order / FILLED) * T.fillDur, 0.22)} />
          )}
        </span>
      ))}
    </div>
  );
}

/** Counts 0 → `to` with one decimal. Motion value, so no React state updates per frame. */
function Counter({ to, delay, duration }: { to: number; delay: number; duration: number }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => v.toFixed(1));
  useEffect(() => {
    if (reduce) { mv.set(to); return; }
    const c = animate(mv, to, { delay, duration, ease: [0.33, 1, 0.68, 1] });
    return () => c.stop();
  }, [reduce, mv, to, delay, duration]);
  return <motion.span>{text}</motion.span>;
}

/** Hairline head-and-shoulders. */
function Silhouette() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden
      className="shrink-0 rounded-full border border-border bg-background text-fg-muted">
      <circle cx="28" cy="22" r="8.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 46c2.5-8 9-12 16-12s13.5 4 16 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
