"use client";
// "A real incident: Synnovis, June 2024". Scenario 2 as MayaJaal applied to a real incident: on the left what happened
// (sourced, SYNNOVIS in research.ts), on the right what our scripted replay of it does, read from the recorded replay
// (public/runs/continuity.jsonl): which lab goes down, the key shares it held, and where every lab order went.
// The next two steps play the replay on the dashboard and show its on-time numbers. Choreography ends by ~4 s.

import { useMemo, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { WORLD } from "@/lib/contracts";
import { cn } from "@/components/ui";
import { EASE, SlideFrame } from "./Frame";
import { SYNNOVIS } from "./research";
import { useRunEvents, type RunEvent } from "./run";

interface Replay {
  lab: string;
  orders: number;
  inHouse: number;
  neighbour: number;
  unservable: number;
  captured: number;
  threshold: number;
  shares: number;
}

/** The replay's facts: the lab that goes down, key shares captured, and each lab order's final state. */
function replayOf(events: RunEvent[]): Replay | null {
  let labId: string | null = null;
  let threshold = WORLD.key_shares.threshold;
  const shares = new Map<number, string>();
  const orders = new Map<string, Record<string, unknown>>();
  for (const e of events) {
    const d = e.data ?? {};
    if (e.type === "node.status" && d.status === "compromised" && !labId) labId = e.hospital_id ?? null;
    if (e.type === "keyshare.status") {
      shares.set(Number(d.share_index), String(d.state));
      if (typeof d.threshold === "number") threshold = d.threshold;
    }
    if (e.type === "lab.order" && typeof d.order_id === "string") orders.set(d.order_id, d);
  }
  if (!labId || !orders.size) return null;
  let inHouse = 0, neighbour = 0, unservable = 0;
  for (const o of orders.values()) {
    if (o.status === "unservable") unservable++;
    else if (o.status === "completed") {
      if (o.to_hospital === o.from_hospital) inHouse++;
      else neighbour++;
    }
  }
  return {
    lab: WORLD.hospitals.find((h) => h.id === labId)?.short ?? labId,
    orders: orders.size, inHouse, neighbour, unservable,
    captured: [...shares.values()].filter((s) => s === "captured").length,
    threshold, shares: WORLD.key_shares.total,
  };
}

const T = { left: 0.35, stats: 0.75, death: 1.15, right: 1.7, step: 0.5, bar: 3.2 };

type Tr = (delay: number, duration?: number) => object;

export function SynnovisSlide({ title }: { title: string }) {
  const reduce = useReducedMotion();
  const tr: Tr = (delay, duration = 0.45) => (reduce ? { duration: 0 } : { duration, delay, ease: EASE });
  const events = useRunEvents("/runs/continuity.jsonl");
  const r = useMemo(() => (events ? replayOf(events) : null), [events]);

  return (
    <SlideFrame kicker="Scenario 2 · a real incident, and our replay of it" title={title}
      note={<>A scripted replay on fictional hospitals, modelled on the incident. <span className="text-fg">It does not show MayaJaal would have stopped the real attack.</span></>}
      source={<span className="text-[16px]">Incident: {SYNNOVIS.source} · Replay: public/runs/continuity.jsonl (scripted)</span>}>
      <div className="grid grid-cols-[1fr_1fr] gap-14">
        {/* what happened */}
        <div className="flex flex-col">
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(T.left, 0.35)}
            className="text-[17px] text-fg-muted tabular-nums">What happened · {SYNNOVIS.date}</motion.p>
          <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={tr(T.left + 0.1)}
            className="mt-3 text-[22px] leading-snug text-fg">
            Ransomware hit {SYNNOVIS.who}. {SYNNOVIS.halted}
          </motion.p>
          <div className="mt-6 grid grid-cols-2 gap-6 border-t border-border pt-5">
            {SYNNOVIS.stats.map((s, i) => (
              <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={tr(T.stats + i * 0.15)}>
                <p className="text-[52px] leading-none font-semibold tracking-[-0.04em] text-fg tabular-nums">{s.value}</p>
                <p className="mt-2 text-[18px] leading-snug text-fg-muted">{s.label}</p>
              </motion.div>
            ))}
          </div>
          <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={tr(T.death)}
            className="mt-6 border-t border-border pt-5 text-[20px] leading-snug text-fg">{SYNNOVIS.death}</motion.p>
        </div>

        {/* our replay of it */}
        <div className="flex flex-col border-l border-border pl-14">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(T.right, 0.35)}
            className="flex items-center justify-between gap-3">
            <p className="text-[17px] text-fg-muted">Replayed on our network</p>
            <span className="rounded-full border border-border-strong px-2.5 py-px text-[16px] text-fg-muted">Scripted replay</span>
          </motion.div>
          <ol className="mt-3 flex flex-col gap-5">
            <Step n={1} tone="alert" delay={T.right + 0.2} tr={tr}
              head={<>{r?.lab ?? "Our shared lab"}, the shared lab, is hit</>}
              sub="Ransomware encrypts its lab servers (simulated, Synnovis-style)." />
            <Step n={2} tone="fg" delay={T.right + 0.2 + T.step} tr={tr}
              head="MayaJaal cuts it off from the network"
              sub={r ? `It held ${r.captured} of the ${r.shares} key shares; ${r.threshold} are needed, so the master key stays safe.`
                : "The master key stays safe: one key share is not enough."} />
            <Step n={3} tone="ok" delay={T.right + 0.2 + 2 * T.step} tr={tr}
              head="Lab orders reroute to labs that still work"
              sub={r ? <Split r={r} reduce={!!reduce} /> : null} />
          </ol>
        </div>
      </div>
    </SlideFrame>
  );
}

