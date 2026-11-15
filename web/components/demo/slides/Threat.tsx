"use client";
// "AI now runs the attack": one headline number on how much of an attack an AI agent now does on its own,
// then a timeline of recent, real incidents that lands on today.

import { motion, useReducedMotion } from "framer-motion";
import { Appear, EASE, SlideFrame } from "./Frame";
import { THREAT } from "./facts";

export function ThreatSlide({ title }: { title: string }) {
  const reduce = useReducedMotion();
  const items = THREAT.incidents;
  return (
    <SlideFrame kicker="The problem" title={title}
      note={<>One person with AI agents can now attack hundreds of organizations at once. <span className="text-fg">Hospitals are already being hit.</span></>}
      source={THREAT.sources ? `Sources: ${THREAT.sources}` : undefined}>
      <div className="flex flex-col gap-8">
        <div className="grid gap-6 sm:grid-cols-3">
          {THREAT.stats.map((s, i) => (
            <Appear key={s.label} delay={0.4 + i * 0.25}>
              <p className="text-[44px] leading-none font-semibold tracking-[-0.045em] text-fg tabular-nums sm:text-[52px]">{s.value}</p>
              <p className="mt-2 text-[15px] text-balance text-fg-muted">{s.label}</p>
            </Appear>
          ))}
        </div>

        <div>
          <Appear delay={1.0}><p className="mb-3 text-sm text-fg-muted">Hospitals hit in 2026</p></Appear>
          <div className="relative">
          <motion.div className="absolute top-[7px] left-0 h-px bg-border-strong"
            initial={{ width: 0 }} animate={{ width: "100%" }}
            transition={reduce ? { duration: 0 } : { duration: 1.4, delay: 1.2, ease: EASE }} />
          <div className="relative grid gap-4" style={{ gridTemplateColumns: `repeat(${items.length + 1}, minmax(0, 1fr))` }}>
            {items.map((it, i) => (
              <motion.div key={it.what} className="flex flex-col gap-2"
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                transition={reduce ? { duration: 0 } : { duration: 0.4, delay: 1.5 + i * 0.35, ease: EASE }}>
                <span className="size-[15px] rounded-full border-2 border-background bg-fg-muted" />
                <span className="text-xs text-fg-subtle tabular-nums">{it.date}</span>
                <span className="text-[14px] leading-snug font-medium text-fg">{it.who}</span>
                <span className="text-[13px] leading-snug text-fg-muted">{it.what}</span>
              </motion.div>
            ))}
            <motion.div className="flex flex-col gap-2"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={reduce ? { duration: 0 } : { duration: 0.4, delay: 1.5 + items.length * 0.35, ease: EASE }}>
              <span className="size-[15px] rounded-full border-2 border-background bg-alert" />
              <span className="text-xs text-fg-subtle">Today</span>
              <span className="text-[14px] leading-snug font-medium text-fg">Your hospital</span>
              <span className="text-[13px] leading-snug text-fg-muted">One phished login away.</span>
            </motion.div>
          </div>
          </div>
        </div>
      </div>
    </SlideFrame>
  );
}
