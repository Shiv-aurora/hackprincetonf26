"use client";
// Shared frame for the full-screen tour cards in this folder (ZeroLeak, Investigator). Like the slides'
// SlideStage, each card is laid out on a fixed design canvas and zoomed to the screen, but this canvas sits
// between the tour's caption pill (top) and its controls (bottom): 1920×1080 gets ~1.26×, 1440×900 ~1.0×,
// so the smallest text (16px on the canvas) never renders under 16px on a projector.

import { useEffect, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Dot, cn } from "@/components/ui";

export const EASE = [0.16, 1, 0.3, 1] as const;
export const CANVAS = { w: 1320, h: 720 } as const;

/** Room the tour keeps for its caption pill (top) and controls (bottom), in px. */
const TOP = 108;
const BOTTOM = 64;
const SIDE = 12;

function useCardZoom(): number {
  const [z, setZ] = useState(1);
  useEffect(() => {
    const fit = () => setZ(Math.max(0.5, Math.min(1.8,
      (window.innerWidth - 2 * SIDE) / CANVAS.w,
      (window.innerHeight - TOP - BOTTOM) / CANVAS.h)));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return z;
}

/** Fixed overlay that centres the zoomed canvas between the caption and the controls. */
export function CardStage({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const zoom = useCardZoom();
  const reduce = useReducedMotion();
  return (
    <div className="pointer-events-none fixed inset-x-0 z-50 flex items-center justify-center" style={{ top: TOP, bottom: BOTTOM }}>
      <motion.section aria-label={label}
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        transition={reduce ? { duration: 0 } : { duration: 0.25, ease: EASE }}
        style={{ zoom, width: CANVAS.w, height: CANVAS.h }}
        className={cn("pointer-events-auto flex shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-background p-8", className)}>
        {children}
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
