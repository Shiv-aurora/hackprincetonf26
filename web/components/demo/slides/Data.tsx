"use client";
// "Hospitals hold the most valuable data": one patient record, field by field. A stolen card can be
// cancelled and a password reset; a diagnosis or a Social Security number is for life. Then the price.

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/components/ui";
import { Appear, EASE, SlideFrame } from "./Frame";
import { DATA } from "./facts";

// Illustrative record: made-up values, partly masked. No real person.
const FIELDS: { k: string; v: string; forever: boolean }[] = [
  { k: "Name", v: "Maria L. ████", forever: false },
  { k: "Date of birth", v: "██ / ██ / 1961", forever: true },
  { k: "Social Security no.", v: "███-██-4417", forever: true },
  { k: "Insurance ID", v: "XQH ████ 2290", forever: false },
  { k: "Diagnosis", v: "HIV, type 2 diabetes", forever: true },
  { k: "Mental health notes", v: "████████████", forever: true },
  { k: "Medications", v: "Biktarvy, metformin", forever: true },
];

export function DataSlide({ title }: { title: string }) {
  const reduce = useReducedMotion();
  return (
    <SlideFrame kicker="What attackers want" title={title}
      note={<>A card gets cancelled. A password gets reset. <span className="text-fg">A diagnosis is forever.</span></>}
      source={[DATA.price.source, DATA.breach.source].filter(Boolean).length ? `Sources: ${[DATA.price.source, DATA.breach.source].filter(Boolean).join(" · ")}` : undefined}>
      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr] lg:gap-10">
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between pb-3">
            <span className="text-sm font-medium text-fg">Patient record</span>
            <span className="text-xs text-fg-subtle">Illustrative · not a real patient</span>
          </div>
          <div className="flex flex-col divide-y divide-border">
            {FIELDS.map((f, i) => (
              <motion.div key={f.k} className="flex items-center gap-3 py-2.5 text-[14px]"
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                transition={reduce ? { duration: 0 } : { duration: 0.35, delay: 0.5 + i * 0.18, ease: EASE }}>
                <span className="w-[150px] shrink-0 text-fg-muted">{f.k}</span>
                <span className="truncate font-mono text-[13px] text-fg">{f.v}</span>
                <motion.span
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  transition={reduce ? { duration: 0 } : { duration: 0.25, delay: 2.0 + i * 0.12 }}
                  className={cn("ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px]",
                    f.forever ? "bg-alert-bg text-alert" : "bg-surface-2 text-fg-subtle")}>
                  {f.forever ? "can't be changed" : "can be replaced"}
                </motion.span>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="flex flex-col justify-center gap-7">
          {DATA.price.record && (
            <Appear delay={2.6}>
              <p className="text-sm text-fg-muted">On criminal markets</p>
              <div className="mt-3 flex flex-col gap-3">
                <Bar label="Medical record" value={DATA.price.record} pct={100} strong delay={2.8} />
                <Bar label="Credit card" value={DATA.price.card} pct={DATA.price.cardPct} delay={3.0} />
              </div>
            </Appear>
          )}
          {DATA.breach.value && (
            <Appear delay={3.4}>
              <p className="text-[40px] leading-none font-semibold tracking-[-0.045em] text-fg tabular-nums">{DATA.breach.value}</p>
              <p className="mt-2 text-[15px] text-fg-muted">{DATA.breach.label}</p>
            </Appear>
          )}
        </div>
      </div>
    </SlideFrame>
  );
}

function Bar({ label, value, pct, strong, delay }: { label: string; value: string; pct: number; strong?: boolean; delay: number }) {
  const reduce = useReducedMotion();
  return (
    <div>
      <div className="flex items-baseline justify-between text-[14px]">
        <span className={strong ? "text-fg" : "text-fg-muted"}>{label}</span>
        <span className={cn("tabular-nums", strong ? "text-xl font-semibold text-fg" : "text-fg-muted")}>{value}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
        <motion.div className={cn("h-full rounded-full", strong ? "bg-fg" : "bg-fg-subtle")}
          initial={{ width: 0 }} animate={{ width: `${Math.max(2, pct)}%` }}
          transition={reduce ? { duration: 0 } : { duration: 0.7, delay, ease: EASE }} />
      </div>
    </div>
  );
}
