"use client";
// "Backed by research: MIRAGE". Page 1 of the draft paper (public/mirage.pdf, rendered to public/paper/) lies on a
// desk with page 2 underneath. The camera pushes into the abstract, then three callouts mark the exact phrases
// (boxes measured from the PDF, see research.ts) and the sections that are not in the abstract are listed below.
// Choreography finishes by ~4.3 s, then holds. Reduced motion shows the zoomed end state at once.

import type { ReactNode } from "react";
import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/components/ui";
import { EASE, SlideStage } from "./Frame";
import { ACRONYM, ALSO_IN_PAPER, CALLOUTS, type Box, type Tone } from "./research";
import page1 from "../../../public/paper/page-1.png";
import page2 from "../../../public/paper/page-2.png";

// ------------------------------------------------------------------ geometry (design-canvas px)

const DESK = { w: 1168, h: 510 };
/** Page laid out at its zoomed size (so the zoomed state is never upscaled), scaled down for the overview. */
const PAGE = { w: 1411, h: Math.round((1411 * page1.height) / page1.width) };

// Overview: page 1 big, from its top edge down to the introduction (the desk crops the rest), centred and
// nudged left so page 2 can peek out on the right.
const S0 = 500 / PAGE.w;
const X0 = (DESK.w - PAGE.w * S0) / 2 - 22;
const Y0 = 28;

// Zoomed: the desk shows the page from just under the author line to just above "I. Introduction" (so the
// abstract fills its height, no half-cut lines), and is cut at the page's gutter by the desk's right edge, which
// leaves the desk free on the left for the callouts.
const VIEW = { top: 0.194, bottom: 0.4975, right: 0.502 };
const S1 = DESK.h / ((VIEW.bottom - VIEW.top) * PAGE.h);
const X1 = DESK.w - VIEW.right * PAGE.w * S1;
const Y1 = -VIEW.top * PAGE.h * S1;

/** The margin bar of each callout sits in the page's left margin, just left of the text column. */
const BAR_X = 0.064;
const barSpan = (boxes: Box[]) => [Math.min(...boxes.map((b) => b[1])) - 0.002, Math.max(...boxes.map((b) => b[1] + b[3])) + 0.002];
const deskY = (f: number) => Y1 + f * PAGE.h * S1;
const deskBarX = X1 + BAR_X * PAGE.w * S1;

const T = { pages: 0.3, zoom: 1.5, zoomDur: 1.2, callout: 2.75, step: 0.38, also: 4.0 };

const HL: Record<Tone, string> = { focus: "bg-focus/25", alert: "bg-alert/20 dark:bg-alert/30", shadow: "bg-shadow/25" };
const SOLID: Record<Tone, string> = { focus: "bg-focus", alert: "bg-alert", shadow: "bg-shadow" };
const RING: Record<Tone, string> = { focus: "border-focus/50", alert: "border-alert/55", shadow: "border-shadow/50" };

