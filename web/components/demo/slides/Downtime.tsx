"use client";
// "What we can't shut down: healthcare." A heart trace that keeps running while the hospital's systems go
// dark one by one, next to real hospitals that were hit and what it cost them (each sourced in facts.ts).

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
    <div className="relative h-[150px] overflow-hidden rounded-xl border border-border bg-surface">
      <motion.svg viewBox="0 0 1200 100" preserveAspectRatio="none" className="absolute inset-y-0 left-0 h-full w-[200%]"
        initial={{ x: "0%" }} animate={reduce ? { x: "0%" } : { x: ["0%", "-50%"] }} style={{ top: -14 }}
        transition={reduce ? { duration: 0 } : { duration: 6, ease: "linear", repeat: Infinity }}>
        <path d={d} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinejoin="round" className="text-fg" vectorEffect="non-scaling-stroke" />
      </motion.svg>
      <span className="absolute bottom-3 left-5 text-[15px] text-fg-muted">Patient in surgery · can&apos;t pause</span>
    </div>
  );
}

export function DowntimeSlide({ title }: { title: string }) {
  const reduce = useReducedMotion();
  const [down, setDown] = useState(0);
  useEffect(() => {
    if (down >= SYSTEMS.length) return;
    const t = setTimeout(() => setDown((n) => (reduce ? SYSTEMS.length : n + 1)), reduce ? 0 : down === 0 ? 1100 : 320);
    return () => clearTimeout(t);
  }, [down, reduce]);

  return (
    <SlideFrame kicker="Software can be switched off. A hospital can't." title={title}
      note={<>Shut down to stop the thief, and patients wait. Stay up, and the data walks out. <span className="text-fg">Hospitals need a third option.</span></>}
      source={`Sources: ${DOWNTIME.sources}`}>
      <div className="grid grid-cols-[1.05fr_1fr] gap-12">
        <div className="flex flex-col gap-4">
          <Ecg />
          <div className="grid grid-cols-2 gap-2.5">
            {SYSTEMS.map((s, i) => {
              const off = i < down;
              return (
                <div key={s} className={cn("flex items-center gap-2.5 rounded-lg border px-4 py-3 text-[17px] transition-colors duration-200",
                  off ? "border-alert/40 bg-alert-bg text-fg" : "border-border text-fg-muted")}>
                  <span className={cn("size-2 shrink-0 rounded-full transition-colors duration-200", off ? "bg-alert" : "bg-ok")} />
                  <span className="truncate">{s}</span>
                  <span className="ml-auto text-[14px] text-fg-subtle">{off ? "offline" : "up"}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col">
          <Appear delay={1.2}><p className="text-[17px] text-fg-muted">Hospitals that went dark</p></Appear>
          <div className="mt-3 flex flex-col divide-y divide-border border-t border-border">
            {DOWNTIME.hospitals.map((h, i) => (
              <motion.div key={h.who} className="grid grid-cols-[120px_1fr] gap-4 py-4"
                initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }}
                transition={reduce ? { duration: 0 } : { duration: 0.45, delay: 1.5 + i * 0.4, ease: EASE }}>
                <span className="pt-0.5 text-[15px] text-fg-subtle tabular-nums">{h.date}</span>
                <div>
                  <p className="text-[20px] leading-snug font-medium text-fg">{h.who}</p>
                  <p className="mt-0.5 text-[17px] leading-snug text-fg-muted">{h.what}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </SlideFrame>
  );
}
