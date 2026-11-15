"use client";
// Shared frame for the big explainer slides: a large centred card with a kicker, a big title, a visual
// that animates in, one short note and a source line. Children stagger in with short fades.

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/components/ui";

export const EASE = [0.16, 1, 0.3, 1] as const;

export function SlideFrame({ kicker, title, note, source, children, className }: {
  kicker: string; title: ReactNode; note?: ReactNode; source?: ReactNode; children: ReactNode; className?: string;
}) {
  const reduce = useReducedMotion();
  // Always pass initial + animate (so server and client agree); reduced motion just makes it instant.
  const rise = (delay: number) => ({
    initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 },
    transition: reduce ? { duration: 0 } : { duration: 0.5, delay, ease: EASE },
  });
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center px-4 pt-[72px] pb-[68px]">
      <motion.section role="dialog" aria-label={typeof title === "string" ? title : kicker}
        initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
        transition={reduce ? { duration: 0 } : { duration: 0.4, ease: EASE }}
        className={cn("pointer-events-auto flex max-h-full w-full max-w-[1120px] flex-col overflow-hidden rounded-2xl border border-border bg-background px-6 py-7 sm:px-10 sm:py-9", className)}>
        <motion.p {...rise(0.05)} className="text-sm text-fg-muted">{kicker}</motion.p>
        <motion.h2 {...rise(0.12)}
          className="mt-1.5 text-[30px] leading-[1.08] font-semibold tracking-[-0.04em] text-balance text-fg sm:text-[44px]">
          {title}
        </motion.h2>
        <motion.div {...rise(0.22)} className="mt-6 min-h-0 flex-1 sm:mt-8">{children}</motion.div>
        {(note || source) && (
          <motion.div {...rise(0.4)} className="mt-6 flex flex-col gap-1.5 sm:mt-7">
            {note && <p className="text-[15px] text-balance text-fg-muted sm:text-base">{note}</p>}
            {source && <p className="text-xs text-fg-subtle">{source}</p>}
          </motion.div>
        )}
      </motion.section>
    </div>
  );
}

/** Fade + rise a child after `delay` seconds (respects reduced motion). */
export function Appear({ delay = 0, children, className, x = 0, y = 12 }: {
  delay?: number; children: ReactNode; className?: string; x?: number; y?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className}
      initial={{ opacity: 0, x, y }} animate={{ opacity: 1, x: 0, y: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.45, delay, ease: EASE }}>
      {children}
    </motion.div>
  );
}
