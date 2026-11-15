"use client";
// Opening title of the guided demo. MayaJaal = "web of illusion": the eye mark draws in at the centre of a
// fine hairline web (jaal), then the name, a dictionary-style gloss, the promise and the red caveat.
// Intro is ~2.3 s; afterwards only the eye turns, very slowly. Reduced motion shows the final state at once.

import { motion, useReducedMotion } from "framer-motion";
import { EASE } from "./Frame";

// Same geometry as `LogoMark` in components/ui (viewBox 0 0 300 300): rim r=145, the swirl, pupil r=20.
const SWIRL =
  "M 177.6,10.7 C 135,68.4 155.4,100.7 179.8,118.5 C 260.9,160.6 274.8,214.5 255.9,244.9 C 237.3,191.9 198,172.4 158.5,194.9 C 86.9,238.6 40.7,231.2 15.7,196.6 C 58.2,203.1 109.1,193.5 107.9,128.3 C 109.5,97.6 111.5,16.6 177.6,10.7 z";

// ---------------------------------------------------------------- the web (px, centred on the eye)

const SPOKES = 18;
const RINGS = [96, 126, 164, 212, 272, 346, 436, 544];
const REACH = 600;
const ROT = -Math.PI / 2 + Math.PI / SPOKES; // no spoke straight up or down through the text column
// Stepped fall-off (a luminance mask of flat grey discs, no gradient): each band between rings is one tone.
const BANDS: [number, string][] = [[REACH, "#1f1f1f"], [490, "#383838"], [391, "#595959"], [309, "#8c8c8c"], [242, "#ffffff"]];

const polar = (r: number, a: number) => [r * Math.cos(a), r * Math.sin(a)].map((v) => v.toFixed(1)).join(",");

/** One ring of the web: chords between neighbouring spokes, each sagging slightly toward the centre. */
function ringPath(r: number) {
  const step = (2 * Math.PI) / SPOKES;
  const ctrl = r * Math.cos(step / 2) * 0.9;
  let d = `M ${polar(r, ROT)}`;
  for (let i = 0; i < SPOKES; i++) {
    const a = ROT + i * step;
    d += ` Q ${polar(ctrl, a + step / 2)} ${polar(r, a + step)}`;
  }
  return d;
}

const SPOKE_PATHS = Array.from({ length: SPOKES }, (_, i) => {
  const a = ROT + (i * 2 * Math.PI) / SPOKES;
  return `M ${polar(82, a)} L ${polar(REACH, a)}`;
});
const RING_PATHS = RINGS.map(ringPath);

// Where the caught "attacker" ends up: on the fourth ring, on a spoke left of the eye, clear of the text.
const CATCH_A = ROT + (14 * 2 * Math.PI) / SPOKES;
const CATCH = { x: RINGS[3] * Math.cos(CATCH_A), y: RINGS[3] * Math.sin(CATCH_A) };
const ENTER = { x: RINGS[6] * Math.cos(CATCH_A), y: RINGS[6] * Math.sin(CATCH_A) };

function Web({ reduce }: { reduce: boolean }) {
  const t = (duration: number, delay: number) => (reduce ? { duration: 0 } : { duration, delay, ease: EASE });
  return (
    <svg aria-hidden="true" focusable="false" viewBox={`${-REACH} ${-REACH} ${REACH * 2} ${REACH * 2}`}
      width={REACH * 2} height={REACH * 2}
      className="pointer-events-none absolute top-1/2 left-1/2 max-w-none -translate-x-1/2 -translate-y-1/2 text-border-strong">
      <defs>
        <mask id="mj-title-web" maskUnits="userSpaceOnUse" x={-REACH} y={-REACH} width={REACH * 2} height={REACH * 2}>
          {BANDS.map(([r, c]) => <circle key={r} r={r} fill={c} />)}
        </mask>
      </defs>
      <g mask="url(#mj-title-web)" fill="none" stroke="currentColor" strokeWidth={1}>
        {SPOKE_PATHS.map((d, i) => (
          <motion.path key={`s${i}`} d={d} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
            transition={t(1.1, 0.15 + (i % 6) * 0.02)} />
        ))}
        {RING_PATHS.map((d, i) => (
          <motion.path key={`r${i}`} d={d} initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }}
            transition={t(0.9, 0.3 + i * 0.09)} />
        ))}
      </g>
      {/* The caught attacker: slides in along a spoke, stops on a ring, a hairline ring settles around it. */}
      <motion.circle r={3.5} className="fill-shadow"
        initial={{ cx: ENTER.x, cy: ENTER.y, opacity: 0 }} animate={{ cx: CATCH.x, cy: CATCH.y, opacity: 1 }}
        transition={t(0.8, 1.2)} />
      <motion.circle cx={CATCH.x} cy={CATCH.y} r={9} fill="none" strokeWidth={1} className="stroke-shadow"
        initial={{ opacity: 0, scale: 1.8 }} animate={{ opacity: 1, scale: 1 }} transition={t(0.4, 1.95)} />
    </svg>
  );
}