const TONE = {
  alert: "border-alert/50 bg-alert-bg text-alert",
  fg: "border-border-strong bg-surface text-fg",
  ok: "border-ok/50 bg-ok/10 text-ok",
} as const;

function Step({ n, tone, head, sub, delay, tr }: {
  n: number; tone: keyof typeof TONE; head: ReactNode; sub: ReactNode; delay: number; tr: Tr;
}) {
  return (
    <motion.li initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={tr(delay)}
      className="grid grid-cols-[36px_1fr] gap-4">
      <span className={cn("flex size-9 items-center justify-center rounded-full border text-[17px] font-semibold tabular-nums", TONE[tone])}>{n}</span>
      <div className="min-w-0">
        <p className="text-[22px] leading-snug font-medium text-fg">{head}</p>
        {sub && <div className="mt-1 text-[18px] leading-snug text-fg-muted">{sub}</div>}
      </div>
    </motion.li>
  );
}

/** Where the replay's lab orders went: own lab, a neighbour's lab, or nowhere in time. */
function Split({ r, reduce }: { r: Replay; reduce: boolean }) {
  const parts = [
    { n: r.inHouse, label: "to their own hospital's lab", cls: "bg-ok" },
    { n: r.neighbour, label: "to a neighbour's lab", cls: "bg-ok/45" },
    { n: r.unservable, label: "could not be served", cls: "bg-alert" },
  ].filter((p) => p.n > 0);
  return (
    <div className="mt-2.5">
      <div className="flex h-[22px] w-full overflow-hidden rounded-[4px] border border-border-strong">
        {parts.map((p, i) => (
          <motion.span key={p.label} className={cn("h-full", p.cls, i > 0 && "border-l border-background")}
            style={{ width: `${(100 * p.n) / r.orders}%`, originX: 0 }}
            initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
            transition={reduce ? { duration: 0 } : { duration: 0.4, delay: T.bar + i * 0.25, ease: EASE }} />
        ))}
      </div>
      <p className="mt-2 text-[17px] leading-snug text-fg-muted tabular-nums">
        {r.orders} orders:{" "}
        {parts.map((p, i) => (
          <span key={p.label}>{i > 0 && " · "}<span className="font-semibold text-fg">{p.n}</span> {p.label}</span>
        ))}
      </p>
    </div>
  );
}
