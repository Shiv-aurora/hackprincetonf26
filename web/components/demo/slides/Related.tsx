"use client";
// "Where MIRAGE moves the field": the prior work the MIRAGE draft cites, compared on what each one claims in its
// published abstract (RELATED in research.ts, one comment per row with the link), MIRAGE as the last row; then what we
// measured on the running system and the paper's own limits. Choreography ends by ~3 s.

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/components/ui";
import { EASE, SlideFrame } from "./Frame";
import { LIMITS, MEASURED, RELATED, RELATED_COLS, type Mark } from "./research";

const T = { head: 0.3, row: 0.45, rowStep: 0.11, ours: 1.45, footer: 2.2 };

type Tr = (delay: number, duration?: number) => object;

export function RelatedSlide({ title }: { title: string }) {
  const reduce = useReducedMotion();
  const tr: Tr = (delay, duration = 0.4) => (reduce ? { duration: 0 } : { duration, delay, ease: EASE });

  return (
    <SlideFrame kicker="Related research · the work the MIRAGE draft builds on" title={title}
      source={<span className="text-[16px]">Each cell from the paper&apos;s published abstract: <Check className="inline size-4 align-[-2px]" strokeWidth={2.5} aria-label="yes" /> claimed · partly · — not claimed. Measured: paper/data/real_numbers.tex.</span>}>
      {/* Separate borders on the cells (not the rows), so each row's lines fade in with it. */}
      <table className="w-full table-fixed border-separate border-spacing-0 text-left">
        <colgroup>
          <col className="w-[200px]" />
          <col className="w-[196px]" />
          {RELATED_COLS.map((c) => <col key={c} className="w-[108px]" />)}
          <col />
        </colgroup>
        <motion.thead initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(T.head, 0.35)}>
          <tr className="align-bottom text-[16px] leading-tight text-fg-muted [&>th]:border-b [&>th]:border-border-strong [&>th]:pb-2.5 [&>th]:font-normal">
            <th className="pr-3">Approach</th>
            <th className="pr-3">Paper</th>
            {RELATED_COLS.map((c) => <th key={c} className="px-1.5 text-center">{c}</th>)}
            <th className="pl-4">Evidence</th>
          </tr>
        </motion.thead>
        <tbody>
          {RELATED.map((r, i) => {
            const delay = r.ours ? T.ours : T.row + i * T.rowStep;
            return (
              <motion.tr key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(delay, 0.35)}
                className={cn("h-[42px] align-middle [&>td]:border-b", r.ours ? "bg-surface-2 [&>td]:border-border-strong" : "[&>td]:border-border")}>
                <td className={cn("py-[6px] pr-3 text-[18px] leading-tight", r.ours ? "pl-3 font-semibold text-fg" : "font-medium text-fg")}>{r.name}</td>
                <td className={cn("py-[6px] pr-3 text-[16px] leading-tight", r.ours ? "text-fg" : "text-fg-muted")}>
                  {r.cite.map((c) => <span key={c} className="block whitespace-nowrap">{c}</span>)}
                </td>
                {r.marks.map((m, j) => (
                  <td key={RELATED_COLS[j]} className="px-1.5 py-[6px] text-center leading-none">
                    <Cell mark={m} ours={!!r.ours} delay={r.ours ? T.ours + 0.15 + j * 0.09 : delay} reduce={!!reduce} />
                  </td>
                ))}
                <td className={cn("py-[6px] pl-4 text-[16px] leading-tight", r.ours ? "text-fg" : "text-fg-muted")}>{r.evidence}</td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>

      {/* what we measured, and the paper's own limits */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={tr(T.footer)}
        className="mt-5 grid grid-cols-[1fr_1fr_1.15fr] gap-10">
        <Stat from={MEASURED.overlap.static} to={MEASURED.overlap.mayajaal}
          label={<>of the decoy shared by two attackers, static honeypot → MayaJaal</>} />
        <Stat from={MEASURED.realRecords.none} to={MEASURED.realRecords.mayajaal}
          label={<>real records taken by one scripted attack, no deception → MayaJaal (static honeypot: {MEASURED.realRecords.static} too)</>} />
        <div>
          <p className="text-[16px] text-fg-subtle">Limits, from the paper</p>
          <p className="mt-1 text-[16px] leading-snug text-fg-muted">{LIMITS}</p>
        </div>
      </motion.div>
    </SlideFrame>
  );
}

function Cell({ mark, ours, delay, reduce }: { mark: Mark; ours: boolean; delay: number; reduce: boolean }) {
  if (mark === "yes") {
    return (
      <motion.span className="inline-flex" aria-label="yes"
        initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }}
        transition={reduce ? { duration: 0 } : { duration: 0.3, delay, ease: EASE }}>
        <Check className="size-[26px] text-fg" strokeWidth={ours ? 2.75 : 2.5} aria-hidden />
      </motion.span>
    );
  }
  if (mark === "partly") return <span className="text-[16px] text-fg-muted">partly</span>;
  return <span className="text-[20px] text-fg-subtle" aria-label="not claimed">—</span>;
}

function Stat({ from, to, label }: { from: string; to: string; label: ReactNode }) {
  return (
    <div>
      <p className="flex items-baseline gap-2.5 text-[32px] leading-none font-semibold tracking-[-0.03em] tabular-nums">
        <span className="text-fg-muted">{from}</span>
        <span className="text-[24px] font-normal text-fg-subtle">→</span>
        <span className="text-fg">{to}</span>
      </p>
      <p className="mt-2 text-[16px] leading-snug text-fg-muted">{label}</p>
    </div>
  );
}