// ---------------------------------------------------------------- the eye

function Eye({ reduce }: { reduce: boolean }) {
  const t = (duration: number, delay: number) => (reduce ? { duration: 0 } : { duration, delay, ease: EASE });
  return (
    <motion.div className="relative size-[150px] text-fg"
      initial={{ rotate: -140, scale: 0.86 }} animate={{ rotate: 0, scale: 1 }} transition={t(1.4, 0.1)}>
      <motion.div className="size-full" initial={{ rotate: 0 }} animate={{ rotate: reduce ? 0 : 360 }}
        transition={reduce ? { duration: 0 } : { duration: 90, delay: 2.4, ease: "linear", repeat: Infinity }}>
        <svg viewBox="0 0 300 300" aria-hidden="true" focusable="false" className="size-full overflow-visible">
          <motion.circle cx={150} cy={150} r={145} className="fill-background" stroke="currentColor" strokeWidth={4}
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={t(0.9, 0.05)} />
          <motion.circle cx={150} cy={150} r={112} fill="none" className="stroke-border-strong" strokeWidth={2}
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={t(0.9, 0.35)} />
          <motion.path d={SWIRL} stroke="currentColor" strokeWidth={3} strokeLinejoin="round" fill="currentColor"
            initial={{ pathLength: 0, fillOpacity: 0 }} animate={{ pathLength: 1, fillOpacity: 1 }}
            transition={reduce ? { duration: 0 } : {
              pathLength: { duration: 0.9, delay: 0.25, ease: EASE },
              fillOpacity: { duration: 0.45, delay: 0.95, ease: EASE },
            }} />
          <motion.circle cx={150} cy={150} r={20} className="fill-shadow"
            initial={{ scale: 0 }} animate={{ scale: 1 }} transition={t(0.4, 1.05)} />
        </svg>
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------- the slide

export function TitleSlide({ title, sub }: { title: string; sub: string }) {
  const reduce = !!useReducedMotion();
  const rise = (delay: number, y = 12) => ({
    initial: { opacity: 0, y }, animate: { opacity: 1, y: 0 },
    transition: reduce ? { duration: 0 } : { duration: 0.5, delay, ease: EASE },
  });
  return (
    <motion.section role="dialog" aria-label={title}
      initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
      transition={reduce ? { duration: 0 } : { duration: 0.35, ease: EASE }}
      className="relative mx-auto w-full max-w-[1160px] overflow-hidden rounded-2xl border border-border bg-background">
      <div className="relative flex flex-col items-center px-10 pt-16 pb-16 text-center">
        {/* The web is centred on the eye; the panel clips it. */}
        <div className="relative flex items-center justify-center">
          <Web reduce={reduce} />
          <Eye reduce={reduce} />
        </div>

        <motion.h1 {...rise(0.9, 16)}
          className="relative mt-10 text-[96px] leading-none font-semibold tracking-[-0.05em] text-fg">
          {title}
        </motion.h1>
        <motion.p {...rise(1.2, 6)} className="relative mt-4 text-[18px] text-fg-subtle">
          <span className="font-mono">Maya · Jaal</span>
          <span aria-hidden="true"> — </span>
          <span className="text-fg-muted">illusion trap</span>
        </motion.p>

        <motion.p {...rise(1.45)}
          className="relative mt-9 max-w-[900px] text-[34px] leading-tight tracking-[-0.02em] text-balance text-fg-muted">
          {sub}
        </motion.p>
        <motion.p {...rise(1.8)} className="relative mt-2 text-[34px] leading-tight font-semibold tracking-[-0.02em] text-danger">
          Without stopping the attacks.
        </motion.p>
      </div>
    </motion.section>
  );
}
