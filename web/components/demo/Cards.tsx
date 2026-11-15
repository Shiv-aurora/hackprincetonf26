"use client";
// Full-screen step content that is not a dashboard panel: the title, the three-defense comparison and the close.

import type { ReactNode } from "react";
import { WORLD } from "@/lib/contracts";
import { Badge, ButtonLink, cn } from "@/components/ui";
import type { ResultRow, ResultsFile } from "./data";
import { WhyNotBlock } from "@/components/landing/Why";
import { TitleSlide } from "./slides/Title";

function Center({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("pointer-events-none fixed inset-0 z-50 flex items-center justify-center px-4 pt-[88px] pb-[72px]", className)}>
      <div className="pointer-events-auto w-full">{children}</div>
    </div>
  );
}

export function TitleCard({ title, sub }: { title: string; sub: string }) {
  return (
    <Center>
      <TitleSlide title={title} sub={sub} />
    </Center>
  );
}

export function WhyCard({ title }: { title: string }) {
  return (
    <Center>
      <div className="mx-auto max-w-[1080px]">
        <h2 className="mb-6 text-center text-[32px] leading-tight font-semibold tracking-[-0.035em] text-fg sm:text-[40px]">{title}</h2>
        <WhyNotBlock compact />
      </div>
    </Center>
  );
}

export function CloseCard({ title }: { title: string }) {
  return (
    <Center>
      <div className="mx-auto flex max-w-[720px] flex-col items-center gap-8 text-center">
        <h2 className="text-[36px] leading-tight font-semibold tracking-[-0.035em] text-balance text-fg sm:text-[44px]">{title}</h2>
        <ButtonLink href="/war-room" variant="primary">See it live →</ButtonLink>
      </div>
    </Center>
  );
}

// ------------------------------------------------------------------ comparison

const ORDER = ["baseline", "static", "mayajaal"] as const;

