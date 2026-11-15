"use client";
// Shared frame for the full-screen tour cards in this folder (ZeroLeak, Investigator), styled like the research
// slides (slides/Frame.tsx's SlideFrame): a short kicker, the step's big title, then the visual. The tour hides
// its caption pill on these steps, so a card owns the screen from the top down to the controls. Each card is
// laid out on a fixed design canvas and zoomed to fit (1920×1080 gets ~1.27×, 1440×900 ~1.0×), so the smallest
// text (16px on the canvas) never renders under 16px on a projector.

import { useEffect, useId, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Dot, cn } from "@/components/ui";

export const EASE = [0.16, 1, 0.3, 1] as const;
export const CANVAS = { w: 1400, h: 780 } as const;

/** Room the tour keeps for its controls at the bottom, and the margin around the card, in px. */
const BOTTOM = 60;
const MARGIN = 16;

function useCardZoom(): number {
  const [z, setZ] = useState(1);
  useEffect(() => {
    const fit = () => setZ(Math.max(0.5, Math.min(1.8,
      (window.innerWidth - 2 * MARGIN) / CANVAS.w,
      (window.innerHeight - BOTTOM - 2 * MARGIN) / CANVAS.h)));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return z;
}

/** Fixed overlay that centres the zoomed canvas above the tour's controls: kicker, title, then `children`
 *  filling the rest of the canvas. */
export function CardStage({ kicker, title, children, className }: {
  kicker: string; title: string; children: ReactNode; className?: string;
}) {
  const zoom = useCardZoom();
  const reduce = useReducedMotion();
  const id = useId();
  // Always pass initial + animate (so server and client agree); reduced motion just makes it instant.
  const rise = (delay: number) => ({
    initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 },
    transition: reduce ? { duration: 0 } : { duration: 0.3, delay, ease: EASE },
  });
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex items-center justify-center" style={{ bottom: BOTTOM }}>
      <motion.section aria-labelledby={id}
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        transition={reduce ? { duration: 0 } : { duration: 0.25, ease: EASE }}
        style={{ zoom, width: CANVAS.w, height: CANVAS.h }}
        className={cn("pointer-events-auto flex shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-background px-12 py-9", className)}>
        <header className="shrink-0">
          <motion.p {...rise(0.05)} className="text-[17px] text-fg-muted">{kicker}</motion.p>
          <motion.h2 id={id} {...rise(0.1)}
            className="mt-1.5 text-[56px] leading-[1.05] font-semibold tracking-[-0.045em] text-balance text-fg">
            {title}
          </motion.h2>
        </header>
        <div className="mt-6 flex min-h-0 flex-1 flex-col">{children}</div>
      </motion.section>
    </div>
  );
}

/** Where a number comes from: "Recorded run", "Measured on the running system". */
export function Source({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-8 items-center gap-2 rounded-full border border-border px-3 text-[16px] whitespace-nowrap text-fg-muted", className)}>
      <Dot />{children}
    </span>
  );
}

/** Placeholder while a recorded file loads, or an honest note when it is missing. */
export function Pending({ failed, what }: { failed: boolean; what: string }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-[18px] text-fg-muted">{failed ? `No ${what} recorded yet. Nothing to show.` : `Loading the ${what}…`}</p>
    </div>
  );
}

const loaded = new Map<string, Promise<unknown>>();

/** Runs `load` (fetches from web/public/runs) once per page load and key; data is null until it lands,
 *  and stays null with `failed` when the file is missing or unreadable. `load` must be a stable function. */
export function useRunFile<T>(key: string, load: () => Promise<T | null>): { data: T | null; failed: boolean } {
  const [state, setState] = useState<{ data: T | null; failed: boolean }>({ data: null, failed: false });
  useEffect(() => {
    let alive = true;
    let p = loaded.get(key) as Promise<T | null> | undefined;
    if (!p) {
      p = load().catch(() => null);
      loaded.set(key, p);
    }
    void p.then((data) => {
      if (!alive) return;
      if (data === null) loaded.delete(key);   // try again on the next mount
      setState({ data, failed: data === null });
    });
    return () => { alive = false; };
  }, [key, load]);
  return state;
}

/** Bytes in decimal units, the way a file browser shows them: 138 B, 32.5 KB, 1.01 MB. */
export function bytes(n: number): string {
  if (n < 1000) return `${n} B`;
  if (n < 1e6) return `${(n / 1e3).toFixed(1)} KB`;
  return `${(n / 1e6).toFixed(2)} MB`;
}
