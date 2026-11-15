"use client";
// One question to the room, then the answer lands: "AI cyberattacks."

import { motion, useReducedMotion } from "framer-motion";
import { EASE, SlideStage } from "./Frame";

export function QuestionSlide({ title }: { title: string }) {
  const reduce = useReducedMotion();
  const t = (duration: number, delay: number) => (reduce ? { duration: 0 } : { duration, delay, ease: EASE });
  return (
    <SlideStage>
      <motion.section role="dialog" aria-label={title}
        initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={t(0.35, 0)}
        className="flex min-h-[620px] w-full max-w-[1280px] flex-col items-center justify-center rounded-2xl border border-border bg-background px-14 py-16 text-center">
        <motion.p initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={t(0.5, 0.1)}
          className="max-w-[1000px] text-[56px] leading-[1.08] font-semibold tracking-[-0.045em] text-balance text-fg-muted">
          {title}
        </motion.p>
        <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={t(0.6, 1.3)}
          className="mt-12 h-px w-[220px] origin-left bg-border-strong" />
        <motion.p initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={t(0.6, 1.7)}
          className="mt-12 text-[120px] leading-none font-semibold tracking-[-0.055em] text-fg">
          AI cyberattacks.
        </motion.p>
      </motion.section>
    </SlideStage>
  );
}
