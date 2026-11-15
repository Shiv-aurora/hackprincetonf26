"use client";
// Shared frame for the big explainer slides, sized for a projector: each slide is laid out on a fixed
// 1320×800 design canvas and zoomed to fill the screen (so 1920×1080 gets ~1.35×). Kicker, big title,
// a visual that animates in, one short note and a source line. Children stagger in with short fades.

import { useEffect, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/components/ui";

export const EASE = [0.16, 1, 0.3, 1] as const;

const CANVAS = { w: 1320, h: 800 };

/** Zoom factor that fits the design canvas into the viewport (minus the bottom controls). */
export function useSlideZoom(): number {
  const [z, setZ] = useState(1);
  useEffect(() => {
    const fit = () => setZ(Math.max(0.5, Math.min(1.8, Math.min(window.innerWidth / CANVAS.w, (window.innerHeight - 64) / CANVAS.h))));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return z;
}

/** Full-screen overlay that centres a zoomed slide above the demo controls. */
export function SlideStage({ children }: { children: ReactNode }) {
  const zoom = useSlideZoom();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 bottom-[60px] z-50 flex items-center justify-center px-3">
      <div className="pointer-events-auto flex max-h-full w-full justify-center" style={{ zoom }}>{children}</div>
    </div>
  );
}

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
    <SlideStage>
      <motion.section role="dialog" aria-label={typeof title === "string" ? title : kicker}
        initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
        transition={reduce ? { duration: 0 } : { duration: 0.4, ease: EASE }}
        className={cn("flex w-full max-w-[1280px] flex-col overflow-hidden rounded-2xl border border-border bg-background px-8 py-9 sm:px-14 sm:py-12", className)}>
        <motion.p {...rise(0.05)} className="text-[17px] text-fg-muted">{kicker}</motion.p>
        <motion.h2 {...rise(0.12)}
          className="mt-2 text-[40px] leading-[1.05] font-semibold tracking-[-0.045em] text-balance text-fg sm:text-[60px]">
          {title}
        </motion.h2>
        <motion.div {...rise(0.22)} className="mt-8 min-h-0 flex-1 sm:mt-10">{children}</motion.div>
        {(note || source) && (
          <motion.div {...rise(0.4)} className="mt-8 flex flex-col gap-2 sm:mt-10">
            {note && <p className="text-[19px] text-balance text-fg-muted sm:text-[22px]">{note}</p>}
            {source && <p className="text-[13px] text-fg-subtle">{source}</p>}
          </motion.div>
        )}
      </motion.section>
    </SlideStage>
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
