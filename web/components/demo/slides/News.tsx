"use client";
// "The last few weeks": a collage of real news snapshots about attacks on software and AI tooling, each with
// its outlet and date (sourced in facts.ts), landing one after another. Then: that's software, we can
// switch it off. The next slide is the thing we can't.

import { motion, useReducedMotion } from "framer-motion";
import { SlideFrame } from "./Frame";
import { NEWS, type NewsItem } from "./facts";

// Deterministic collage slots on the 1180×430 area: left, top, rotation.
const SLOTS: [number, number, number][] = [
  [0, 18, -2.2], [300, 0, 1.6], [600, 26, -1.2], [880, 4, 2.4],
  [70, 222, 1.4], [370, 236, -2.6], [660, 214, 1.1], [930, 230, -1.6],
];

function Card({ n, i, reduce }: { n: NewsItem; i: number; reduce: boolean }) {
  const [x, y, r] = SLOTS[i % SLOTS.length];
  return (
    <motion.article
      className="absolute w-[290px] rounded-xl border border-border-strong bg-background p-4 shadow-[0_1px_0_rgba(0,0,0,0.04)]"
      style={{ left: x, top: y, zIndex: i + 1 }}
      initial={{ opacity: 0, y: 40, rotate: r * 3, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, rotate: r, scale: 1 }}
      transition={reduce ? { duration: 0 } : { duration: 0.5, delay: 0.5 + i * 0.32, ease: [0.16, 1, 0.3, 1] }}>
      <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
        <span className="truncate text-[13px] font-semibold tracking-[-0.01em] text-fg">{n.outlet}</span>
        <span className="shrink-0 text-[12px] text-fg-subtle tabular-nums">{n.date}</span>
      </div>
      <span className="mt-2.5 inline-block rounded-full bg-alert-bg px-2 py-0.5 text-[11px] text-alert">{n.target}</span>
      <h3 className="mt-2 line-clamp-3 text-[17px] leading-[1.25] font-semibold tracking-[-0.015em] text-fg">{n.headline}</h3>
      <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-fg-muted">{n.what}</p>
    </motion.article>
  );
}

export function NewsSlide({ title }: { title: string }) {
  const reduce = !!useReducedMotion();
  return (
    <SlideFrame kicker="The last few weeks" title={title}
      note={<>That&apos;s software. We can patch it, roll it back, switch it off. <span className="text-fg">Now imagine it&apos;s a hospital.</span></>}
      source={`Sources: ${NEWS.map((n) => `${n.outlet} (${n.date})`).join(" · ")}`}>
      <div className="relative mx-auto h-[430px] w-[1180px] max-w-full">
        {NEWS.slice(0, SLOTS.length).map((n, i) => <Card key={n.url} n={n} i={i} reduce={reduce} />)}
      </div>
    </SlideFrame>
  );
}
