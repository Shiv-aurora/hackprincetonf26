"use client";
// "Against a cautious attacker": the lure planners in the paper's simulation (Table I, cautious attacker, matched
// engagement): how often the simulated attacker gave up and left, and how often its true goal was identified.
// Bars with 95% whiskers; numbers in research.ts. Labelled as an in-model simulation, with its trade-offs stated.

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/components/ui";
import { EASE, SlideFrame } from "./Frame";
import { SIM, type CI, type Strategy } from "./research";

const W = 540;
const H = 300;
const M = { l: 58, r: 10, t: 34, b: 66 };
const PH = H - M.t - M.b;
const y = (v: number) => M.t + (1 - v / 100) * PH;
const BAR = 96;

const FILL: Record<string, string> = { none: "fill-border-strong", ig1: "fill-fg-subtle", stealth: "fill-fg" };

const fmt = (v: number) => v.toFixed(1);
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(1)}`;

function Panel({ title, better, metric, paired, delay }: {
  title: string; better: string; metric: (s: Strategy) => CI; paired: CI; delay: number;
}) {
  const reduce = useReducedMotion();
  const tr = (d: number, duration = 0.45) => (reduce ? { duration: 0 } : { duration, delay: d, ease: EASE });
  const slot = (W - M.l - M.r) / SIM.strategies.length;
  const cx = (i: number) => M.l + slot * (i + 0.5);
  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-[25px] leading-tight font-semibold tracking-[-0.02em] text-fg">{title}</h3>
        <span className="text-[17px] text-fg-subtle">{better}</span>
      </div>
      <p className="mt-1 text-[17px] text-fg-muted tabular-nums">
        MIRAGE-S vs IG-1, paired by seed: <span className="text-fg">{signed(paired[0])} ± {paired[1].toFixed(1)} points</span>
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="mt-2 block overflow-visible" role="img" aria-label={title}>
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} strokeWidth={1} className={v === 0 ? "stroke-border-strong" : "stroke-border"} />
            <text x={M.l - 12} y={y(v) + 6} textAnchor="end" className="fill-fg-subtle text-[16px] tabular-nums">{v}%</text>
          </g>
        ))}
        {SIM.strategies.map((s, i) => {
          const [m, hw] = metric(s);
          const at = delay + i * 0.16;
          const top = y(m);
          const ours = s.id === "stealth";
          return (
            <g key={s.id}>
              <motion.rect x={cx(i) - BAR / 2} width={BAR} rx={4} className={FILL[s.id]}
                initial={{ y: y(0), height: 0 }} animate={{ y: top, height: y(0) - top }} transition={tr(at, 0.6)} />
              {/* 95% interval */}
              <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(at + 0.5, 0.3)}
                className={ours ? "stroke-fg-muted" : "stroke-fg"} strokeWidth={2}>
                <line x1={cx(i)} x2={cx(i)} y1={y(m + hw)} y2={y(Math.max(0, m - hw))} />
                <line x1={cx(i) - 9} x2={cx(i) + 9} y1={y(m + hw)} y2={y(m + hw)} />
                <line x1={cx(i) - 9} x2={cx(i) + 9} y1={y(Math.max(0, m - hw))} y2={y(Math.max(0, m - hw))} />
              </motion.g>
              <motion.text initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(at + 0.55, 0.3)}
                x={cx(i)} y={y(m + hw) - 14} textAnchor="middle" className="tabular-nums">
                <tspan className={cn("text-[27px] font-semibold", ours ? "fill-fg" : "fill-fg-muted")}>{fmt(m)}%</tspan>
                <tspan dx={6} className="fill-fg-subtle text-[16px]">± {fmt(hw)}</tspan>
              </motion.text>
              <text x={cx(i)} y={H - M.b + 30} textAnchor="middle"
                className={cn("text-[19px]", ours ? "fill-fg font-semibold" : "fill-fg-muted")}>{s.name}</text>
              {s.note && <text x={cx(i)} y={H - M.b + 54} textAnchor="middle" className="fill-fg-subtle text-[16px]">{s.note}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function PlannerSlide({ title }: { title: string }) {
  return (
    <SlideFrame kicker="MIRAGE-S lure planner · Table I of the paper" title={title}
      note={<>With no lures, nobody leaves, but the goal is found less often. <span className="text-fg">Against a bold attacker that never leaves, MIRAGE-S is slower than IG-1 (+{SIM.boldSlowerBy[0].toFixed(2)} requests).</span></>}
      source={<span className="text-[16px]">Cautious attacker, matched engagement · mean ± 95% half-width · paper/data/numbers.tex, generated from the simulation&apos;s output</span>}>
      <div className="-mt-3 mb-6 flex items-center gap-3">
        <span className="rounded-full border border-alert/45 bg-alert-bg px-3 py-0.5 text-[16px] font-medium text-alert">Simulation</span>
        <span className="text-[19px] text-fg-muted">{SIM.label}</span>
      </div>
      <div className="grid grid-cols-2 gap-[88px]">
        <Panel title="Attacker gave up and left" better="lower is better" metric={(s) => s.left} paired={SIM.pairedVsIg1.left} delay={0.55} />
        <Panel title="True goal identified" better="higher is better" metric={(s) => s.ident} paired={SIM.pairedVsIg1.ident} delay={1.25} />
      </div>
    </SlideFrame>
  );
}
