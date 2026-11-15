"use client";
// Dims the whole page except the named `data-demo` panels, which get a hole and a crisp 1.5px ring.
// One fixed SVG with a mask, so nested panels (e.g. a block inside the defender card) can be lit while
// their parent stays dim. Pointer events pass through.

import { useCallback, useEffect, useId, useLayoutEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

interface Hole { name: string; x: number; y: number; width: number; height: number }

const PAD = 6;
const RADIUS = 12;
const EASE = [0.2, 0, 0, 1] as const;

export function Spotlight({ targets, dim }: { targets: string[]; dim: number }) {
  const maskId = useId();
  const reduce = useReducedMotion();
  const [holes, setHoles] = useState<Hole[]>([]);
  const key = targets.join(",");

  const measure = useCallback(() => {
    const out: Hole[] = [];
    for (const name of key ? key.split(",") : []) {
      const el = document.querySelector<HTMLElement>(`[data-demo="${name}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      out.push({ name, x: r.left - PAD, y: r.top - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD });
    }
    setHoles((prev) => same(prev, out) ? prev : out);
  }, [key]);

  // Measure now, on resize/scroll, and whenever a lit panel changes size (e.g. a card appears).
  useLayoutEffect(() => {
    const raf = requestAnimationFrame(measure);
    // Panels can move without resizing (the narrator wraps to two lines, a panel above grows): re-measure
    // a few times while the step's layout settles.
    const later = [120, 350, 800].map((ms) => setTimeout(measure, ms));
    const ro = new ResizeObserver(() => measure());
    ro.observe(document.body);
    const main = document.querySelector("main");
    if (main) for (const child of Array.from(main.children)) ro.observe(child);
    for (const name of key ? key.split(",") : []) {
      const el = document.querySelector(`[data-demo="${name}"]`);
      if (el) ro.observe(el);
    }
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(raf);
      later.forEach(clearTimeout);
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [key, measure]);

  // Soft scroll: bring the first lit panel into view when it is off screen (narrow layouts only).
  useEffect(() => {
    const first = key.split(",")[0];
    const el = first ? document.querySelector<HTMLElement>(`[data-demo="${first}"]`) : null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 88 || r.bottom > window.innerHeight - 72) {
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    }
  }, [key, reduce]);

  const t = { duration: reduce ? 0 : 0.25, ease: EASE };

  return (
    <svg aria-hidden className="pointer-events-none fixed inset-0 z-40 h-full w-full">
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse">
          <rect x="0" y="0" width="100%" height="100%" fill="white" />
          <AnimatePresence>
            {holes.map((h) => (
              <motion.rect key={h.name} rx={RADIUS} fill="black"
                initial={{ opacity: 0, x: h.x, y: h.y, width: h.width, height: h.height }}
                animate={{ opacity: 1, x: h.x, y: h.y, width: h.width, height: h.height }}
                exit={{ opacity: 0 }}
                transition={t} />
            ))}
          </AnimatePresence>
        </mask>
      </defs>
      <motion.rect x="0" y="0" width="100%" height="100%" mask={`url(#${maskId})`}
        style={{ fill: "var(--background)" }}
        initial={false} animate={{ opacity: dim }} transition={t} />
      <AnimatePresence>
        {holes.map((h) => (
          <motion.rect key={h.name} rx={RADIUS} fill="none" strokeWidth={1.5}
            style={{ stroke: "var(--fg)" }}
            initial={{ opacity: 0, x: h.x, y: h.y, width: h.width, height: h.height }}
            animate={{ opacity: 1, x: h.x, y: h.y, width: h.width, height: h.height }}
            exit={{ opacity: 0 }}
            transition={t} />
        ))}
      </AnimatePresence>
    </svg>
  );
}

function same(a: Hole[], b: Hole[]) {
  if (a.length !== b.length) return false;
  return a.every((h, i) => h.name === b[i].name && Math.abs(h.x - b[i].x) < 0.5 && Math.abs(h.y - b[i].y) < 0.5
    && Math.abs(h.width - b[i].width) < 0.5 && Math.abs(h.height - b[i].height) < 0.5);
}