export function PaperSlide({ title }: { title: string }) {
  const reduce = useReducedMotion();
  const tr = (delay: number, duration = 0.45) => (reduce ? { duration: 0 } : { duration, delay, ease: EASE });
  const rise = (delay: number) => ({ initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: tr(delay, 0.5) });

  return (
    <SlideStage>
      <motion.section role="dialog" aria-label={title}
        initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={tr(0, 0.4)}
        className="flex w-full max-w-[1280px] flex-col overflow-hidden rounded-2xl border border-border bg-background px-14 py-12">
        <motion.p {...rise(0.05)} className="text-[17px] text-fg-muted">
          Draft research note · <a href="/mirage.pdf" target="_blank" rel="noreferrer" className="font-mono text-fg underline decoration-border-strong underline-offset-4">/mirage.pdf</a>
        </motion.p>
        <motion.h2 {...rise(0.12)} className="mt-2 text-[60px] leading-[1.05] font-semibold tracking-[-0.045em] text-fg">
          {title}
        </motion.h2>
        <motion.p {...rise(0.2)} className="mt-2.5 text-[22px] tracking-[-0.01em] text-fg-subtle">
          {ACRONYM.map((w, i) => (
            <span key={w}>
              {i > 0 && " "}
              {w === "for" ? w : <><span className="font-semibold text-fg">{w[0]}</span>{w.slice(1)}</>}
            </span>
          ))}
        </motion.p>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(0.25, 0.4)}
          className="relative mt-7 overflow-hidden rounded-xl border border-border bg-surface-2 dark:bg-surface"
          style={{ width: DESK.w, height: DESK.h }}>
          {/* The camera: the pages are laid out at full size and scaled, so the zoomed end state is crisp. */}
          <motion.div className="absolute top-0 left-0" style={{ width: PAGE.w, height: PAGE.h, originX: 0, originY: 0 }}
            initial={{ x: X0, y: Y0, scale: S0 }} animate={{ x: X1, y: Y1, scale: S1 }}
            transition={reduce ? { duration: 0 } : { duration: T.zoomDur, delay: T.zoom, ease: [0.65, 0, 0.35, 1] }}>
            <Sheet src={page2} alt="" behind delay={T.pages + 0.12} reduce={!!reduce} />
            <Sheet src={page1} delay={T.pages} reduce={!!reduce}
              alt="Page 1 of the MIRAGE draft paper: title, abstract and architecture figure.">
              {CALLOUTS.map((c, ci) => {
                const [top, bottom] = barSpan(c.boxes);
                const at = T.callout + ci * T.step;
                return (
                  <span key={c.id}>
                    {c.boxes.map((b, bi) => (
                      <motion.span key={bi} aria-hidden
                        className={cn("absolute rounded-[5px] mix-blend-multiply", HL[c.tone])}
                        style={{ left: (b[0] - 0.003) * PAGE.w, top: (b[1] - 0.0022) * PAGE.h, width: (b[2] + 0.006) * PAGE.w,
                          height: (b[3] + 0.0044) * PAGE.h, originX: 0 }}
                        initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={tr(at + bi * 0.14, 0.3)} />
                    ))}
                    <motion.span aria-hidden className={cn("absolute w-[6px] rounded-full", SOLID[c.tone])}
                      style={{ left: BAR_X * PAGE.w - 3, top: top * PAGE.h, height: (bottom - top) * PAGE.h, originY: 0 }}
                      initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={tr(at + 0.08, 0.25)} />
                  </span>
                );
              })}
            </Sheet>
          </motion.div>

          {/* Callouts: a pill on the desk and a leader to the margin bar of its phrase. */}
          {CALLOUTS.map((c, ci) => {
            const [top, bottom] = barSpan(c.boxes);
            const yc = deskY((top + bottom) / 2);
            const at = T.callout + ci * T.step;
            return (
              <div key={c.id} className="absolute flex items-center" style={{ left: 28, top: yc - 24, height: 48, width: deskBarX - 28 - 4 }}>
                <motion.span initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={tr(at + 0.18, 0.35)}
                  className={cn("flex shrink-0 items-center gap-2.5 rounded-full border bg-background py-2 pr-4 pl-3.5 text-[20px] leading-none tracking-[-0.01em] text-fg", RING[c.tone])}>
                  <span className={cn("size-2.5 shrink-0 rounded-full", SOLID[c.tone])} />
                  {c.label}
                  {c.tag && <span className="font-mono text-[16px] text-fg-muted">{c.tag}</span>}
                </motion.span>
                <motion.span aria-hidden className={cn("ml-2 h-[2px] flex-1 rounded-full", SOLID[c.tone])} style={{ originX: 0 }}
                  initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={tr(at + 0.1, 0.3)} />
              </div>
            );
          })}

          {/* In the paper, not in the abstract: listed, not pointed at. */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={tr(T.also)}
            className="absolute" style={{ left: 32, top: deskY(0.37), width: X1 - 64 }}>
            <p className="text-[16px] text-fg-subtle">Also in the paper</p>
            <ul className="mt-2.5 flex flex-col gap-2">
              {ALSO_IN_PAPER.map((a) => (
                <li key={a.section} className="flex items-baseline gap-3 text-[19px] leading-snug text-fg-muted">
                  <span className="w-[68px] shrink-0 font-mono text-[16px] whitespace-nowrap text-fg-subtle">{a.section}</span>
                  {a.text}
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      </motion.section>
    </SlideStage>
  );
}

/** One sheet of paper: the page image at full layout size, a hairline edge, slightly dimmed in dark mode. */
function Sheet({ src, alt, behind, delay, reduce, children }: {
  src: typeof page1; alt: string; behind?: boolean; delay: number; reduce: boolean; children?: ReactNode;
}) {
  return (
    <motion.div className="absolute top-0 left-0 bg-white ring-[3px] ring-border-strong dark:brightness-[0.9]"
      style={{ width: PAGE.w, height: PAGE.h, ...(behind ? { left: 104, top: 40, rotate: 2 } : null) }}
      initial={{ opacity: 0, y: 60 }} animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.6, delay, ease: EASE }}>
      <Image src={src} alt={alt} unoptimized loading="eager" draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full select-none" />
      {children}
    </motion.div>
  );
}