interface Col {
  id: string;
  title: string;
  runs: number;
  realTaken: number | null;
  believed: number | null;   // 0..1
  overlap: number | null;    // 0..1, null = no decoy at all
  divert: number | null;     // seconds, median
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const nums = (xs: (number | null | undefined)[]) => xs.filter((x): x is number => typeof x === "number");

function columns(results: ResultsFile | null): Col[] {
  return ORDER.map((id) => {
    const title = WORLD.configs.find((c) => c.id === id)?.title ?? id;
    const rows: ResultRow[] = results?.runs.filter((r) => r.config === id) ?? [];
    if (!rows.length) return { id, title, runs: 0, realTaken: null, believed: null, overlap: null, divert: null };
    // Real patients the attacker was shown (stronger than "taken"); older results files only have "taken".
    const taken = nums(rows.map((r) => r.real_records_exposed ?? r.real_records_taken));
    const overlap = nums(rows.map((r) => r.decoy_overlap_between_sessions));
    return {
      id, title, runs: rows.length,
      realTaken: taken.length ? taken.reduce((a, b) => a + b, 0) : null,
      believed: rows.filter((r) => r.believed_success).length / rows.length,
      overlap: overlap.length ? overlap.reduce((a, b) => a + b, 0) / overlap.length : null,
      divert: median(nums(rows.map((r) => r.time_to_divert_s))),
    };
  });
}

export function CompareCard({ results, title }: { results: ResultsFile | null; title: string }) {
  const cols = columns(results);
  const missing = !results;
  const single = cols.every((c) => c.runs <= 1);

  return (
    <Center>
      <div className="mx-auto w-full max-w-[880px] rounded-xl border border-border bg-background p-6 sm:p-8">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-fg">{title}</h2>
          {missing && <Badge>Recording…</Badge>}
        </div>

        <div className={cn("mt-6 grid grid-cols-[minmax(0,1.15fr)_repeat(3,minmax(0,1fr))] text-[14px]",
          missing && "opacity-50")}>
          <span />
          {cols.map((c) => (
            <span key={c.id} className={cn("pb-3 font-medium", c.id === "mayajaal" ? "text-shadow" : "text-fg")}>{c.title}</span>
          ))}

          <RowLabel sub="Any real chart it was able to read">Real patients shown to the attacker</RowLabel>
          {cols.map((c) => (
            <Cell key={c.id}>
              <span className={cn("text-4xl font-semibold tracking-[-0.04em] tabular-nums",
                c.realTaken === null ? "text-fg-subtle" : c.realTaken > 0 ? "text-danger" : "text-fg")}>
                {c.realTaken === null ? "—" : c.realTaken.toLocaleString("en-US")}
              </span>
            </Cell>
          ))}

          <RowLabel>Attacker believed it won</RowLabel>
          {cols.map((c) => (
            <Cell key={c.id}>
              <span className={cn("text-xl font-medium tabular-nums", c.believed === null ? "text-fg-subtle" : "text-fg")}>
                {c.believed === null ? "—" : single ? (c.believed >= 0.5 ? "Yes" : "No") : `${Math.round(c.believed * 100)}%`}
              </span>
            </Cell>
          ))}

          <RowLabel sub="Two attackers, same fake hospital?">Decoy reused across attackers</RowLabel>
          {cols.map((c) => (
            <Cell key={c.id}>
              {c.overlap === null
                ? <span className="text-xl font-medium text-fg-subtle">—</span>
                : <div className="flex items-center gap-3">
                    <Sessions seed={c.id} overlap={c.overlap} shadow={c.id === "mayajaal"} />
                    <span className="text-xl font-medium tabular-nums text-fg">{Math.round(c.overlap * 100)}%</span>
                  </div>}
            </Cell>
          ))}

          <RowLabel>Time to divert</RowLabel>
          {cols.map((c) => (
            <Cell key={c.id}>
              <span className={cn("text-xl font-medium tabular-nums", c.divert === null ? "text-fg-subtle" : "text-fg")}>
                {c.divert === null ? "—" : `${c.divert.toFixed(1)} s`}
              </span>
            </Cell>
          ))}
        </div>

        <p className="mt-5 truncate text-xs text-fg-subtle" title={results?.note}>
          {missing ? "Benchmark runs are being recorded. No numbers until they land." : results.note}
        </p>
      </div>
    </Center>
  );
}

function RowLabel({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="flex min-h-[64px] flex-col justify-center border-t border-border py-3 pr-4">
      <span className="text-fg-muted">{children}</span>
      {sub && <span className="text-xs text-fg-subtle">{sub}</span>}
    </div>
  );
}

function Cell({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[64px] items-center border-t border-border py-3">{children}</div>;
}

/** Two attacker sessions as tiny 4×3 "record" grids. Cells shared between them = the measured overlap. */
function Sessions({ seed, overlap, shadow }: { seed: string; overlap: number; shadow: boolean }) {
  const N = 12;
  const a = Array.from({ length: N }, (_, i) => bit(seed, i));
  const keep = Math.round(overlap * N);
  const b = a.map((v, i) => (i < keep ? v : !v));
  const on = shadow ? "bg-shadow" : "bg-fg-muted";
  const grid = (cells: boolean[], label: string) => (
    <span className="grid grid-cols-4 gap-[3px]" aria-label={label}>
      {cells.map((v, i) => <span key={i} className={cn("size-[7px] rounded-[1.5px]", v ? on : "bg-surface-2")} />)}
    </span>
  );
  return (
    <span className="flex items-center gap-1.5" role="img"
      aria-label={`Session A and session B share ${Math.round(overlap * 100)}% of their fake records`}>
      {grid(a, "Session A")}
      {grid(b, "Session B")}
    </span>
  );
}

function bit(seed: string, i: number): boolean {
  let h = 2166136261;
  for (const ch of `${seed}:${i}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) & 4) !== 0;
}
