"use client";
// "A hospital can't switch off": a live heart trace that keeps running while the hospital's systems go
// dark one by one, then the real-world cost of shutting down (a sourced incident).

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/components/ui";
import { Appear, EASE, SlideFrame } from "./Frame";
import { DOWNTIME } from "./facts";

const SYSTEMS = ["Patient records", "Lab results", "Pharmacy", "Imaging", "Scheduling", "Bed board"];

/** One heartbeat as a path segment, width 120, baseline at y=50. */
const BEAT = "l30 0 l6 -8 l6 8 l8 0 l4 10 l6 -46 l6 50 l4 -14 l10 0 l8 -10 l8 10 l24 0";

function Ecg() {
  const reduce = useReducedMotion();
  const d = "M0 50 " + Array.from({ length: 10 }, () => BEAT).join(" ");
  return (
    <div className="relative h-[120px] overflow-hidden rounded-xl border border-border bg-surface">
      <motion.svg viewBox="0 0 1200 100" preserveAspectRatio="none" className="absolute inset-y-0 left-0 h-full w-[200%]"
        animate={reduce ? undefined : { x: ["0%", "-50%"] }}
        transition={reduce ? { duration: 0 } : { duration: 6, ease: "linear", repeat: Infinity }}>
        <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" className="text-fg" vectorEffect="non-scaling-stroke" />
      </motion.svg>
      <span className="absolute top-3 left-4 text-xs text-fg-muted">Patient in surgery · can&apos;t pause</span>
    </div>
  );
}

export function DowntimeSlide({ title }: { title: string }) {
  const reduce = useReducedMotion();
  const [down, setDown] = useState(0);
  useEffect(() => {
    if (down >= SYSTEMS.length) return;
    const t = setTimeout(() => setDown((n) => (reduce ? SYSTEMS.length : n + 1)), reduce ? 0 : down === 0 ? 1200 : 380);
    return () => clearTimeout(t);
  }, [down, reduce]);

  return (
    <SlideFrame kicker="Why you can't just pull the plug" title={title}
      note={<>Shut down to stop the thief, and patients wait. Stay up, and the data walks out. <span className="text-fg">Hospitals need a third option.</span></>}
      source={DOWNTIME.case.source ? `Source: ${DOWNTIME.case.source}` : undefined}>
      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr] lg:gap-10">
        <div className="flex flex-col gap-4">
          <Ecg />
          <div className="grid grid-cols-3 gap-2">
            {SYSTEMS.map((s, i) => {
              const off = i < down;
              return (
                <div key={s} className={cn("flex items-center gap-2 rounded-lg border px-3 py-2.5 text-[13px] transition-colors duration-200",
                  off ? "border-alert/40 bg-alert-bg text-fg" : "border-border text-fg-muted")}>
                  <span className={cn("size-1.5 shrink-0 rounded-full transition-colors duration-200", off ? "bg-alert" : "bg-ok")} />
                  <span className="truncate">{s}</span>
                  <span className="ml-auto text-xs text-fg-subtle">{off ? "offline" : "up"}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col justify-center gap-1">
          <Appear delay={1.6}><p className="text-sm text-fg-muted">When a hospital went dark: {DOWNTIME.case.name} <span className="text-fg-subtle">· {DOWNTIME.case.when}</span></p></Appear>
          <div className="mt-2 flex flex-col divide-y divide-border">
            {DOWNTIME.impacts.map((m, i) => (
              <motion.div key={m.label} className="flex items-baseline gap-4 py-3"
                initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }}
                transition={reduce ? { duration: 0 } : { duration: 0.45, delay: 2.2 + i * 0.35, ease: EASE }}>
                <span className="w-[120px] shrink-0 text-[34px] leading-none font-semibold tracking-[-0.04em] text-fg tabular-nums">{m.value}</span>
                <span className="text-[15px] text-fg-muted">{m.label}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </SlideFrame>
  );
}
