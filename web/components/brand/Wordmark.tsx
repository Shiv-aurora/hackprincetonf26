"use client";

import { useId } from "react";
import { motion, type Transition } from "framer-motion";
import { J_PATH, J_THREADS, J_THREAD_LINES, KNOT, KNOT_AT, LETTERS, STROKE, VIEWBOX } from "./glyphs";

const [L, R] = J_THREAD_LINES;

export const BRAND = {
  ink: "#05070c",
  teal: "#2de2d0",
  cyan: "#7cf3ff",
  violet: "#8b5cf6",
  magenta: "#d946ef",
  amber: "#ffb547",
} as const;

export interface WordmarkProps {
  className?: string;
  /** "duo": letters in currentColor, the J-knot in teal → violet. "mono": everything currentColor. */
  tone?: "duo" | "mono";
  /** Weave the letters in like threads (stroke-draw). */
  animate?: boolean;
  /** Seconds before the weave starts. */
  delay?: number;
  /** Stroke weight multiplier (1 = regular). */
  weight?: number;
  title?: string;
}

const EASE: Transition["ease"] = [0.65, 0, 0.35, 1];

/** The MayaJaal wordmark: one word, capital J drawn as a knot in a net. Scales with its width. */
export function Wordmark({
  className,
  tone = "duo",
  animate = false,
  delay = 0,
  weight = 1,
  title = "MayaJaal",
}: WordmarkProps) {
  const uid = useId().replace(/:/g, "");
  const jGrad = `mj-j-${uid}`;
  const tGradL = `mj-tl-${uid}`;
  const tGradR = `mj-tr-${uid}`;
  const knotGrad = `mj-k-${uid}`;
  const duo = tone === "duo";
  const sw = STROKE * weight;

  const draw = (i: number, dur = 1.15) =>
    animate
      ? {
          initial: { pathLength: 0, opacity: 0 },
          animate: { pathLength: 1, opacity: 1 },
          transition: {
            pathLength: { duration: dur, delay: delay + i, ease: EASE },
            opacity: { duration: 0.2, delay: delay + i },
          },
        }
      : {};

  // Letters weave in from both ends toward the J, which ties last.
  const order: Record<string, number> = { M: 0, a1: 0.1, y: 0.2, a2: 0.3, a3: 0.3, a4: 0.2, l: 0.1 };

  return (
    <svg
      viewBox={`${VIEWBOX.x} ${VIEWBOX.y} ${VIEWBOX.w} ${VIEWBOX.h}`}
      className={className}
      role="img"
      aria-label={title}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={jGrad} gradientUnits="userSpaceOnUse" x1={KNOT.x} y1={KNOT.y} x2={KNOT.x - 30} y2={100}>
          <stop offset="0" stopColor={BRAND.cyan} />
          <stop offset="0.55" stopColor={BRAND.teal} />
          <stop offset="1" stopColor={BRAND.violet} />
        </linearGradient>
        <linearGradient id={tGradL} gradientUnits="userSpaceOnUse" x1={L[0]} y1={L[1]} x2={L[2]} y2={L[3]}>
          <stop offset="0" stopColor={BRAND.violet} stopOpacity="0" />
          <stop offset={KNOT_AT} stopColor={BRAND.magenta} stopOpacity="0.95" />
          <stop offset="1" stopColor={BRAND.magenta} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={tGradR} gradientUnits="userSpaceOnUse" x1={R[0]} y1={R[1]} x2={R[2]} y2={R[3]}>
          <stop offset="0" stopColor={BRAND.teal} stopOpacity="0" />
          <stop offset={KNOT_AT} stopColor={BRAND.cyan} stopOpacity="0.95" />
          <stop offset="1" stopColor={BRAND.cyan} stopOpacity="0" />
        </linearGradient>
        <radialGradient id={knotGrad}>
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor={BRAND.cyan} />
          <stop offset="1" stopColor={BRAND.teal} />
        </radialGradient>
      </defs>

      <g stroke="currentColor" strokeWidth={sw}>
        {LETTERS.map((l) => (
          <motion.path key={l.id} d={l.d} {...draw(order[l.id] ?? 0)} />
        ))}
      </g>

      {/* The J: threads meet in a knot; the stem hangs from it. */}
      <g>
        {J_THREADS.map((d, i) => (
          <motion.path
            key={i}
            d={d}
            stroke={duo ? `url(#${i === 0 ? tGradL : tGradR})` : "currentColor"}
            strokeOpacity={duo ? 1 : 0.5}
            strokeWidth={sw * 0.28}
            {...draw(0.35, 0.8)}
          />
        ))}
        <motion.path
          d={J_PATH}
          stroke={duo ? `url(#${jGrad})` : "currentColor"}
          strokeWidth={sw}
          {...draw(0.75, 1.0)}
        />
        <motion.circle
          cx={KNOT.x}
          cy={KNOT.y}
          r={sw * 0.78}
          fill={duo ? `url(#${knotGrad})` : "currentColor"}
          {...(animate
            ? {
                initial: { scale: 0, opacity: 0 },
                animate: { scale: 1, opacity: 1 },
                transition: { duration: 0.7, delay: delay + 0.95, ease: [0.16, 1, 0.3, 1] },
                style: { transformOrigin: `${KNOT.x}px ${KNOT.y}px`, transformBox: "view-box" },
              }
            : {})}
        />
      </g>
    </svg>
  );
}
